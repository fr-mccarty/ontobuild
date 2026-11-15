import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/agentChat", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, streamAgentChat: vi.fn() };
});

import { streamAgentChat, type AgentMessage, type AgentStreamEvent } from "@/lib/api/agentChat";
import {
  EMPTY_CONVERSATION,
  INTERRUPTED_TOOL_RESULT,
  CONTINUE_PROMPT,
  beginTurnState,
  finishTurnState,
  prepareRetryState,
  reduceAgentEvent,
  visibleUserText,
  useAgentChatStore,
  sendAgentMessage,
  startNewAgentChat,
  type AgentConversation,
} from "@/lib/stores/agentChatStore";

const userMsg: AgentMessage = {
  role: "user",
  content: [
    { type: "text", text: "<page_context>\nURL: x\n</page_context>" },
    { type: "text", text: "Hello" },
  ],
};

const assistantWithTool: AgentMessage = {
  role: "assistant",
  content: "Looking",
  tool_calls: [{ id: "t1", type: "function", function: { name: "search_entities", arguments: '{"query":"Dog"}' } }],
};

function apply(conv: AgentConversation, ...events: AgentStreamEvent[]) {
  return events.reduce(reduceAgentEvent, conv);
}

describe("agentChatStore reducers", () => {
  beforeEach(() => {
    useAgentChatStore.setState({ conversations: {}, model: null, effort: null });
  });

  it("hides page context text from user messages", () => {
    expect(visibleUserText(userMsg)).toBe("Hello");
    expect(visibleUserText({ role: "user", content: "plain" })).toBe("plain");
  });

  it("starts a turn with pending user text and records page text", () => {
    const c = beginTurnState(EMPTY_CONVERSATION, "Hello", "page");
    expect(c).toMatchObject({ isStreaming: true, pendingUserText: "Hello", lastPageText: "page", turnStartIndex: 0 });
  });

  it("accumulates text and thinking and clears them on assistant message", () => {
    let c = beginTurnState(EMPTY_CONVERSATION, "Hello", "p");
    c = apply(c, { type: "message", message: userMsg });
    expect(c.pendingUserText).toBeNull();
    c = apply(c, { type: "thinking", text: "hmm " }, { type: "text", text: "Look" }, { type: "text", text: "ing" });
    expect(c.streamingText).toBe("Looking");
    expect(c.thinkingText).toBe("hmm ");
    c = apply(c, { type: "message", message: assistantWithTool });
    expect(c.streamingText).toBe("");
    expect(c.thinkingText).toBe("");
    expect(c.messages).toHaveLength(2);
  });

  it("tracks tool calls through tool_use and tool_result", () => {
    let c = beginTurnState(EMPTY_CONVERSATION, "Hello", "p");
    c = apply(c, { type: "tool_use", id: "t1", name: "add_class", input: { label: "Dog" } });
    expect(c.toolCalls.t1).toMatchObject({ status: "pending", name: "add_class" });
    expect(c.liveToolIds).toEqual(["t1"]);
    c = apply(c, {
      type: "tool_result",
      tool_use_id: "t1",
      name: "add_class",
      is_error: false,
      summary: "Added Dog",
      mutated: true,
    });
    expect(c.toolCalls.t1).toMatchObject({ status: "ok", summary: "Added Dog", input: { label: "Dog" } });
    expect(c.mutatedThisTurn).toBe(true);
    c = apply(c, { type: "tool_result", tool_use_id: "t2", name: "x", is_error: true, summary: "bad", mutated: false });
    expect(c.toolCalls.t2.status).toBe("error");
  });

  it("appends tool messages verbatim and marks pending calls ok", () => {
    let c = apply(EMPTY_CONVERSATION, { type: "tool_use", id: "t1", name: "x", input: {} });
    const toolMsg: AgentMessage = { role: "tool", tool_call_id: "t1", content: "result" };
    c = apply(c, { type: "message", message: toolMsg });
    expect(c.messages[0]).toBe(toolMsg);
    expect(c.toolCalls.t1.status).toBe("ok");
  });

  it("closes unanswered tool calls when a turn is interrupted", () => {
    let c = beginTurnState(EMPTY_CONVERSATION, "Hello", "p");
    c = apply(
      c,
      { type: "message", message: userMsg },
      { type: "tool_use", id: "t1", name: "search_entities", input: {} },
      { type: "message", message: assistantWithTool },
    );
    c = finishTurnState(c, { aborted: true });
    expect(c.isStreaming).toBe(false);
    expect(c.stopped).toBe(true);
    expect(c.messages[2]).toEqual({ role: "tool", tool_call_id: "t1", content: INTERRUPTED_TOOL_RESULT });
    expect(c.toolCalls.t1.status).toBe("error");
  });

  it("records errors from error events", () => {
    let c = beginTurnState(EMPTY_CONVERSATION, "Hello", "p");
    c = apply(c, { type: "error", detail: "boom" });
    c = finishTurnState(c);
    expect(c.error).toBe("boom");
    expect(c.pendingUserText).toBe("Hello");
  });

  it("retry rolls back when only the user message was committed", () => {
    let c = beginTurnState(EMPTY_CONVERSATION, "Hello", "p");
    c = apply(c, { type: "message", message: userMsg });
    c = finishTurnState(c, { error: "fail" });
    const r = prepareRetryState(c);
    expect(r.text).toBe("Hello");
    expect(r.conv.messages).toHaveLength(0);
    expect(r.conv.error).toBeNull();
  });

  it("retry continues when the assistant already replied", () => {
    let c = beginTurnState(EMPTY_CONVERSATION, "Hello", "p");
    c = apply(c, { type: "message", message: userMsg }, { type: "message", message: assistantWithTool });
    c = finishTurnState(c, { error: "fail" });
    expect(prepareRetryState(c).text).toBe(CONTINUE_PROMPT);
  });

  it("sendAgentMessage streams into the store, sends the model and reports mutations", async () => {
    useAgentChatStore.getState().setModel("openai/gpt-x");
    vi.mocked(streamAgentChat).mockImplementation(async ({ onEvent }) => {
      onEvent({ type: "message", message: userMsg });
      onEvent({ type: "tool_result", tool_use_id: "t1", name: "x", is_error: false, summary: "", mutated: true });
      onEvent({ type: "done", stop_reason: "stop" });
    });
    const onProjectChanged = vi.fn();
    const buildContext = vi.fn().mockReturnValue({ context: "ctx", pageText: "pt" });
    await sendAgentMessage({ projectId: "p1", text: "Hello", buildContext, onProjectChanged });
    expect(buildContext).toHaveBeenCalledWith(null);
    expect(vi.mocked(streamAgentChat).mock.calls[0][0]).toMatchObject({
      projectId: "p1",
      userMessage: "Hello",
      pageContext: "ctx",
      model: "openai/gpt-x",
      messages: [],
    });
    expect(onProjectChanged).toHaveBeenCalledTimes(2);
    const conv = useAgentChatStore.getState().conversations.p1;
    expect(conv.isStreaming).toBe(false);
    expect(conv.messages).toHaveLength(1);
    expect(conv.lastPageText).toBe("pt");
  });

  it("new chat clears only that project's conversation", () => {
    const s = useAgentChatStore.getState();
    s.beginTurn("a", "x", "p");
    s.beginTurn("b", "y", "p");
    startNewAgentChat("a");
    expect(useAgentChatStore.getState().conversations.a).toBeUndefined();
    expect(useAgentChatStore.getState().conversations.b).toBeDefined();
  });
});
