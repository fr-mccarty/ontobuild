import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

const NS = "http://example.org/pizza#";

let dataDir: string;
let app: AppLike;
let projectId: string;

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
  projectId = await createPizzaProject(app);
}, 30_000);

afterAll(() => removeDir(dataDir));

const base = () => `/api/v1/projects/${projectId}`;
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const enc = encodeURIComponent;

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("branch query parameter", () => {
  it("rejects an unknown branch with 404 instead of falling through", async () => {
    for (const path of ["/ontology/tree", "/quality/issues", "/normalization/status"]) {
      const res = await app.request(`${base()}${path}?branch=no-such-branch`);
      expect(res.status, path).toBe(404);
    }
    expect((await app.request(`${base()}/ontology/reindex?branch=no-such-branch`, { method: "POST" })).status).toBe(404);
    expect((await app.request(`${base()}/lint/run?branch=no-such-branch`, { method: "POST" })).status).toBe(404);
  });

  it("rejects an unknown preferred branch", async () => {
    const res = await app.request(`${base()}/branch-preference?branch=no-such-branch`, { method: "PUT" });
    expect(res.status).toBe(404);
  });
});

describe("lint run", () => {
  it("returns a run id that can be polled, and records the branch", async () => {
    const res = await app.request(`${base()}/lint/run?branch=main`, { method: "POST" });
    expect(res.status).toBe(202);
    const started = (await res.json()) as { run_id: string; branch: string };
    expect(started.branch).toBe("main");
    const run = await waitFor(async () => {
      const r = (await (await app.request(`${base()}/lint/runs/${started.run_id}`)).json()) as {
        status: string;
        branch: string;
      };
      return r.status === "completed" || r.status === "failed" ? r : null;
    });
    expect(run.status).toBe("completed");
    expect(run.branch).toBe("main");
  });
});

describe("normalization", () => {
  it("returns 404 for an unknown job", async () => {
    expect((await app.request(`${base()}/normalization/jobs/nope`)).status).toBe(404);
  });

  it("works on the requested branch", async () => {
    expect((await app.request(`/api/v1/projects/${projectId}/branches`, json("POST", { name: "norm-test" }))).status).toBe(201);
    const res = await app.request(`${base()}/normalization?branch=norm-test`, json("POST", { dry_run: true }));
    expect(res.status).toBe(200);
  });

  it("reports the total number of runs, not the page size", async () => {
    await app.request(`${base()}/normalization`, json("POST", { dry_run: true }));
    await app.request(`${base()}/normalization`, json("POST", { dry_run: true }));
    const body = (await (await app.request(`${base()}/normalization/history?limit=1&include_dry_runs=true`)).json()) as {
      items: unknown[];
      total: number;
    };
    expect(body.items).toHaveLength(1);
    expect(body.total).toBeGreaterThan(1);
  });
});

describe("IRI routes", () => {
  it("return 404 for an IRI that is not in the ontology", async () => {
    const missing = enc(`${NS}Nope`);
    for (const path of [`/ontology/tree/${missing}/children`, `/ontology/tree/${missing}/ancestors`, `/entities/${missing}/references`]) {
      expect((await app.request(`${base()}${path}`)).status, path).toBe(404);
    }
  });

  it("still return 200 for an IRI that is in the ontology", async () => {
    const pizza = enc(`${NS}Pizza`);
    for (const path of [`/ontology/tree/${pizza}/children`, `/ontology/tree/${pizza}/ancestors`, `/entities/${pizza}/references`]) {
      expect((await app.request(`${base()}${path}`)).status, path).toBe(200);
    }
  });
});

describe("branches", () => {
  it("returns 404 when deleting a branch that does not exist", async () => {
    expect((await app.request(`${base()}/branches/no-such-branch`, { method: "DELETE" })).status).toBe(404);
  });

  it("no longer has a checkout route", async () => {
    expect((await app.request(`${base()}/branches/main/checkout`, { method: "POST" })).status).toBe(404);
  });
});

describe("saving source", () => {
  it("rejects an unknown branch with 404 before committing", async () => {
    const res = await app.request(
      `${base()}/source?branch=no-such-branch`,
      json("PUT", { content: "@prefix : <http://example.org/x#> .\n:A a <http://www.w3.org/2002/07/owl#Class> .\n", commit_message: "x" }),
    );
    expect(res.status).toBe(404);
  });
});
