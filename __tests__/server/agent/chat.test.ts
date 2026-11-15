import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { createPizzaProject, parseSse, removeDir, useTempDataDir, type AppLike } from "./helpers";
import type { AgentClient, AgentRequestBody } from "@/server/agent/chat";

type ChunkSpec = {
  content?: string;
  reasoning?: string;
  reasoning_details?: Record<string, unknown>[];
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
  finish_reason?: string | null;
};

function chunk(spec: ChunkSpec): ChatCompletionChunk {
  const { finish_reason = null, ...delta } = spec;
  return {
    id: "gen-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "test",
    choices: [{ index: 0, delta, finish_reason, logprobs: null }],
  } as unknown as ChatCompletionChunk;
}

function mockClient(turns: ChatCompletionChunk[][]) {
  const bodies: AgentRequestBody[] = [];
  const signals: AbortSignal[] = [];
  const client: AgentClient = {
    async createStream(body, signal) {
      bodies.push(JSON.parse(JSON.stringify(body)));
      signals.push(signal);
      const chunks = turns[bodies.length - 1] ?? [chunk({ content: "?", finish_reason: "stop" })];
      return (async function* () {
        for (const c of chunks) yield c;
      })();
    },
  };
  return { client, bodies, signals };
}

const NS = "http://example.org/pizza#";

let dataDir: string;
let app: AppLike;
let projectId: string;
let setAgentClientFactory: (f: ((key: string) => AgentClient) | null) => void;
let clearAgentModelsCache: () => void;
let createOpenRouterClient: (apiKey: string, fetchImpl?: typeof fetch) => AgentClient;
const savedKey = process.env.OPENROUTER_API_KEY;

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
  const routes = await import("@/server/routes/agent");
  setAgentClientFactory = routes.setAgentClientFactory;
  clearAgentModelsCache = routes.clearAgentModelsCache;
  createOpenRouterClient = (await import("@/server/agent/chat")).createOpenRouterClient;
  projectId = await createPizzaProject(app);
}, 30_000);

afterAll(() => {
  setAgentClientFactory(null);
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  removeDir(dataDir);
});

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-test-key";
  clearAgentModelsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function chat(body: Record<string, unknown>, branch = "main") {
  const res = await app.request(`/api/v1/projects/${projectId}/agent/chat?branch=${branch}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

describe("POST /projects/:id/agent/chat", () => {
  it("returns 400 JSON before streaming when no key is configured", async () => {
    process.env.OPENROUTER_API_KEY = "   ";
    const res = await chat({ messages: [], user_message: "hi", page_context: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toMatch(/^No OPENROUTER_API_KEY in .*\.env\.local$/);
  });

  it("validates the body", async () => {
    const res = await chat({ messages: [{ role: "system", content: "x" }], user_message: "hi" });
    expect(res.status).toBe(422);
    const empty = await chat({ messages: [], user_message: "" });
    expect(empty.status).toBe(422);
  });

  it("streams the tool loop in order and flags mutations", async () => {
    const args = JSON.stringify({ entity_type: "class", label: "Hawaiian", parent_iri: `${NS}Pizza` });
    const { client, bodies } = mockClient([
      [
        chunk({ reasoning: "Need a new class.", reasoning_details: [{ type: "reasoning.text", index: 0, text: "Need a " }] }),
        chunk({ reasoning_details: [{ type: "reasoning.text", index: 0, text: "new class.", signature: "sig" }] }),
        chunk({ content: "Adding it." }),
        chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "create_entity", arguments: args.slice(0, 10) } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(10) } }] }),
        chunk({ tool_calls: [{ index: 1, id: "call_2", function: { name: "get_entity", arguments: "{\"iri\":" } }] }),
        chunk({ tool_calls: [{ index: 1, function: { arguments: ` "${NS}Pizza"}` } }], finish_reason: "tool_calls" }),
      ],
      [chunk({ content: "Done: " }), chunk({ content: "created Hawaiian.", finish_reason: "stop" })],
    ]);
    setAgentClientFactory((key) => {
      expect(key).toBe("sk-or-test-key");
      return client;
    });

    const prior = [
      { role: "user", content: [{ type: "text", text: "earlier" }] },
      { role: "assistant", content: "earlier answer" },
    ];
    const res = await chat({
      messages: prior,
      user_message: "Add a Hawaiian pizza under this class",
      page_context: "URL: /projects/x\nSelected: Pizza",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await res.text());

    expect(events.map((e) => e.event)).toEqual([
      "message",
      "thinking",
      "thinking",
      "text",
      "message",
      "tool_use",
      "tool_result",
      "message",
      "tool_use",
      "tool_result",
      "message",
      "text",
      "text",
      "message",
      "done",
    ]);

    const [userMsg, , , , assistant1, toolUse1, toolResult1, toolMsg1, , toolResult2, toolMsg2, , , assistant2, done] =
      events.map((e) => e.data as Record<string, unknown>);

    expect(userMsg.message).toEqual({
      role: "user",
      content: [
        { type: "text", text: "<page_context>\nURL: /projects/x\nSelected: Pizza\n</page_context>" },
        { type: "text", text: "Add a Hawaiian pizza under this class" },
      ],
    });
    expect(assistant1.message).toEqual({
      role: "assistant",
      content: "Adding it.",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "create_entity", arguments: args } },
        { id: "call_2", type: "function", function: { name: "get_entity", arguments: `{"iri": "${NS}Pizza"}` } },
      ],
      reasoning_details: [{ type: "reasoning.text", index: 0, text: "Need a new class.", signature: "sig" }],
    });
    expect(toolUse1).toEqual({ id: "call_1", name: "create_entity", input: JSON.parse(args) });
    expect(toolResult1).toEqual({
      tool_use_id: "call_1",
      name: "create_entity",
      is_error: false,
      summary: "Created class Hawaiian",
      mutated: true,
    });
    expect((toolMsg1.message as { role: string; tool_call_id: string }).tool_call_id).toBe("call_1");
    expect(JSON.parse((toolMsg1.message as { content: string }).content).iri).toBe(`${NS}Hawaiian`);
    expect(toolResult2).toMatchObject({ tool_use_id: "call_2", name: "get_entity", is_error: false, mutated: false });
    expect((toolMsg2.message as { role: string }).role).toBe("tool");
    expect(assistant2.message).toEqual({ role: "assistant", content: "Done: created Hawaiian." });
    expect(done).toEqual({ stop_reason: "stop" });

    expect(bodies).toHaveLength(2);
    const first = bodies[0];
    expect(first.model).toBe("anthropic/claude-opus-5.5");
    expect(first.stream).toBe(true);
    expect(first.tool_choice).toBe("auto");
    expect(first.reasoning).toEqual({ effort: "high" });
    expect(first.tools?.length).toBeGreaterThan(30);
    expect(first.tools?.[0]).toMatchObject({ type: "function", function: { name: "get_project" } });
    const system = first.messages[0] as { role: string; content: { type: string; text: string; cache_control?: unknown }[] };
    expect(system.role).toBe("system");
    expect(system.content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system.content[0].text).toContain(`Current project id: ${projectId}`);
    expect(system.content[0].text).toContain("Current branch: main");
    expect(first.messages.slice(1, 3)).toEqual(prior);

    const second = bodies[1];
    expect(second.messages[0]).toEqual(first.messages[0]);
    expect(second.messages.slice(1)).toEqual([
      ...prior,
      userMsg.message,
      assistant1.message,
      toolMsg1.message,
      toolMsg2.message,
    ]);

    const search = await app.request(`/api/v1/projects/${projectId}/ontology/search?q=Hawaiian&branch=main`);
    expect(((await search.json()) as { total: number }).total).toBe(1);
  });

  it("returns error tool results for invalid JSON and schema failures, and honors the model override", async () => {
    const { client, bodies } = mockClient([
      [
        chunk({ tool_calls: [{ index: 0, id: "bad_json", function: { name: "get_entity", arguments: "{\"iri\": " } }] }),
        chunk({ tool_calls: [{ index: 1, id: "bad_schema", function: { name: "get_entity", arguments: "{\"iri\": 5}" } }] }),
        chunk({ finish_reason: "tool_calls" }),
      ],
      [chunk({ content: "Sorry.", finish_reason: "stop" })],
    ]);
    setAgentClientFactory(() => client);
    const res = await chat({ messages: [], user_message: "x", page_context: "", model: "openai/gpt-5" });
    const events = parseSse(await res.text());
    const results = events.filter((e) => e.event === "tool_result").map((e) => e.data as Record<string, unknown>);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ tool_use_id: "bad_json", is_error: true, mutated: false });
    expect(String(results[0].summary)).toMatch(/Invalid JSON arguments/);
    expect(results[1]).toMatchObject({ tool_use_id: "bad_schema", is_error: true });
    expect(String(results[1].summary)).toContain("iri must be string");
    const uses = events.filter((e) => e.event === "tool_use").map((e) => e.data as Record<string, unknown>);
    expect(uses[0].input).toBe("{\"iri\": ");
    expect(bodies[0].model).toBe("openai/gpt-5");
    expect(typeof (bodies[0].messages[0] as { content: unknown }).content).toBe("string");
    expect(events.at(-1)).toEqual({ event: "done", data: { stop_reason: "stop" } });
  });

  it("stops with an error when a tool call is truncated by the length limit", async () => {
    const { client, bodies } = mockClient([
      [
        chunk({ content: "Writing" }),
        chunk({ tool_calls: [{ index: 0, id: "c", function: { name: "replace_source", arguments: "{\"content\": \"@pre" } }], finish_reason: "length" }),
      ],
    ]);
    setAgentClientFactory(() => client);
    const events = parseSse(await (await chat({ messages: [], user_message: "x" })).text());
    expect(events.map((e) => e.event)).toEqual(["message", "text", "error", "done"]);
    expect(events[3].data).toEqual({ stop_reason: "length" });
    expect(bodies).toHaveLength(1);
  });

  it("reports content filter and provider errors", async () => {
    const filtered = mockClient([[chunk({ content: "Par", finish_reason: "content_filter" })]]);
    setAgentClientFactory(() => filtered.client);
    const events = parseSse(await (await chat({ messages: [], user_message: "x" })).text());
    expect(events.map((e) => e.event)).toEqual(["message", "text", "message", "error", "done"]);
    expect(events[4].data).toEqual({ stop_reason: "content_filter" });

    const providerError = {
      async createStream() {
        return (async function* () {
          yield { ...chunk({}), error: { message: "Upstream overloaded", code: 502 } } as ChatCompletionChunk;
        })();
      },
    } satisfies AgentClient;
    setAgentClientFactory(() => providerError);
    const errEvents = parseSse(await (await chat({ messages: [], user_message: "x" })).text());
    expect(errEvents.map((e) => e.event)).toEqual(["message", "error"]);
    expect(errEvents[1].data).toEqual({ detail: "Upstream overloaded" });
  });

  it("caps the loop at 40 model turns", async () => {
    let calls = 0;
    const looping: AgentClient = {
      async createStream() {
        calls++;
        return (async function* () {
          yield chunk({
            tool_calls: [{ index: 0, id: `c${calls}`, function: { name: "get_project", arguments: "{}" } }],
            finish_reason: "tool_calls",
          });
        })();
      },
    };
    setAgentClientFactory(() => looping);
    const events = parseSse(await (await chat({ messages: [], user_message: "x" })).text());
    expect(calls).toBe(40);
    expect(events.at(-2)?.event).toBe("error");
    expect(events.at(-1)).toEqual({ event: "done", data: { stop_reason: "max_turns" } });
  }, 30_000);

  it("passes an abort signal that fires when the client disconnects", async () => {
    let seen: AbortSignal | null = null;
    const hanging: AgentClient = {
      async createStream(_body, signal) {
        seen = signal;
        return (async function* () {
          yield chunk({ content: "partial" });
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        })();
      },
    };
    setAgentClientFactory(() => hanging);
    const controller = new AbortController();
    const res = await app.request(`/api/v1/projects/${projectId}/agent/chat?branch=main`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [], user_message: "x" }),
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("partial")) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value);
    }
    await reader.cancel();
    controller.abort();
    await vi.waitFor(() => expect((seen as AbortSignal | null)?.aborted).toBe(true));
  });
});

describe("OpenRouter client", () => {
  it("sends the OpenRouter request shape through the openai SDK", async () => {
    const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input instanceof Request ? input.url : input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      const sse =
        `data: ${JSON.stringify(chunk({ content: "Hi" }))}\n\n` +
        `data: ${JSON.stringify(chunk({ finish_reason: "stop" }))}\n\n` +
        "data: [DONE]\n\n";
      return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;
    vi.stubGlobal("window", undefined);
    const client = createOpenRouterClient("sk-or-abc", fakeFetch);
    const stream = await client.createStream(
      {
        model: "anthropic/claude-opus-5.5",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
        tool_choice: "auto",
        reasoning: { effort: "low" },
      },
      new AbortController().signal,
    );
    const got: ChatCompletionChunk[] = [];
    for await (const c of stream) got.push(c);
    expect(got.map((c) => c.choices[0].delta.content ?? null)).toEqual(["Hi", null]);
    expect(requests[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(requests[0].headers.get("authorization")).toBe("Bearer sk-or-abc");
    expect(requests[0].headers.get("http-referer")).toBe("http://localhost:3000");
    expect(requests[0].headers.get("x-title")).toBe("OntoKit");
    expect(requests[0].body.reasoning).toEqual({ effort: "low" });
  });
});

describe("agent settings, status, models and test endpoints", () => {
  const modelsPayload = {
    data: [
      {
        id: "z-ai/zeta",
        name: "Zeta",
        context_length: 1000,
        pricing: { prompt: "0.000003", completion: "0.000015" },
        supported_parameters: ["tools", "reasoning"],
      },
      { id: "acme/alpha", name: "Alpha", pricing: {}, supported_parameters: ["tools"] },
      { id: "acme/notools", name: "No tools", supported_parameters: ["temperature"] },
      { id: "acme/alpha:batch", name: "Alpha batch", supported_parameters: ["tools"] },
      {
        id: "anthropic/claude-opus-5.5",
        name: "Anthropic: Claude Opus 5.5",
        context_length: 200000,
        pricing: { prompt: "0.000005", completion: "0.000025" },
        supported_parameters: ["tools", "reasoning"],
      },
    ],
  };

  function stubFetch(keyStatus: number) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) return Response.json(modelsPayload);
      if (url.endsWith("/key")) {
        const auth = new Headers(init?.headers).get("authorization");
        return keyStatus === 200 && auth === "Bearer sk-or-test-key"
          ? Response.json({ data: { label: "test" } })
          : Response.json({ error: { message: "No auth" } }, { status: keyStatus });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("reports status without leaking the key", async () => {
    const res = await app.request("/api/v1/agent/status");
    const text = await res.text();
    expect(text).not.toContain("sk-or-test-key");
    const body = JSON.parse(text);
    expect(body.configured).toBe(true);
    expect(body.secrets_file).toMatch(/\.env\.local$/);
    expect(body.api_key_env).toBe("OPENROUTER_API_KEY");
    expect(body.settings).toEqual({ model: "anthropic/claude-opus-5.5", effort: "high", custom_instructions: "" });
    process.env.OPENROUTER_API_KEY = "";
    expect(((await (await app.request("/api/v1/agent/status")).json()) as { configured: boolean }).configured).toBe(false);
  });

  it("validates and merges settings without clobbering other keys", async () => {
    await app.request("/api/v1/users/me/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "dark" }),
    });
    const patch = (body: unknown) =>
      app.request("/api/v1/agent/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await patch({ effort: "max" })).status).toBe(422);
    expect((await patch({ model: "" })).status).toBe(422);
    expect((await patch({ model: "x".repeat(201) })).status).toBe(422);
    expect((await patch({ custom_instructions: "x".repeat(4001) })).status).toBe(422);
    const ok = await patch({ effort: "low", custom_instructions: "Use British spelling." });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      settings: { model: "anthropic/claude-opus-5.5", effort: "low", custom_instructions: "Use British spelling." },
    });
    const ok2 = await patch({ model: "openai/gpt-5" });
    expect(((await ok2.json()) as { settings: { effort: string; model: string } }).settings).toEqual({
      model: "openai/gpt-5",
      effort: "low",
      custom_instructions: "Use British spelling.",
    });
    const all = (await (await app.request("/api/v1/users/me/settings")).json()) as { settings: Record<string, unknown> };
    expect(all.settings.theme).toBe("dark");

    const { client, bodies } = mockClient([[chunk({ content: "ok", finish_reason: "stop" })]]);
    setAgentClientFactory(() => client);
    await (await chat({ messages: [], user_message: "x" })).text();
    expect(bodies[0].model).toBe("openai/gpt-5");
    expect(bodies[0].reasoning).toEqual({ effort: "low" });
    const system = bodies[0].messages[0] as { content: string };
    expect(system.content).toContain("Additional instructions from the user:\nUse British spelling.");

    await patch({ model: "anthropic/claude-opus-5.5", effort: "high", custom_instructions: "" });
  });

  it("lists tool-capable models with per-million pricing and caches them", async () => {
    const fetchMock = stubFetch(200);
    const res = await app.request("/api/v1/agent/models");
    const body = (await res.json()) as { models: Record<string, unknown>[] };
    expect(body.models.map((m) => m.id)).toEqual(["acme/alpha", "anthropic/claude-opus-5.5", "z-ai/zeta"]);
    expect(body.models[2]).toEqual({
      id: "z-ai/zeta",
      name: "Zeta",
      context_length: 1000,
      prompt_price_per_million: 3,
      completion_price_per_million: 15,
      supports_reasoning: true,
    });
    expect(body.models[0]).toMatchObject({ prompt_price_per_million: null, context_length: null, supports_reasoning: false });
    await app.request("/api/v1/agent/models");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tests the key against OpenRouter", async () => {
    stubFetch(200);
    const ok = await app.request("/api/v1/agent/test", { method: "POST" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, model: "anthropic/claude-opus-5.5" });

    clearAgentModelsCache();
    stubFetch(401);
    const rejected = await app.request("/api/v1/agent/test", { method: "POST" });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ detail: "OpenRouter rejected the API key" });

    process.env.OPENROUTER_API_KEY = "";
    const missing = await app.request("/api/v1/agent/test", { method: "POST" });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { detail: string }).detail).toMatch(/^No OPENROUTER_API_KEY in /);
  });
});
