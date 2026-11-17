import OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat/completions";
import type { AgentEffort } from "@/lib/api/agentSettings";
import { OPENROUTER_BASE_URL, OPENROUTER_HEADERS } from "./config";
import { buildSystemPrompt } from "./systemPrompt";
import {
  DEFAULT_AGENT_PERMISSIONS,
  executeTool,
  openAiTools,
  parseToolArguments,
  type AgentPermissions,
  type ToolContext,
} from "./tools";

export const MAX_TURNS = 40;

export type AgentEventName =
  | "message"
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "ontology_changed"
  | "ui_action"
  | "done"
  | "error";
export type SendEvent = (event: AgentEventName, data: unknown) => Promise<void>;

export type AgentRequestBody = ChatCompletionCreateParamsStreaming & {
  reasoning: { effort: AgentEffort };
};

export interface AgentClient {
  createStream(body: AgentRequestBody, signal: AbortSignal): Promise<AsyncIterable<ChatCompletionChunk>>;
}

export type ReasoningDetail = Record<string, unknown>;

export type AgentAssistantMessage = ChatCompletionAssistantMessageParam & { reasoning_details?: ReasoningDetail[] };

type StreamDelta = ChatCompletionChunk.Choice.Delta & {
  reasoning?: string | null;
  reasoning_details?: ReasoningDetail[] | null;
};

type ProviderChunk = ChatCompletionChunk & { error?: { message?: string; code?: unknown } | null };

export class ProviderError extends Error {}

export function createOpenRouterClient(apiKey: string, fetchImpl?: typeof fetch): AgentClient {
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: OPENROUTER_HEADERS,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  return {
    createStream: (body, signal) => client.chat.completions.create(body, { signal }),
  };
}

export function describeError(err: unknown): string {
  if (err instanceof OpenAI.AuthenticationError) return "OpenRouter rejected the API key";
  if (err instanceof OpenAI.RateLimitError) return "Rate limited by OpenRouter or the model provider; try again shortly";
  if (err instanceof OpenAI.NotFoundError) return `Model not found on OpenRouter: ${err.message}`;
  if (err instanceof OpenAI.PermissionDeniedError) return `OpenRouter refused the request: ${err.message}`;
  if (err instanceof OpenAI.BadRequestError) return `OpenRouter rejected the request: ${err.message}`;
  if (err instanceof OpenAI.APIConnectionError) return "Could not reach OpenRouter";
  if (err instanceof OpenAI.APIError) {
    if (err.status === 402) return "OpenRouter account has insufficient credits";
    if (err.status === undefined) return `OpenRouter error: ${err.message}`;
    if (err.status >= 500) return `OpenRouter or the model provider is unavailable (HTTP ${err.status}): ${err.message}`;
    return `OpenRouter error (HTTP ${err.status}): ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof OpenAI.APIUserAbortError || (err instanceof Error && err.name === "AbortError");
}

function mergeReasoningDetails(target: ReasoningDetail[], incoming: ReasoningDetail[]) {
  for (const d of incoming) {
    const existing = typeof d.index === "number" ? target.find((t) => t.index === d.index && t.type === d.type) : undefined;
    if (!existing) {
      target.push({ ...d });
      continue;
    }
    for (const [k, v] of Object.entries(d)) {
      if (v === null || v === undefined) continue;
      if ((k === "text" || k === "summary" || k === "data") && typeof v === "string" && typeof existing[k] === "string") {
        existing[k] = (existing[k] as string) + v;
      } else {
        existing[k] = v;
      }
    }
  }
}

function reasoningText(details: ReasoningDetail[]): string {
  return details
    .map((d) => (typeof d.text === "string" ? d.text : typeof d.summary === "string" ? d.summary : ""))
    .join("");
}

export function buildUserMessage(userMessage: string, pageContext: string): ChatCompletionUserMessageParam {
  return {
    role: "user",
    content: [
      { type: "text", text: `<page_context>\n${pageContext}\n</page_context>` },
      { type: "text", text: userMessage },
    ],
  };
}

export function buildSystemMessage(model: string, text: string): ChatCompletionSystemMessageParam {
  if (!model.startsWith("anthropic/")) return { role: "system", content: text };
  const part: ChatCompletionContentPartText & { cache_control: { type: "ephemeral" } } = {
    type: "text",
    text,
    cache_control: { type: "ephemeral" },
  };
  return { role: "system", content: [part] };
}

export interface RunChatOptions {
  client: AgentClient;
  model: string;
  effort: AgentEffort;
  customInstructions: string;
  history: ChatCompletionMessageParam[];
  userMessage: string;
  pageContext: string;
  toolContext: ToolContext;
  /** What the agent may change. Defaults to toolContext.permissions, then DEFAULT_AGENT_PERMISSIONS. */
  permissions?: AgentPermissions;
  send: SendEvent;
  signal: AbortSignal;
  maxTurns?: number;
}

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
}

export async function runAgentChat(opts: RunChatOptions): Promise<void> {
  const { client, send, signal } = opts;
  const permissions = opts.permissions ?? opts.toolContext.permissions ?? DEFAULT_AGENT_PERMISSIONS;
  // Tools check this too, so a call to a tool the model was not offered is still refused.
  opts.toolContext.permissions = permissions;
  const system = buildSystemMessage(
    opts.model,
    buildSystemPrompt({
      projectId: opts.toolContext.projectId,
      branch: opts.toolContext.branch,
      customInstructions: opts.customInstructions,
      permissions,
    }),
  );
  const tools = openAiTools(permissions);
  const conversation: ChatCompletionMessageParam[] = [...opts.history];

  const append = async (message: ChatCompletionMessageParam) => {
    conversation.push(message);
    await send("message", { message });
  };

  await append(buildUserMessage(opts.userMessage, opts.pageContext));

  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal.aborted) return;
    const body: AgentRequestBody = {
      model: opts.model,
      messages: [system, ...conversation],
      tools,
      tool_choice: "auto",
      stream: true,
      reasoning: { effort: opts.effort },
    };
    const stream = await client.createStream(body, signal);

    let text = "";
    let finish: string | null = null;
    const calls: PendingCall[] = [];
    const details: ReasoningDetail[] = [];

    for await (const raw of stream) {
      const chunk = raw as ProviderChunk;
      if (chunk.error) throw new ProviderError(chunk.error.message || "The model provider returned an error");
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = (choice.delta ?? {}) as StreamDelta;
      if (delta.content) {
        text += delta.content;
        await send("text", { text: delta.content });
      }
      if (delta.reasoning_details?.length) mergeReasoningDetails(details, delta.reasoning_details);
      const thinking = delta.reasoning || (delta.reasoning_details?.length ? reasoningText(delta.reasoning_details) : "");
      if (thinking) await send("thinking", { text: thinking });
      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: "", name: "", arguments: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.arguments += tc.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    if (signal.aborted) return;
    if (finish === "error") throw new ProviderError("The model provider returned an error");

    const toolCalls: ChatCompletionMessageFunctionToolCall[] = calls
      .filter((c): c is PendingCall => !!c)
      .map((c, i) => ({
        id: c.id || `call_${turn}_${i}`,
        type: "function",
        function: { name: c.name, arguments: c.arguments },
      }));

    if (finish === "length" && toolCalls.length) {
      await send("error", { detail: "The model ran out of output tokens while writing a tool call; the call was not run" });
      await send("done", { stop_reason: finish });
      return;
    }

    if (finish === "content_filter") {
      if (text) await append(assistantMessage(text, [], details));
      await send("error", { detail: "The response was blocked by the model provider's content filter" });
      await send("done", { stop_reason: finish });
      return;
    }

    if (!toolCalls.length) {
      if (text || details.length) await append(assistantMessage(text, [], details));
      await send("done", { stop_reason: finish ?? "stop" });
      return;
    }

    await append(assistantMessage(text, toolCalls, details));

    for (const call of toolCalls) {
      if (signal.aborted) return;
      const parsed = parseToolArguments(call.function.arguments);
      await send("tool_use", {
        id: call.id,
        name: call.function.name,
        input: parsed.ok ? parsed.input : call.function.arguments,
      });
      const outcome = parsed.ok
        ? await executeTool(call.function.name, parsed.input, opts.toolContext)
        : {
            content: JSON.stringify({ error: parsed.error, INVALID_JSON: call.function.arguments }),
            is_error: true,
            summary: parsed.error,
            mutated: false,
            ontology_changes: [],
            ui_action: null,
          };
      await send("tool_result", {
        tool_use_id: call.id,
        name: call.function.name,
        is_error: outcome.is_error,
        summary: outcome.summary,
        mutated: outcome.mutated,
      });
      for (const change of outcome.ontology_changes) {
        await send("ontology_changed", { tool_use_id: call.id, name: call.function.name, ...change });
      }
      if (outcome.ui_action) {
        await send("ui_action", { tool_use_id: call.id, ...outcome.ui_action });
      }
      const toolMessage: ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: call.id,
        content: outcome.content,
      };
      await append(toolMessage);
    }
  }

  await send("error", { detail: `Stopped after ${maxTurns} model turns without finishing` });
  await send("done", { stop_reason: "max_turns" });
}

function assistantMessage(
  text: string,
  toolCalls: ChatCompletionMessageFunctionToolCall[],
  details: ReasoningDetail[],
): AgentAssistantMessage {
  const message: AgentAssistantMessage = {
    role: "assistant",
    content: text || (toolCalls.length ? null : ""),
  };
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (details.length) message.reasoning_details = details;
  return message;
}
