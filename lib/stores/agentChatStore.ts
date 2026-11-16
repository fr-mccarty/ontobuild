import { create } from "zustand";

import type { AgentEffort } from "@/lib/api/agentSettings";
import {
  AgentChatError,
  streamAgentChat,
  type AgentMessage,
  type AgentOntologyChange,
  type AgentStreamEvent,
  type AgentUiAction,
} from "@/lib/api/agentChat";

export type AgentToolStatus = "pending" | "ok" | "error";

export interface AgentToolCall {
  id: string;
  name: string;
  input: unknown;
  status: AgentToolStatus;
  summary?: string;
  mutated?: boolean;
}

export interface AgentConversation {
  messages: AgentMessage[];
  pendingUserText: string | null;
  streamingText: string;
  thinkingText: string;
  toolCalls: Record<string, AgentToolCall>;
  liveToolIds: string[];
  isStreaming: boolean;
  stopped: boolean;
  error: string | null;
  lastPageText: string | null;
  lastUserText: string | null;
  turnStartIndex: number;
  mutatedThisTurn: boolean;
}

export const EMPTY_CONVERSATION: AgentConversation = {
  messages: [],
  pendingUserText: null,
  streamingText: "",
  thinkingText: "",
  toolCalls: {},
  liveToolIds: [],
  isStreaming: false,
  stopped: false,
  error: null,
  lastPageText: null,
  lastUserText: null,
  turnStartIndex: 0,
  mutatedThisTurn: false,
};

export const INTERRUPTED_TOOL_RESULT = "Interrupted before the tool result was received.";
export const CONTINUE_PROMPT = "Continue where you left off.";

export function messageTextParts(message: AgentMessage): string[] {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return [content];
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: "text"; text: string } => !!p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text);
  }
  return [];
}

export function isPageContextText(text: unknown): boolean {
  return typeof text === "string" && text.trimStart().startsWith("<page_context>");
}

export function visibleUserText(message: AgentMessage): string {
  return messageTextParts(message)
    .filter((t) => !isPageContextText(t))
    .join("\n\n");
}

function unansweredToolCallIds(messages: AgentMessage[]): string[] {
  let idx = messages.length - 1;
  while (idx >= 0 && messages[idx].role === "tool") idx--;
  const assistant = messages[idx];
  if (!assistant || assistant.role !== "assistant" || !assistant.tool_calls?.length) return [];
  const answered = new Set(
    messages.slice(idx + 1).map((m) => (m.role === "tool" ? m.tool_call_id : null)).filter(Boolean),
  );
  return assistant.tool_calls.map((c) => c.id).filter((id) => !answered.has(id));
}

export function reduceAgentEvent(conv: AgentConversation, event: AgentStreamEvent): AgentConversation {
  switch (event.type) {
    case "message": {
      const message = event.message;
      const next: AgentConversation = { ...conv, messages: [...conv.messages, message] };
      if (message.role === "assistant") {
        next.streamingText = "";
        next.thinkingText = "";
      } else if (message.role === "user") {
        if (visibleUserText(message)) next.pendingUserText = null;
      } else if (message.role === "tool") {
        const existing = conv.toolCalls[message.tool_call_id];
        if (!existing || existing.status === "pending") {
          next.toolCalls = {
            ...conv.toolCalls,
            [message.tool_call_id]: {
              id: message.tool_call_id,
              name: existing?.name ?? "",
              input: existing?.input,
              summary: existing?.summary,
              status: "ok",
            },
          };
        }
      }
      return next;
    }
    case "text":
      return { ...conv, streamingText: conv.streamingText + event.text };
    case "thinking":
      return { ...conv, thinkingText: conv.thinkingText + event.text };
    case "tool_use": {
      const existing = conv.toolCalls[event.id];
      return {
        ...conv,
        toolCalls: {
          ...conv.toolCalls,
          [event.id]: {
            id: event.id,
            name: event.name,
            input: event.input,
            status: existing?.status ?? "pending",
            summary: existing?.summary,
            mutated: existing?.mutated,
          },
        },
        liveToolIds: conv.liveToolIds.includes(event.id) ? conv.liveToolIds : [...conv.liveToolIds, event.id],
      };
    }
    case "tool_result": {
      const existing = conv.toolCalls[event.tool_use_id];
      return {
        ...conv,
        toolCalls: {
          ...conv.toolCalls,
          [event.tool_use_id]: {
            id: event.tool_use_id,
            name: existing?.name || event.name,
            input: existing?.input,
            status: event.is_error ? "error" : "ok",
            summary: event.summary,
            mutated: event.mutated,
          },
        },
        mutatedThisTurn: conv.mutatedThisTurn || event.mutated,
      };
    }
    case "error":
      return { ...conv, error: event.detail };
    case "ontology_changed":
    case "ui_action":
    case "done":
      return conv;
  }
}

export function beginTurnState(conv: AgentConversation, userText: string, pageText: string): AgentConversation {
  return {
    ...conv,
    pendingUserText: userText,
    streamingText: "",
    thinkingText: "",
    liveToolIds: [],
    isStreaming: true,
    stopped: false,
    error: null,
    lastPageText: pageText,
    lastUserText: userText,
    turnStartIndex: conv.messages.length,
    mutatedThisTurn: false,
  };
}

export function finishTurnState(
  conv: AgentConversation,
  outcome: { error?: string | null; aborted?: boolean } = {},
): AgentConversation {
  const interrupted = Boolean(outcome.error) || Boolean(outcome.aborted) || Boolean(conv.error);
  let toolCalls = conv.toolCalls;
  if (interrupted) {
    for (const call of Object.values(conv.toolCalls)) {
      if (call.status === "pending") {
        toolCalls = { ...toolCalls, [call.id]: { ...call, status: "error", summary: call.summary ?? "Interrupted" } };
      }
    }
  }
  let messages = conv.messages;
  const dangling = unansweredToolCallIds(messages);
  if (dangling.length > 0) {
    messages = [
      ...messages,
      ...dangling.map((id): AgentMessage => ({ role: "tool", tool_call_id: id, content: INTERRUPTED_TOOL_RESULT })),
    ];
  }
  return {
    ...conv,
    messages,
    toolCalls,
    isStreaming: false,
    stopped: Boolean(outcome.aborted),
    error: outcome.error ?? conv.error,
    pendingUserText: outcome.error || conv.error ? conv.pendingUserText : null,
  };
}

export function prepareRetryState(conv: AgentConversation): { conv: AgentConversation; text: string | null } {
  if (!conv.lastUserText) return { conv, text: null };
  const committedSinceStart = conv.messages.length - conv.turnStartIndex;
  const onlyUserCommitted =
    committedSinceStart === 0 ||
    (committedSinceStart === 1 && conv.messages[conv.turnStartIndex]?.role === "user");
  if (onlyUserCommitted) {
    return {
      conv: { ...conv, messages: conv.messages.slice(0, conv.turnStartIndex), lastPageText: null, error: null },
      text: conv.lastUserText,
    };
  }
  return { conv: { ...conv, error: null }, text: CONTINUE_PROMPT };
}

interface AgentChatState {
  conversations: Record<string, AgentConversation>;
  model: string | null;
  effort: AgentEffort | null;
  setModel: (model: string | null) => void;
  setEffort: (effort: AgentEffort | null) => void;
  update: (projectId: string, fn: (conv: AgentConversation) => AgentConversation) => void;
  beginTurn: (projectId: string, userText: string, pageText: string) => void;
  applyEvent: (projectId: string, event: AgentStreamEvent) => void;
  finishTurn: (projectId: string, outcome?: { error?: string | null; aborted?: boolean }) => void;
  dismissError: (projectId: string) => void;
  newChat: (projectId: string) => void;
}

export const useAgentChatStore = create<AgentChatState>()((set) => {
  const update = (projectId: string, fn: (conv: AgentConversation) => AgentConversation) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [projectId]: fn(state.conversations[projectId] ?? EMPTY_CONVERSATION),
      },
    }));
  return {
    conversations: {},
    model: null,
    effort: null,
    setModel: (model) => set({ model }),
    setEffort: (effort) => set({ effort }),
    update,
    beginTurn: (projectId, userText, pageText) => update(projectId, (c) => beginTurnState(c, userText, pageText)),
    applyEvent: (projectId, event) => update(projectId, (c) => reduceAgentEvent(c, event)),
    finishTurn: (projectId, outcome) => update(projectId, (c) => finishTurnState(c, outcome)),
    dismissError: (projectId) => update(projectId, (c) => ({ ...c, error: null, pendingUserText: null })),
    newChat: (projectId) =>
      set((state) => {
        const conversations = { ...state.conversations };
        delete conversations[projectId];
        return { conversations };
      }),
  };
});

export function useAgentConversation(projectId: string): AgentConversation {
  return useAgentChatStore((s) => s.conversations[projectId] ?? EMPTY_CONVERSATION);
}

const controllers = new Map<string, AbortController>();

export interface SendAgentMessageOptions {
  projectId: string;
  branch?: string;
  text: string;
  buildContext: (lastPageText: string | null) => { context: string; pageText: string };
  /** A tool call changed project state (any `tool_result` with `mutated: true`). */
  onProjectChanged?: () => void;
  /**
   * A tool call committed to the ontology. Also called with `commit_hash: null` when the
   * stream stopped while a tool was still running, since it may have committed.
   */
  onOntologyChanged?: (change: AgentOntologyChange) => void;
  /** The agent asked the editor to do something, such as select an entity. */
  onUiAction?: (action: AgentUiAction) => void;
}

export async function sendAgentMessage({
  projectId,
  branch,
  text,
  buildContext,
  onProjectChanged,
  onOntologyChanged,
  onUiAction,
}: SendAgentMessageOptions): Promise<void> {
  const store = useAgentChatStore.getState();
  const before = store.conversations[projectId] ?? EMPTY_CONVERSATION;
  if (before.isStreaming) return;
  const { context, pageText } = buildContext(before.lastPageText);
  const history = before.messages;
  store.beginTurn(projectId, text, pageText);

  const controller = new AbortController();
  controllers.set(projectId, controller);
  let errorMessage: string | null = null;
  let aborted = false;
  const runningTools = new Map<string, string>();

  try {
    await streamAgentChat({
      projectId,
      branch,
      messages: history,
      userMessage: text,
      pageContext: context,
      model: useAgentChatStore.getState().model ?? undefined,
      signal: controller.signal,
      onEvent: (event) => {
        if (controllers.get(projectId) !== controller) return;
        useAgentChatStore.getState().applyEvent(projectId, event);
        if (event.type === "tool_use") {
          runningTools.set(event.id, event.name);
        } else if (event.type === "tool_result") {
          runningTools.delete(event.tool_use_id);
          if (event.mutated) onProjectChanged?.();
        } else if (event.type === "ontology_changed") {
          onOntologyChanged?.(event);
        } else if (event.type === "ui_action") {
          onUiAction?.(event.action);
        }
      },
    });
  } catch (err) {
    if (controller.signal.aborted) {
      aborted = true;
    } else if (err instanceof AgentChatError) {
      errorMessage = err.message;
    } else {
      errorMessage = err instanceof Error ? err.message : "The agent request failed";
    }
  } finally {
    if (controllers.get(projectId) === controller) {
      controllers.delete(projectId);
      useAgentChatStore.getState().finishTurn(projectId, { error: errorMessage, aborted });
    }
    // A tool that was still running when the stream stopped may have committed before
    // the server noticed; refresh once in case it did.
    const [interrupted] = runningTools;
    if (interrupted) {
      onProjectChanged?.();
      onOntologyChanged?.({
        tool_use_id: interrupted[0],
        name: interrupted[1],
        branch: branch ?? "",
        commit_hash: null,
        deleted_iris: [],
      });
    }
  }
}

export function stopAgentMessage(projectId: string): void {
  controllers.get(projectId)?.abort();
}

export function startNewAgentChat(projectId: string): void {
  const controller = controllers.get(projectId);
  if (controller) {
    controllers.delete(projectId);
    controller.abort();
  }
  useAgentChatStore.getState().newChat(projectId);
}

export async function retryAgentMessage(options: Omit<SendAgentMessageOptions, "text">): Promise<void> {
  const state = useAgentChatStore.getState();
  const conv = state.conversations[options.projectId];
  if (!conv || conv.isStreaming) return;
  const { conv: next, text } = prepareRetryState(conv);
  if (!text) return;
  state.update(options.projectId, () => next);
  await sendAgentMessage({ ...options, text });
}
