const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface AgentTextPart {
  type: "text";
  text: string;
}

export interface AgentToolCallSpec {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AgentUserMessage {
  role: "user";
  content: string | Array<AgentTextPart | { type: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface AgentAssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: AgentToolCallSpec[];
  reasoning_details?: unknown;
  [key: string]: unknown;
}

export interface AgentToolMessage {
  role: "tool";
  tool_call_id: string;
  content: unknown;
  [key: string]: unknown;
}

export interface AgentSystemMessage {
  role: "system";
  content: unknown;
  [key: string]: unknown;
}

export type AgentMessage = AgentUserMessage | AgentAssistantMessage | AgentToolMessage | AgentSystemMessage;

export interface SSEEvent {
  event: string;
  data: string;
}

export type AgentStreamEvent =
  | { type: "message"; message: AgentMessage }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; name: string; is_error: boolean; summary: string; mutated: boolean }
  | { type: "done"; stop_reason: string | null }
  | { type: "error"; detail: string };

export class AgentChatError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AgentChatError";
  }
}

export class SSEParser {
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];

  feed(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];
    let newline = this.findLineEnd();
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      const skip = this.buffer[newline] === "\r" && this.buffer[newline + 1] === "\n" ? 2 : 1;
      this.buffer = this.buffer.slice(newline + skip);
      const evt = this.processLine(line);
      if (evt) events.push(evt);
      newline = this.findLineEnd();
    }
    return events;
  }

  flush(): SSEEvent[] {
    const events: SSEEvent[] = [];
    if (this.buffer) {
      const evt = this.processLine(this.buffer);
      this.buffer = "";
      if (evt) events.push(evt);
    }
    const last = this.dispatch();
    if (last) events.push(last);
    return events;
  }

  private findLineEnd(): number {
    for (let i = 0; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      if (c === "\n") return i;
      if (c === "\r") {
        if (i === this.buffer.length - 1) return -1;
        return i;
      }
    }
    return -1;
  }

  private processLine(line: string): SSEEvent | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.eventName = value;
    else if (field === "data") this.dataLines.push(value);
    return null;
  }

  private dispatch(): SSEEvent | null {
    if (this.dataLines.length === 0) {
      this.eventName = "";
      return null;
    }
    const evt = { event: this.eventName || "message", data: this.dataLines.join("\n") };
    this.eventName = "";
    this.dataLines = [];
    return evt;
  }
}

export function toAgentStreamEvent(raw: SSEEvent): AgentStreamEvent | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.data);
  } catch {
    return null;
  }
  switch (raw.event) {
    case "message":
      return { type: "message", message: data.message as AgentMessage };
    case "text":
      return { type: "text", text: String(data.text ?? "") };
    case "thinking":
      return { type: "thinking", text: String(data.text ?? "") };
    case "tool_use":
      return { type: "tool_use", id: String(data.id), name: String(data.name), input: data.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: String(data.tool_use_id),
        name: String(data.name ?? ""),
        is_error: Boolean(data.is_error),
        summary: String(data.summary ?? ""),
        mutated: Boolean(data.mutated),
      };
    case "done":
      return { type: "done", stop_reason: (data.stop_reason as string | null) ?? null };
    case "error":
      return { type: "error", detail: String(data.detail ?? "Unknown error") };
    default:
      return null;
  }
}

export interface StreamAgentChatOptions {
  projectId: string;
  branch?: string;
  messages: AgentMessage[];
  userMessage: string;
  pageContext: string;
  model?: string;
  signal?: AbortSignal;
  onEvent: (event: AgentStreamEvent) => void;
}

function buildChatUrl(projectId: string, branch?: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const url = new URL(`${API_BASE}/api/v1/projects/${encodeURIComponent(projectId)}/agent/chat`, origin);
  if (branch) url.searchParams.set("branch", branch);
  return url.toString();
}

async function readErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.detail === "string") return parsed.detail;
  } catch {
    return text || `${response.status} ${response.statusText}`;
  }
  return text || `${response.status} ${response.statusText}`;
}

export async function streamAgentChat({
  projectId,
  branch,
  messages,
  userMessage,
  pageContext,
  model,
  signal,
  onEvent,
}: StreamAgentChatOptions): Promise<void> {
  const response = await fetch(buildChatUrl(projectId, branch), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      messages,
      user_message: userMessage,
      page_context: pageContext,
      ...(model ? { model } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    throw new AgentChatError(response.status, await readErrorDetail(response));
  }
  if (!response.body) {
    throw new AgentChatError(response.status, "The server returned an empty response");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser();
  const emit = (raw: SSEEvent[]) => {
    for (const r of raw) {
      const evt = toAgentStreamEvent(r);
      if (evt) onEvent(evt);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      emit(parser.feed(decoder.decode(value, { stream: true })));
    }
    emit(parser.feed(decoder.decode()));
    emit(parser.flush());
  } finally {
    reader.releaseLock();
  }
}
