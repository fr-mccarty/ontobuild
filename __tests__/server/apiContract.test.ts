// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

/**
 * Contract fixes from the route documentation pass: status codes, validation,
 * null-vs-absent fields and consistent vocabularies across the API.
 */

const NS = "http://example.org/pizza#";
const RICH_TTL = `@prefix : <http://example.org/pizza#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

<http://example.org/pizza> a owl:Ontology ; rdfs:label "Pizza ontology" .

:Food a owl:Class ; rdfs:label "Food" .
:Zebra a owl:Class ; rdfs:label "A zebra-ish parent" .
:Alpha a owl:Class ; rdfs:label "Z last by label" .
:Pizza a owl:Class ;
    rdfs:label "Pizza" ;
    skos:prefLabel "Preferred pizza" ;
    rdfs:subClassOf :Alpha, :Zebra ;
    rdfs:seeAlso :Food ;
    skos:definition "A baked dish" .
:Zebra rdfs:subClassOf :Food .
:Alpha rdfs:subClassOf :Food .
:Topping a owl:Class ; rdfs:label "Topping" ; rdfs:seeAlso :Pizza .

:relatedTo a rdf:Property ; rdfs:label "related to" .
:relatedToo a rdf:Property ; rdfs:label "related too" .
:hasTopping a owl:ObjectProperty ; rdfs:label "has topping" .
:hasToppings a owl:ObjectProperty ; rdfs:label "has toppings" .
`;

let dataDir: string;
let app: AppLike;
let projectId: string;
let db: typeof import("@/server/db");

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
  db = await import("@/server/db");
  projectId = await createPizzaProject(app);
}, 30_000);

afterAll(() => removeDir(dataDir));

const base = (id = projectId) => `/api/v1/projects/${id}`;
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const enc = encodeURIComponent;
const getJson = async <T = Record<string, unknown>>(path: string) => (await (await app.request(path)).json()) as T;

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function newProject(name: string, ttl?: string): Promise<string> {
  const res = await app.request("/api/v1/projects", json("POST", { name }));
  const { id } = (await res.json()) as { id: string };
  if (ttl) {
    const put = await app.request(`${base(id)}/source?branch=main`, json("PUT", { content: ttl, commit_message: "seed" }));
    expect(put.ok).toBe(true);
  }
  return id;
}

/** A project whose configured ontology file does not exist in the repository. */
async function projectWithoutFile(): Promise<string> {
  const id = await newProject("No file");
  db.update("projects", { git_ontology_path: "missing.ttl" }, { id });
  return id;
}

describe("quality", () => {
  it("starts jobs with 202", async () => {
    expect((await app.request(`${base()}/quality/check`, { method: "POST" })).status).toBe(202);
    expect((await app.request(`${base()}/quality/duplicates`, { method: "POST" })).status).toBe(202);
  });

  it("validates the repository and branch before queueing", async () => {
    expect((await app.request(`${base()}/quality/check?branch=nope`, { method: "POST" })).status).toBe(404);
    expect((await app.request(`${base()}/quality/duplicates?branch=nope`, { method: "POST" })).status).toBe(404);
    const noRepo = await newProject("No repo");
    const git = await import("@/server/git");
    await git.deleteRepo(noRepo);
    const res = await app.request(`${base(noRepo)}/quality/check`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/repository/i);
  });

  it("reports never-checked results with null timestamps", async () => {
    const id = await newProject("Never checked");
    const issues = await getJson(`${base(id)}/quality/issues`);
    expect(issues).toMatchObject({ issues: [], checked_at: null, duration_ms: null });
    const dups = await getJson(`${base(id)}/quality/duplicates/latest`);
    expect(dups).toMatchObject({ clusters: [], threshold: null, checked_at: null });
  });

  it("uses the class/property/individual vocabulary for duplicates, including rdf:Property", async () => {
    const id = await newProject("Dups", RICH_TTL);
    const { job_id } = (await (await app.request(`${base(id)}/quality/duplicates?threshold=0.5`, { method: "POST" })).json()) as {
      job_id: string;
    };
    const result = await waitFor(async () => {
      const res = await app.request(`${base(id)}/quality/duplicates/jobs/${job_id}`);
      return res.status === 200 ? ((await res.json()) as { clusters: { entities: { iri: string; entity_type: string }[] }[] }) : null;
    });
    const types = new Map(result.clusters.flatMap((c) => c.entities.map((e) => [e.iri, e.entity_type] as const)));
    expect(types.get(`${NS}relatedTo`)).toBe("property");
    expect(types.get(`${NS}hasTopping`)).toBe("property");
    for (const t of types.values()) expect(["class", "property", "individual"]).toContain(t);
  });
});

describe("lint", () => {
  it("rejects an unknown issue_type with 422", async () => {
    expect((await app.request(`${base()}/lint/issues?issue_type=fatal`)).status).toBe(422);
    expect((await app.request(`${base()}/lint/issues?issue_type=warning`)).status).toBe(200);
  });

  it("hides resolved issues on a run unless include_resolved, and keeps counts from the last completed run", async () => {
    const { run_id } = (await (await app.request(`${base()}/lint/run`, { method: "POST" })).json()) as { run_id: string };
    await waitFor(async () => {
      const r = await getJson<{ status: string }>(`${base()}/lint/runs/${run_id}`);
      return r.status === "completed" ? r : null;
    });
    const before = await getJson<{ issues: { id: string }[] }>(`${base()}/lint/runs/${run_id}`);
    expect(before.issues.length).toBeGreaterThan(0);
    const dismissed = before.issues[0].id;
    expect((await app.request(`${base()}/lint/issues/${dismissed}`, { method: "DELETE" })).status).toBe(204);

    const hidden = await getJson<{ issues: { id: string }[] }>(`${base()}/lint/runs/${run_id}`);
    expect(hidden.issues.map((i) => i.id)).not.toContain(dismissed);
    const shown = await getJson<{ issues: { id: string }[] }>(`${base()}/lint/runs/${run_id}?include_resolved=true`);
    expect(shown.issues.map((i) => i.id)).toContain(dismissed);

    const done = await getJson<{ total_issues: number; counts_run_id: string }>(`${base()}/lint/status`);
    expect(done.counts_run_id).toBe(run_id);
    expect(done.total_issues).toBe(hidden.issues.length);

    // Simulate a newer run that is still pending.
    db.insert("lint_runs", { id: "pending-run", project_id: projectId, status: "pending", branch: "main", started_at: "9999-01-01T00:00:00Z" });
    try {
      const pending = await getJson<{ last_run: { status: string }; total_issues: number; counts_run_id: string }>(`${base()}/lint/status`);
      expect(pending.last_run.status).toBe("pending");
      expect(pending.counts_run_id).toBe(run_id);
      expect(pending.total_issues).toBe(done.total_issues);
    } finally {
      db.run("DELETE FROM lint_runs WHERE id = 'pending-run'");
    }
  });
});

describe("normalization", () => {
  it("has no checking field and reports job status as 'completed'", async () => {
    const status = await getJson(`${base()}/normalization/status`);
    expect(status).not.toHaveProperty("checking");
    const res = await app.request(`${base()}/normalization/queue`, json("POST", { dry_run: true }));
    expect(res.status).toBe(202);
    const { job_id } = (await res.json()) as { job_id: string };
    const job = await waitFor(async () => {
      const j = await getJson<{ status: string; result: { status: string } | null }>(`${base()}/normalization/jobs/${job_id}`);
      return j.status === "pending" || j.status === "running" ? null : j;
    });
    expect(job.status).toBe("completed");
    expect(job.result?.status).toBe("completed");
  });

  it("handles a missing ontology file the same way everywhere", async () => {
    const id = await projectWithoutFile();
    const status = await getJson(`${base(id)}/normalization/status`);
    expect(status).toMatchObject({ needs_normalization: null, error: "Project has no ontology file" });

    const refresh = await app.request(`${base(id)}/normalization/refresh`, { method: "POST" });
    expect(refresh.status).toBe(202);
    const { job_id } = (await refresh.json()) as { job_id: string };
    const job = await waitFor(async () => {
      const j = await getJson<{ status: string; result: Record<string, unknown> | null }>(`${base(id)}/normalization/jobs/${job_id}`);
      return j.status === "completed" ? j : null;
    });
    expect(job.result).toMatchObject({ needs_normalization: null, error: "Project has no ontology file" });

    expect((await app.request(`${base(id)}/normalization`, json("POST", { dry_run: true }))).status).toBe(400);
    expect((await app.request(`${base(id)}/normalization/queue`, json("POST", { dry_run: true }))).status).toBe(400);
  });
});

describe("analytics", () => {
  it("accepts and validates days on hot entities", async () => {
    expect((await app.request(`${base()}/analytics/hot-entities?days=7`)).status).toBe(200);
    expect((await app.request(`${base()}/analytics/hot-entities?days=0`)).status).toBe(422);
  });

  it("decodes the entity IRI like the other IRI routes", async () => {
    const body = await getJson<{ entity_iri: string }>(`${base()}/analytics/entity/${enc(`${NS}Pizza`)}/history`);
    expect(body.entity_iri).toBe(`${NS}Pizza`);
  });
});

describe("pull requests", () => {
  let prId: string;

  beforeAll(async () => {
    prId = await newProject("PRs", RICH_TTL);
    expect((await app.request(`${base(prId)}/branches`, json("POST", { name: "feature" }))).status).toBe(201);
  });

  const openPr = async (body: Record<string, unknown> = {}) => {
    const res = await app.request(
      `${base(prId)}/pull-requests`,
      json("POST", { title: "PR", source_branch: "feature", target_branch: "main", ...body }),
    );
    expect(res.status).toBe(201);
    return (await res.json()) as { pr_number: number; description: string | null; can_merge: boolean; commits_ahead: number };
  };

  it("validates the status filter", async () => {
    expect((await app.request(`${base(prId)}/pull-requests?status=bogus`)).status).toBe(422);
    expect((await app.request(`${base(prId)}/pull-requests?status=open`)).status).toBe(200);
  });

  it("checks the project exists before parsing the PR number", async () => {
    expect((await app.request(`/api/v1/projects/nope/pull-requests/abc`)).status).toBe(404);
    expect((await app.request(`/api/v1/projects/nope/pull-requests/abc/merge`, { method: "POST" })).status).toBe(404);
    expect((await app.request(`${base(prId)}/pull-requests/abc`)).status).toBe(422);
  });

  it("clears the description with null", async () => {
    const pr = await openPr({ description: "hello" });
    expect(pr.description).toBe("hello");
    const res = await app.request(`${base(prId)}/pull-requests/${pr.pr_number}`, json("PATCH", { description: null }));
    expect(((await res.json()) as { description: string | null }).description).toBeNull();
    const kept = await app.request(`${base(prId)}/pull-requests/${pr.pr_number}`, json("PATCH", { title: "New" }));
    expect(((await kept.json()) as { description: string | null }).description).toBeNull();
    await app.request(`${base(prId)}/pull-requests/${pr.pr_number}/close`, { method: "POST" });
  });

  it("refuses to merge when there is nothing to merge, and uses 409 for wrong-state actions", async () => {
    const pr = await openPr();
    expect(pr.commits_ahead).toBe(0);
    expect(pr.can_merge).toBe(false);
    const merge = await app.request(`${base(prId)}/pull-requests/${pr.pr_number}/merge`, json("POST", {}));
    expect(merge.status).toBe(409);
    expect(((await merge.json()) as { detail: string }).detail).toMatch(/nothing to merge/i);
    const after = await getJson<{ status: string }>(`${base(prId)}/pull-requests/${pr.pr_number}`);
    expect(after.status).toBe("open");

    expect((await app.request(`${base(prId)}/pull-requests/${pr.pr_number}/reopen`, { method: "POST" })).status).toBe(409);
    expect((await app.request(`${base(prId)}/pull-requests/${pr.pr_number}/close`, { method: "POST" })).status).toBe(200);
    expect((await app.request(`${base(prId)}/pull-requests/${pr.pr_number}/close`, { method: "POST" })).status).toBe(409);
    expect((await app.request(`${base(prId)}/pull-requests/${pr.pr_number}/merge`, json("POST", {}))).status).toBe(409);
    expect((await app.request(`${base(prId)}/pull-requests/${pr.pr_number}`, json("PATCH", { title: "x" }))).status).toBe(409);
    expect(
      (await app.request(`${base(prId)}/pull-requests/${pr.pr_number}/reviews`, json("POST", { status: "approved" }))).status,
    ).toBe(409);

    // Comments stay open on a closed PR, and total counts replies like comment_count.
    const top = await app.request(`${base(prId)}/pull-requests/${pr.pr_number}/comments`, json("POST", { body: "top" }));
    expect(top.status).toBe(201);
    const { id: parentId } = (await top.json()) as { id: string };
    const reply = await app.request(
      `${base(prId)}/pull-requests/${pr.pr_number}/comments`,
      json("POST", { body: "reply", parent_id: parentId }),
    );
    expect(reply.status).toBe(201);
    const list = await getJson<{ items: unknown[]; total: number }>(`${base(prId)}/pull-requests/${pr.pr_number}/comments`);
    const detail = await getJson<{ comment_count: number }>(`${base(prId)}/pull-requests/${pr.pr_number}`);
    expect(list.items).toHaveLength(1);
    expect(list.total).toBe(2);
    expect(detail.comment_count).toBe(2);
  });
});

describe("ontology", () => {
  let richId: string;

  beforeAll(async () => {
    richId = await newProject("Rich", RICH_TTL);
  });

  it("returns the real 404 from index-status when the ontology file is missing", async () => {
    const id = await projectWithoutFile();
    const res = await app.request(`${base(id)}/ontology/index-status`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/^Ontology file not found in repository: missing.ttl doesn't exist on branch 'main'/);
  });

  it("uses the preferred label for reference sources", async () => {
    db.update("projects", { label_preferences: JSON.stringify(["skos:prefLabel", "rdfs:label"]) }, { id: richId });
    try {
      const body = await getJson<{ groups: { context: string; references: { source_iri: string; source_label: string | null }[] }[] }>(
        `${base(richId)}/entities/${enc(`${NS}Zebra`)}/references`,
      );
      const ref = body.groups.flatMap((g) => g.references).find((r) => r.source_iri === `${NS}Pizza`);
      expect(ref?.source_label).toBe("Preferred pizza");
    } finally {
      db.update("projects", { label_preferences: null }, { id: richId });
    }
  });

  it("tags annotation values as iri or literal and drops the placeholder fields", async () => {
    const detail = await getJson<{ annotations: { property_iri: string; values: { value: string; type: string }[] }[] }>(
      `${base(richId)}/ontology/classes/${enc(`${NS}Pizza`)}`,
    );
    const byProp = new Map(detail.annotations.map((a) => [a.property_iri, a.values]));
    expect(byProp.get("http://www.w3.org/2000/01/rdf-schema#seeAlso")).toEqual([{ value: `${NS}Food`, type: "iri" }]);
    expect(byProp.get("http://www.w3.org/2004/02/skos/core#definition")).toEqual([{ value: "A baked dish", type: "literal" }]);
    expect(detail).not.toHaveProperty("is_defined");
    expect(detail).not.toHaveProperty("source_ontology");
  });

  it("validates entity_types in search", async () => {
    expect((await app.request(`${base(richId)}/ontology/search?q=pizza&entity_types=class,widget`)).status).toBe(422);
    expect((await app.request(`${base(richId)}/ontology/search?q=pizza&entity_types=class`)).status).toBe(200);
  });

  it("returns only the total with limit=0 and rejects a bad limit", async () => {
    const all = await (await app.request(`${base(richId)}/ontology/search?q=*`)).json();
    const res = await app.request(`${base(richId)}/ontology/search?q=*&limit=0`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(body.total).toBe(all.total);
    expect(all.total).toBeGreaterThan(0);
    expect((await app.request(`${base(richId)}/ontology/search?q=*&limit=-1`)).status).toBe(422);
    expect((await app.request(`${base(richId)}/ontology/search?q=*&limit=abc`)).status).toBe(422);
  });

  it("follows the parent that sorts first by label in ancestors", async () => {
    // Pizza's parents: :Alpha ("Z last by label") and :Zebra ("A zebra-ish parent"). By IRI, Alpha comes first; by label, Zebra.
    const body = await getJson<{ nodes: { iri: string }[] }>(`${base(richId)}/ontology/tree/${enc(`${NS}Pizza`)}/ancestors`);
    expect(body.nodes.map((n) => n.iri)).toEqual([`${NS}Food`, `${NS}Zebra`]);
  });

  it("accepts commit_message in a JSON body on delete, and still in the query", async () => {
    const del = await app.request(
      `${base(richId)}/ontology/entities/${enc(`${NS}hasToppings`)}`,
      json("DELETE", { commit_message: "Remove hasToppings via body" }),
    );
    expect(del.status).toBe(204);
    let revs = await getJson<{ commits: { message: string }[] }>(`${base(richId)}/revisions?limit=1`);
    expect(revs.commits[0].message).toContain("Remove hasToppings via body");

    const q = await app.request(
      `${base(richId)}/ontology/entities/${enc(`${NS}relatedToo`)}?commit_message=${enc("Remove relatedToo via query")}`,
      { method: "DELETE" },
    );
    expect(q.status).toBe(204);
    revs = await getJson<{ commits: { message: string }[] }>(`${base(richId)}/revisions?limit=1`);
    expect(revs.commits[0].message).toContain("Remove relatedToo via query");
  });
});

describe("projects", () => {
  it("trims the name on PATCH, rejects a blank one and clears the description with null", async () => {
    const id = await newProject("Patch me");
    expect((await app.request(base(id), json("PATCH", { name: "   " }))).status).toBe(422);
    const named = await (await app.request(base(id), json("PATCH", { name: "  Trimmed  ", description: "desc" }))).json();
    expect(named).toMatchObject({ name: "Trimmed", description: "desc" });
    const cleared = await (await app.request(base(id), json("PATCH", { description: null }))).json();
    expect(cleared).toMatchObject({ name: "Trimmed", description: null });
  });

  it("includes line totals in a revision diff", async () => {
    const revs = await getJson<{ commits: { hash: string }[] }>(`${base()}/revisions`);
    const oldest = revs.commits[revs.commits.length - 1].hash;
    const diff = await getJson<{ total_additions: number; total_deletions: number }>(
      `${base()}/revisions/diff?from_version=${oldest}&to_version=main`,
    );
    expect(typeof diff.total_additions).toBe("number");
    expect(typeof diff.total_deletions).toBe("number");
    expect(diff.total_additions).toBeGreaterThan(0);
  });

  it("rejects an oversized import from Content-Length before reading the body", async () => {
    const res = await app.request("/api/v1/projects/import", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(200 * 1024 * 1024) },
      body: "--x--",
    });
    expect(res.status).toBe(413);
  });

  it("rejects an OWL/XML (.owx) import instead of misreading it as RDF/XML", async () => {
    const owx = `<?xml version="1.0"?><Ontology xmlns="http://www.w3.org/2002/07/owl#" ontologyIRI="http://ex.org/o"><Declaration><Class IRI="http://ex.org/A"/></Declaration></Ontology>`;
    const boundary = "owxboundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="ontology.owx"',
      "Content-Type: application/owl+xml",
      "",
      owx,
      `--${boundary}`,
      'Content-Disposition: form-data; name="is_public"',
      "",
      "false",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const init = { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body };
    // jsdom's File is not the class undici's FormData returns, so the route's instanceof check needs the real one.
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
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const { detail } = (await res.json()) as { detail: string };
    expect(detail).toContain("Unsupported file format: .owx");
    expect(detail).not.toContain(".owx,");
  });
});
