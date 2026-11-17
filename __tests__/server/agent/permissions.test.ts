// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { createPizzaProject, parseSse, removeDir, useTempDataDir, type AppLike } from "./helpers";
import type { AgentClient, AgentRequestBody } from "@/server/agent/chat";
import type { AgentPermissions, ToolClass, ToolDef } from "@/server/agent/tools";

function chunk(delta: Record<string, unknown>, finish_reason: string | null = null): ChatCompletionChunk {
  return {
    id: "gen-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "test",
    choices: [{ index: 0, delta, finish_reason, logprobs: null }],
  } as unknown as ChatCompletionChunk;
}

/** A fake model that calls the given tools in its first turn and then stops. */
function scriptedClient(calls: { name: string; input: Record<string, unknown> }[] = []) {
  const bodies: AgentRequestBody[] = [];
  const turns: ChatCompletionChunk[][] = [];
  if (calls.length) {
    turns.push([
      ...calls.map((c, i) =>
        chunk({ tool_calls: [{ index: i, id: `call_${i}`, function: { name: c.name, arguments: JSON.stringify(c.input) } }] }),
      ),
      chunk({}, "tool_calls"),
    ]);
  }
  const client: AgentClient = {
    async createStream(body) {
      bodies.push(JSON.parse(JSON.stringify(body)));
      const chunks = turns[bodies.length - 1] ?? [chunk({ content: "ok" }, "stop")];
      return (async function* () {
        for (const c of chunks) yield c;
      })();
    },
  };
  return { client, bodies };
}

let dataDir: string;
let app: AppLike;
let projectId: string;
let folder: string;
let tools: ToolDef[];
let setAgentClientFactory: (f: ((key: string) => AgentClient) | null) => void;
const savedKey = process.env.OPENROUTER_API_KEY;

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
  setAgentClientFactory = (await import("@/server/routes/agent")).setAgentClientFactory;
  tools = (await import("@/server/agent/tools")).AGENT_TOOLS;
  projectId = await createPizzaProject(app);
  folder = (await import("@/server/git")).workTreePath(projectId);
}, 30_000);

afterAll(() => {
  setAgentClientFactory(null);
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  removeDir(dataDir);
});

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-test-key";
});

async function chat(permissions: Partial<AgentPermissions> | undefined, calls: { name: string; input: Record<string, unknown> }[] = []) {
  const { client, bodies } = scriptedClient(calls);
  setAgentClientFactory(() => client);
  const body: Record<string, unknown> = { messages: [], user_message: "do it", page_context: "" };
  if (permissions !== undefined) body.permissions = permissions;
  const res = await app.request(`/api/v1/projects/${projectId}/agent/chat?branch=main`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  const events = parseSse(await res.text());
  const results = events
    .filter((e) => e.event === "message" && (e.data as { message: { role: string } }).message.role === "tool")
    .map((e) => JSON.parse((e.data as { message: { content: string } }).message.content) as Record<string, unknown>);
  const summaries = events.filter((e) => e.event === "tool_result").map((e) => e.data as Record<string, unknown>);
  const system = bodies[0].messages[0] as { content: string | { text: string }[] };
  const systemText = typeof system.content === "string" ? system.content : system.content.map((p) => p.text).join("");
  return { events, bodies, results, summaries, systemText, toolNames: (bodies[0].tools ?? []).map((t) => (t as { function: { name: string } }).function.name) };
}

async function source(): Promise<string> {
  const res = await app.request(`/api/v1/projects/${projectId}/source?branch=main`);
  expect(res.ok).toBe(true);
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { content?: string };
    return data.content ?? text;
  } catch {
    return text;
  }
}

function namesOf(kinds: ToolClass[]): string[] {
  return tools.filter((t) => kinds.includes(t.kind)).map((t) => t.name).sort();
}

const ONTOLOGY_REFUSAL = "Editing the ontology is turned off for this conversation. Ask the user to turn on Edit Ontology.";
const CODE_REFUSAL = "Editing code is turned off for this conversation. Ask the user to turn on Edit Code.";

describe("tool classification", () => {
  it("gives every tool a known class", () => {
    for (const t of tools) expect(["read", "ontology", "code"], t.name).toContain(t.kind);
  });

  it("classifies the mutating tools", () => {
    expect(namesOf(["code"])).toEqual(["delete_file", "run_command", "write_file"]);
    const ontology = namesOf(["ontology"]);
    for (const n of [
      "create_entity",
      "update_class",
      "update_property",
      "update_individual",
      "delete_entity",
      "edit_source",
      "replace_source",
      "normalize",
      "update_project",
      "update_lint_config",
      "create_branch",
      "create_pull_request",
      "merge_pull_request",
      "close_pull_request",
      "comment_on_pull_request",
    ]) {
      expect(ontology).toContain(n);
    }
    const read = namesOf(["read"]);
    for (const n of ["get_entity", "search_entities", "get_source", "switch_branch", "list_files", "read_file", "run_lint"]) {
      expect(read).toContain(n);
    }
  });
});

describe("permissions decide the tool list", () => {
  const cases: [AgentPermissions, ToolClass[]][] = [
    [{ edit_ontology: true, edit_code: true }, ["read", "ontology", "code"]],
    [{ edit_ontology: true, edit_code: false }, ["read", "ontology"]],
    [{ edit_ontology: false, edit_code: true }, ["read", "code"]],
    [{ edit_ontology: false, edit_code: false }, ["read"]],
  ];
  for (const [permissions, kinds] of cases) {
    it(`edit_ontology=${permissions.edit_ontology} edit_code=${permissions.edit_code} offers only ${kinds.join(", ")} tools`, async () => {
      const { toolNames, systemText } = await chat(permissions);
      expect([...toolNames].sort()).toEqual(namesOf(kinds));
      expect(systemText).toContain(`Edit Ontology: ${permissions.edit_ontology ? "ON" : "OFF"}`);
      expect(systemText).toContain(`Edit Code: ${permissions.edit_code ? "ON" : "OFF"}`);
      if (!permissions.edit_ontology && !permissions.edit_code) expect(systemText).toContain("read-only mode");
    });
  }

  it("uses Edit Ontology on, Edit Code off when permissions are absent", async () => {
    const { toolNames, systemText } = await chat(undefined);
    expect([...toolNames].sort()).toEqual(namesOf(["read", "ontology"]));
    expect(systemText).toContain("Edit Ontology: ON");
    expect(systemText).toContain("Edit Code: OFF");
    const partial = await chat({ edit_code: true });
    expect([...partial.toolNames].sort()).toEqual(namesOf(["read", "ontology", "code"]));
  });

  it("rejects malformed permissions", async () => {
    setAgentClientFactory(() => scriptedClient().client);
    const res = await app.request(`/api/v1/projects/${projectId}/agent/chat?branch=main`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [], user_message: "x", permissions: { edit_code: "yes" } }),
    });
    expect(res.status).toBe(422);
  });

  it("tells the model what the user must turn on, and where code lives", async () => {
    const { systemText } = await chat({ edit_ontology: false, edit_code: false });
    expect(systemText).toMatch(/which toggle to turn on/);
    expect(systemText).toContain("Edit Ontology");
    expect(systemText).toContain("Edit Code");
    expect(systemText).toContain("code/");
    expect(systemText).toMatch(/ontology\.ttl\) and the project's code under code\//);
    expect(systemText).toMatch(/edited only through the ontology tools/);
  });
});

describe("blocked calls have no side effects", () => {
  it("refuses an ontology tool when Edit Ontology is off and leaves the source unchanged", async () => {
    const before = await source();
    const { results, summaries, events } = await chat({ edit_ontology: false, edit_code: true }, [
      { name: "create_entity", input: { entity_type: "class", label: "Calzone" } },
      { name: "delete_entity", input: { iri: "http://example.org/pizza#Pizza" } },
      { name: "create_branch", input: { name: "should-not-exist" } },
    ]);
    expect(results).toEqual([{ error: ONTOLOGY_REFUSAL }, { error: ONTOLOGY_REFUSAL }, { error: ONTOLOGY_REFUSAL }]);
    expect(summaries.every((s) => s.is_error === true && s.mutated === false)).toBe(true);
    expect(events.some((e) => e.event === "ontology_changed")).toBe(false);
    expect(await source()).toBe(before);
    const branches = await app.request(`/api/v1/projects/${projectId}/branches`);
    expect(JSON.stringify(await branches.json())).not.toContain("should-not-exist");
  });

  it("refuses write_file, delete_file and run_command when Edit Code is off", async () => {
    fs.mkdirSync(path.join(folder, "code"), { recursive: true });
    fs.writeFileSync(path.join(folder, "code", "keep.txt"), "keep");
    const { results } = await chat({ edit_ontology: true, edit_code: false }, [
      { name: "write_file", input: { path: "code/blocked.py", content: "print(1)" } },
      { name: "delete_file", input: { path: "code/keep.txt" } },
      { name: "run_command", input: { command: "touch ran.txt" } },
    ]);
    expect(results).toEqual([{ error: CODE_REFUSAL }, { error: CODE_REFUSAL }, { error: CODE_REFUSAL }]);
    expect(fs.existsSync(path.join(folder, "code", "blocked.py"))).toBe(false);
    expect(fs.readFileSync(path.join(folder, "code", "keep.txt"), "utf8")).toBe("keep");
    expect(fs.existsSync(path.join(folder, "ran.txt"))).toBe(false);
  });

  it("allows read-only code tools with everything off", async () => {
    fs.writeFileSync(path.join(folder, "code", "notes.txt"), "a\nb\nc\nd");
    const { results, summaries } = await chat({ edit_ontology: false, edit_code: false }, [
      { name: "list_files", input: { dir: "code" } },
      { name: "read_file", input: { path: "code/notes.txt", start_line: 2, end_line: 3 } },
      { name: "get_entity", input: { iri: "http://example.org/pizza#Pizza" } },
    ]);
    expect(summaries.every((s) => s.is_error === false)).toBe(true);
    expect(results[0].paths).toContain("code/notes.txt");
    expect(results[1]).toMatchObject({ content: "b\nc", total_lines: 4 });
  });
});

describe("code tools with Edit Code on", () => {
  const on = { edit_ontology: false, edit_code: true };

  it("writes and deletes files inside the project folder", async () => {
    const { results, summaries } = await chat(on, [
      { name: "write_file", input: { path: "code/pkg/app.py", content: "print('hi')\n" } },
    ]);
    expect(summaries[0]).toMatchObject({ is_error: false, mutated: true });
    expect(results[0]).toMatchObject({ path: "code/pkg/app.py", created: true });
    expect(fs.readFileSync(path.join(folder, "code", "pkg", "app.py"), "utf8")).toBe("print('hi')\n");

    const del = await chat(on, [{ name: "delete_file", input: { path: "code/pkg" } }]);
    expect(del.summaries[0]).toMatchObject({ is_error: false });
    expect(fs.existsSync(path.join(folder, "code", "pkg"))).toBe(false);
  });

  it("refuses path traversal, .git and the ontology file", async () => {
    const outside = path.join(path.dirname(folder), "escaped.txt");
    const { results } = await chat(on, [
      { name: "write_file", input: { path: "../escaped.txt", content: "x" } },
      { name: "write_file", input: { path: "code/../../escaped.txt", content: "x" } },
      { name: "read_file", input: { path: "../../etc/passwd" } },
      { name: "write_file", input: { path: ".git/hooks/pre-commit", content: "x" } },
      { name: "write_file", input: { path: "ontology.ttl", content: "broken" } },
      { name: "delete_file", input: { path: "ontology.ttl" } },
      { name: "list_files", input: { dir: "../" } },
    ]);
    for (const r of results) expect(r.error, JSON.stringify(r)).toBeTruthy();
    expect(String(results[0].error)).toMatch(/outside the project folder/);
    expect(String(results[2].error)).toMatch(/outside the project folder/);
    expect(String(results[4].error)).toMatch(/ontology tools/);
    expect(fs.existsSync(outside)).toBe(false);
    expect(fs.existsSync(path.join(folder, ".git", "hooks", "pre-commit"))).toBe(false);
    expect(await source()).toContain("Pizza ontology");
  });

  it("runs commands in the project folder or a subdirectory without Next.js env", async () => {
    process.env.NEXT_TEST_SECRET = "leak";
    process.env.NODE_OPTIONS = "--max-old-space-size=100";
    try {
      const { results, summaries } = await chat(on, [
        { name: "run_command", input: { command: "pwd; echo out; echo err >&2; echo \"[$NEXT_TEST_SECRET][$NODE_OPTIONS]\"" } },
        { name: "run_command", input: { command: "pwd; exit 3", cwd: "code" } },
        { name: "run_command", input: { command: "pwd", cwd: "../" } },
      ]);
      const real = fs.realpathSync(folder);
      expect(summaries[0]).toMatchObject({ is_error: false, summary: "Command succeeded" });
      const out0 = String(results[0].output);
      expect([folder, real]).toContain(out0.split("\n")[0]);
      expect(out0).toContain("out\n");
      expect(out0).toContain("err\n");
      expect(out0).toContain("[][]");
      expect(results[0]).toMatchObject({ exit_code: 0, timed_out: false });
      expect(results[1]).toMatchObject({ exit_code: 3 });
      expect([path.join(folder, "code"), path.join(real, "code")]).toContain(String(results[1].output).trim());
      expect(String(results[2].error)).toMatch(/outside the project folder/);
    } finally {
      delete process.env.NEXT_TEST_SECRET;
      delete process.env.NODE_OPTIONS;
    }
  });

  it("caps output to the last 20 KB", async () => {
    const { results } = await chat(on, [
      { name: "run_command", input: { command: "for i in $(seq 1 20000); do echo line$i; done" } },
    ]);
    expect(results[0].truncated).toBe(true);
    expect(String(results[0].output).length).toBeLessThanOrEqual(20_000);
    expect(String(results[0].output)).toContain("line20000");
  });

  it("kills a command at its timeout", async () => {
    const started = Date.now();
    const { results, summaries } = await chat(on, [
      { name: "run_command", input: { command: "echo started; sleep 30; echo never", timeout_seconds: 1 } },
    ]);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(results[0]).toMatchObject({ timed_out: true });
    expect(String(results[0].output)).toContain("started");
    expect(String(results[0].output)).not.toContain("never");
    expect(summaries[0].summary).toBe("Command timed out after 1s");
  }, 20_000);

  it("rejects a timeout above the maximum", async () => {
    const { results } = await chat(on, [{ name: "run_command", input: { command: "true", timeout_seconds: 301 } }]);
    expect(String(results[0].error)).toMatch(/must be <= 300/);
  });
});
