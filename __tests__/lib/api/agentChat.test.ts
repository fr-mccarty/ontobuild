import { describe, it, expect, vi, afterEach } from "vitest";
import { SSEParser, streamAgentChat, AgentChatError, type AgentStreamEvent } from "@/lib/api/agentChat";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("SSEParser", () => {
  it("parses multiple events in one chunk", () => {
    const p = new SSEParser();
    const events = p.feed('event: text\ndata: {"text":"a"}\n\nevent: done\ndata: {"stop_reason":"end_turn"}\n\n');
    expect(events).toEqual([
      { event: "text", data: '{"text":"a"}' },
      { event: "done", data: '{"stop_reason":"end_turn"}' },
    ]);
  });

  it("handles events split across chunk boundaries", () => {
    const p = new SSEParser();
    const out = [
      ...p.feed("eve"),
      ...p.feed("nt: text\nda"),
      ...p.feed('ta: {"te'),
      ...p.feed('xt":"hi"}\n'),
      ...p.feed("\n"),
    ];
    expect(out).toEqual([{ event: "text", data: '{"text":"hi"}' }]);
  });

  it("handles CRLF line endings split between chunks", () => {
    const p = new SSEParser();
    const out = [...p.feed("event: text\r"), ...p.feed('\ndata: {"text":"x"}\r\n\r\n')];
    expect(out).toEqual([{ event: "text", data: '{"text":"x"}' }]);
  });

  it("joins multi-line data and ignores comments", () => {
    const p = new SSEParser();
    const out = p.feed(": ping\nevent: error\ndata: line1\ndata: line2\n\n");
    expect(out).toEqual([{ event: "error", data: "line1\nline2" }]);
  });

  it("flushes a trailing event without a blank line", () => {
    const p = new SSEParser();
    expect(p.feed('event: done\ndata: {"stop_reason":null}')).toEqual([]);
    expect(p.flush()).toEqual([{ event: "done", data: '{"stop_reason":null}' }]);
  });
});

describe("streamAgentChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the request and emits typed events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        streamOf([
          'event: message\ndata: {"message":{"role":"user","content":"hi"}}\n\nevent: te',
          'xt\ndata: {"text":"Hel"}\n\nevent: text\ndata: {"text":"lo"}\n\n',
          'event: tool_result\ndata: {"tool_use_id":"t1","name":"x","is_error":false,"summary":"ok","mutated":true}\n\n',
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events: AgentStreamEvent[] = [];
    await streamAgentChat({
      projectId: "p1",
      branch: "main",
      messages: [],
      userMessage: "hi",
      pageContext: "ctx",
      model: "openai/gpt-x",
      onEvent: (e) => events.push(e),
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/projects/p1/agent/chat?branch=main");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      messages: [],
      user_message: "hi",
      page_context: "ctx",
      model: "openai/gpt-x",
    });
    expect(events.map((e) => e.type)).toEqual(["message", "text", "text", "tool_result"]);
    expect(events[3]).toMatchObject({ tool_use_id: "t1", mutated: true });
  });

  it("throws the detail from a JSON error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "No key" }), { status: 400 })),
    );
    await expect(
      streamAgentChat({ projectId: "p", messages: [], userMessage: "x", pageContext: "", onEvent: () => {} }),
    ).rejects.toEqual(new AgentChatError(400, "No key"));
  });
});
