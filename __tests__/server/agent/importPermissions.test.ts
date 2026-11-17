// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { createPizzaProject, parseSse, removeDir, useTempDataDir, type AppLike } from "./helpers";
import type { AgentClient, AgentRequestBody } from "@/server/agent/chat";
import type { AgentPermissions } from "@/server/agent/tools";

function chunk(delta: Record<string, unknown>, finish_reason: string | null = null): ChatCompletionChunk {
  return {
    id: "gen-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "test",
    choices: [{ index: 0, delta, finish_reason, logprobs: null }],
  } as unknown as ChatCompletionChunk;
}

/** A fake model that calls the given tools, in order, in its first turn and then stops. */
function scriptedClient(calls: { name: string; input: Record<string, unknown> }[]) {
  const bodies: AgentRequestBody[] = [];
  const first = [
    ...calls.map((c, i) =>
      chunk({ tool_calls: [{ index: i, id: `call_${i}`, function: { name: c.name, arguments: JSON.stringify(c.input) } }] }),
    ),
    chunk({}, "tool_calls"),
  ];
  const client: AgentClient = {
    async createStream(body) {
      bodies.push(JSON.parse(JSON.stringify(body)));
      const chunks = bodies.length === 1 && calls.length ? first : [chunk({ content: "ok" }, "stop")];
      return (async function* () {
        for (const c of chunks) yield c;
      })();
    },
  };
  return { client, bodies };
}

const FOOD_IRI = "http://example.org/food";
const FOOD_TTL = `@prefix : <${FOOD_IRI}#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

<${FOOD_IRI}> a owl:Ontology ;
    rdfs:label "Food ontology" .

:Dish a owl:Class ;
    rdfs:label "Dish" .
`;

let dataDir: string;
let app: AppLike;
let home: string;
let food: string;
let setAgentClientFactory: (f: ((key: string) => AgentClient) | null) => void;
const savedKey = process.env.OPENROUTER_API_KEY;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
  setAgentClientFactory = (await import("@/server/routes/agent")).setAgentClientFactory;
  home = await createPizzaProject(app);
  const res = await app.request("/api/v1/projects", json("POST", { name: "Food" }));
  food = ((await res.json()) as { id: string }).id;
  expect((await app.request(`/api/v1/projects/${food}/source?branch=main`, json("PUT", { content: FOOD_TTL, commit_message: "Seed" }))).ok).toBe(true);
  expect((await app.request(`/api/v1/projects/${home}/imports?branch=main`, json("POST", { iri: FOOD_IRI }))).ok).toBe(true);
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

async function chat(permissions: Partial<AgentPermissions>, calls: { name: string; input: Record<string, unknown> }[] = []) {
  const { client, bodies } = scriptedClient(calls);
  setAgentClientFactory(() => client);
  const res = await app.request(
    `/api/v1/projects/${home}/agent/chat?branch=main`,
    json("POST", { messages: [], user_message: "do it", page_context: "", permissions }),
  );
  expect(res.status).toBe(200);
  const events = parseSse(await res.text());
  const results = events
    .filter((e) => e.event === "message" && (e.data as { message: { role: string } }).message.role === "tool")
    .map((e) => JSON.parse((e.data as { message: { content: string } }).message.content) as Record<string, unknown>);
  const changes = events.filter((e) => e.event === "ontology_changed").map((e) => e.data as Record<string, unknown>);
  const system = bodies[0].messages[0] as { content: string | { text: string }[] };
  const systemText = typeof system.content === "string" ? system.content : system.content.map((p) => p.text).join("");
  const toolNames = (bodies[0].tools ?? []).map((t) => (t as { function: { name: string } }).function.name);
  return { results, changes, systemText, toolNames };
}

async function sourceOf(projectId: string): Promise<string> {
  const res = await app.request(`/api/v1/projects/${projectId}/source?branch=main`);
  const text = await res.text();
  try {
    return (JSON.parse(text) as { content?: string }).content ?? text;
  } catch {
    return text;
  }
}

const IMPORTS_REFUSAL = "Imported ontologies are read-only here. To change one, the user opens its own project and asks there.";
const ONTOLOGY_REFUSAL = "Editing the ontology is turned off for this conversation. Ask the user to turn on Edit Ontology.";

describe("imported ontologies (edit_imports, API only)", () => {
  it("offers the ontology tools and says so in the system prompt when only edit_imports is on", async () => {
    const { toolNames, systemText } = await chat({ edit_ontology: false, edit_code: false, edit_imports: true });
    expect(toolNames).toContain("create_entity");
    expect(toolNames).toContain("switch_ontology");
    expect(toolNames).not.toContain("write_file");
    expect(systemText).toContain("You may change the ontologies of OntoBuilder projects this project imports");
    expect(systemText).not.toContain("read-only mode");
  });

  it("defaults to off", async () => {
    const { systemText } = await chat({});
    expect(systemText).toContain("Imported ontologies: read-only");
  });

  it("lets the agent read an imported project but not change it when off", async () => {
    const before = await sourceOf(food);
    const { results, changes } = await chat({ edit_ontology: true, edit_code: false, edit_imports: false }, [
      { name: "list_imports", input: {} },
      { name: "switch_ontology", input: { target: FOOD_IRI } },
      { name: "get_entity", input: { iri: `${FOOD_IRI}#Dish` } },
      { name: "create_entity", input: { entity_type: "class", label: "Soup" } },
    ]);
    expect(results[0].imports).toEqual([expect.objectContaining({ iri: FOOD_IRI, source: "project", project_id: food })]);
    expect(results[1]).toMatchObject({ project_id: food, branch: "main", home: false, can_edit: false });
    expect(results[2].error).toBeUndefined();
    expect(results[3]).toEqual({ error: IMPORTS_REFUSAL });
    expect(changes).toEqual([]);
    expect(await sourceOf(food)).toBe(before);
  });

  it("changes only the imported project when on, and keeps code tools and selection at home", async () => {
    const homeBefore = await sourceOf(home);
    const { results, changes } = await chat({ edit_ontology: false, edit_code: true, edit_imports: true }, [
      { name: "create_entity", input: { entity_type: "class", label: "Calzone" } },
      { name: "switch_ontology", input: { target: food } },
      { name: "create_entity", input: { entity_type: "class", label: "Soup" } },
      { name: "write_file", input: { path: "code/x.txt", content: "x" } },
      { name: "select_entity", input: { iri: `${FOOD_IRI}#Dish` } },
      { name: "switch_ontology", input: { target: "home" } },
      { name: "create_entity", input: { entity_type: "class", label: "Calzone" } },
    ]);
    expect(results[0]).toEqual({ error: ONTOLOGY_REFUSAL });
    expect(results[2].error).toBeUndefined();
    expect(String(results[3].error)).toMatch(/only work in the user's own project/);
    expect(String(results[4].error)).toMatch(/switch_ontology/);
    expect(results[5]).toMatchObject({ home: true, branch: "main" });
    expect(results[6]).toEqual({ error: ONTOLOGY_REFUSAL });
    expect(await sourceOf(food)).toContain("Soup");
    expect(await sourceOf(home)).toBe(homeBefore);
    expect(changes).toEqual([expect.objectContaining({ project_id: food, branch: "main", name: "create_entity" })]);
  });

  it("rejects targets that are not imported", async () => {
    const { results } = await chat({ edit_imports: true }, [
      { name: "switch_ontology", input: { target: "http://example.org/unknown" } },
    ]);
    expect(String(results[0].error)).toMatch(/not imported/);
  });
});
