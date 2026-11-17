// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

const NS = "http://example.org/pizza#";

const TAGGED_TTL = `@prefix : <http://example.org/pizza#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:Dog a owl:Class ;
    rdfs:label "Dog"@en, "Dog"@en-GB, "Chien"@fr ;
    rdfs:comment "A dog" .
`;

let dataDir: string;
let app: AppLike;
let projectId: string;

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
  projectId = await createPizzaProject(app);
}, 30_000);

afterAll(() => removeDir(dataDir));

describe("normalizeToTurtle", () => {
  it("strips language tags into plain string literals", async () => {
    const { normalizeToTurtle } = await import("@/server/rdf");
    const out = await normalizeToTurtle(TAGGED_TTL, "dog.ttl");
    expect(out.languageTagsRemoved).toBe(3);
    expect(out.turtle).not.toMatch(/"@[a-zA-Z]/);
    expect(out.turtle).not.toContain("^^xsd:string");
    expect(out.turtle).toContain('"Chien"');
    expect(out.turtle).toContain('"Dog"');
    const labels = out.store.getObjects(`${NS}Dog`, "http://www.w3.org/2000/01/rdf-schema#label", null);
    expect(labels.map((l) => l.value).sort()).toEqual(["Chien", "Dog"]);
    for (const l of labels) expect((l as unknown as { language: string }).language).toBe("");
  });

  it("reports zero when there are no language tags", async () => {
    const { normalizeToTurtle } = await import("@/server/rdf");
    const out = await normalizeToTurtle(`<http://x#a> <http://www.w3.org/2000/01/rdf-schema#label> "A" .`, "a.ttl");
    expect(out.languageTagsRemoved).toBe(0);
  });
});

describe("label preferences", () => {
  it("ignores the language part of stored preferences and literal languages", async () => {
    const { getPreferredLabel } = await import("@/server/ontology");
    const { parseTurtle } = await import("@/server/rdf");
    const { store } = parseTurtle(TAGGED_TTL);
    expect(getPreferredLabel(store, `${NS}Dog`, ["rdfs:label@fr"])).toBe("Dog");
    expect(getPreferredLabel(store, `${NS}Dog`, ["skos:prefLabel@en", "rdfs:label@de"])).toBe("Dog");
  });

  it("strips the language part when saving and reading project preferences", async () => {
    const res = await app.request(`/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label_preferences: ["rdfs:label@en", "rdfs:label", "skos:prefLabel@en"] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { label_preferences: string[] };
    expect(body.label_preferences).toEqual(["rdfs:label", "skos:prefLabel"]);
  });
});

describe("class detail response", () => {
  it("returns labels and comments as plain value objects", async () => {
    const res = await app.request(
      `/api/v1/projects/${projectId}/ontology/classes/${encodeURIComponent(`${NS}Pizza`)}?branch=main`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { labels: unknown[]; comments: unknown[] };
    expect(body.labels).toEqual([{ value: "Pizza" }]);
    expect(body.comments).toEqual([{ value: "A baked dish" }]);
  });
});

describe("lint rules and config", () => {
  const removed = ["label-per-language", "missing-language-tag", "redundant-regional-label", "missing-english-label"];

  it("no longer exposes language rules", async () => {
    const { ALL_RULE_IDS, LINT_LEVEL_DEFINITIONS } = await import("@/server/linter");
    for (const id of removed) expect(ALL_RULE_IDS.has(id)).toBe(false);
    for (const def of Object.values(LINT_LEVEL_DEFINITIONS)) {
      expect(def.description.toLowerCase()).not.toContain("language");
      for (const id of removed) expect(def.rules.has(id)).toBe(false);
    }
    const rules = (await (await app.request("/api/v1/projects/lint/rules")).json()) as unknown;
    expect(JSON.stringify(rules)).not.toMatch(/language|regional/);
  });

  it("tolerates stored configs that reference removed rule ids", async () => {
    const { run } = await import("@/server/db");
    run(
      "INSERT INTO project_lint_configs (project_id, lint_level, enabled_rules, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET lint_level = excluded.lint_level, enabled_rules = excluded.enabled_rules",
      projectId,
      null,
      "missing-label,label-per-language,missing-english-label",
      new Date().toISOString(),
    );
    const res = await app.request(`/api/v1/projects/${projectId}/lint/config`);
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as { enabled_rules: string[]; effective_rules: string[] };
    expect(cfg.enabled_rules).toEqual(["missing-label"]);
    expect(cfg.effective_rules).toEqual(["missing-label"]);

    const runRes = await app.request(`/api/v1/projects/${projectId}/lint/run`, { method: "POST" });
    expect(runRes.ok).toBe(true);
  });

  it("accepts removed rule ids on update and drops them, but rejects unknown ids", async () => {
    const put = (rules: string[]) =>
      app.request(`/api/v1/projects/${projectId}/lint/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled_rules: rules }),
      });
    const ok = await put(["empty-label", "missing-language-tag"]);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { enabled_rules: string[] }).enabled_rules).toEqual(["empty-label"]);
    const bad = await put(["not-a-rule"]);
    expect(bad.status).toBe(422);
  });
});

describe("plain literals on every write path", () => {
  const TAGGED = /"@[a-zA-Z]/;

  async function readSource(branch = "main") {
    const res = await app.request(`/api/v1/projects/${projectId}/source?branch=${branch}`);
    return ((await res.json()) as { content: string }).content;
  }

  it("serializeTurtle never writes language tags", async () => {
    const { parseTurtle, serializeTurtle } = await import("@/server/rdf");
    const parsed = parseTurtle(TAGGED_TTL);
    const out = await serializeTurtle(parsed.store, parsed.prefixes);
    expect(out).not.toMatch(TAGGED);
    expect(out).not.toContain("langString");
    expect(out).toContain('"Chien"');
  });

  it("stripLanguageTagsFromTurtle leaves untagged text untouched", async () => {
    const { stripLanguageTagsFromTurtle } = await import("@/server/rdf");
    const raw = `@prefix : <http://x#> .\n:a   :p   "email@example.org" .\n`;
    expect(await stripLanguageTagsFromTurtle(raw)).toEqual({ content: raw, removed: 0 });
    const tagged = await stripLanguageTagsFromTurtle(TAGGED_TTL);
    expect(tagged.removed).toBe(3);
    expect(tagged.content).not.toMatch(TAGGED);
  });

  it("strips tags from raw source saves", async () => {
    const original = await readSource();
    const put = await app.request(`/api/v1/projects/${projectId}/source?branch=main`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: original.replace('"Food"', '"Food"@en, "Nourriture"@fr'),
        commit_message: "Tagged save",
      }),
    });
    expect(put.ok).toBe(true);
    const saved = await readSource();
    expect(saved).not.toMatch(TAGGED);
    expect(saved).toContain('"Nourriture"');
  });

  it("strips tags from imported projects", async () => {
    const boundary = "----plainLiterals";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="dog.ttl"',
      "Content-Type: text/turtle",
      "",
      TAGGED_TTL,
      `--${boundary}`,
      'Content-Disposition: form-data; name="is_public"',
      "",
      "false",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const init = { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body };
    const parsed = await new Request("http://localhost/", init).formData();
    const g = globalThis as { File: typeof File };
    const jsdomFile = g.File;
    g.File = (parsed.get("file") as File).constructor as typeof File;
    let res: Response;
    try {
      res = await app.request("/api/v1/projects/import", init);
    } finally {
      g.File = jsdomFile;
    }
    expect(res.status).toBe(201);
    const project = (await res.json()) as { id: string };
    const src = await app.request(`/api/v1/projects/${project.id}/source?branch=main`);
    const content = ((await src.json()) as { content: string }).content;
    expect(content).not.toMatch(TAGGED);
    expect(content).toContain('"Chien"');
  });

  it("strips tags that arrive through a pull request merge", async () => {
    const git = await import("@/server/git");
    const branch = await app.request(`/api/v1/projects/${projectId}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "tagged", from_branch: "main" }),
    });
    expect(branch.ok).toBe(true);
    const base = await readSource("tagged");
    await git.commitFile(projectId, {
      branch: "tagged",
      path: "ontology.ttl",
      content: base.replace('"Topping"', '"Topping"@en'),
      message: "Raw tagged commit",
    });
    expect(await readSource("tagged")).toMatch(TAGGED);

    const pr = await app.request(`/api/v1/projects/${projectId}/pull-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Tagged", source_branch: "tagged", target_branch: "main" }),
    });
    expect(pr.status).toBeLessThan(300);
    const { pr_number } = (await pr.json()) as { pr_number: number };
    const merge = await app.request(`/api/v1/projects/${projectId}/pull-requests/${pr_number}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(merge.ok).toBe(true);
    const merged = await readSource();
    expect(merged).not.toMatch(TAGGED);
    expect(merged).toContain('"Topping"');
  });
});
