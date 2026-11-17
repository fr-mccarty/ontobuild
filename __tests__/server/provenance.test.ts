// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PIZZA_TTL, createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

let dataDir: string;
let app: AppLike;

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
}, 30_000);

afterAll(() => removeDir(dataDir));

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const PIZZA = "http://example.org/pizza#Pizza";
const TOPPING = "http://example.org/pizza#Topping";
const COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";

interface Prov {
  status: string;
  on_default_branch: boolean;
  introduced_in: { message: string; short_hash: string } | null;
  pull_request: { number: number; status: string; approvals: { reviewer: string }[] } | null;
}

async function prov(id: string, iri: string, value: string, branch?: string): Promise<Prov> {
  const q = new URLSearchParams({ iri, property: COMMENT, value, ...(branch ? { branch } : {}) });
  const res = await app.request(`/api/v1/projects/${id}/provenance?${q}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Prov;
}

async function putSource(id: string, content: string, branch: string, message: string) {
  const res = await app.request(`/api/v1/projects/${id}/source?branch=${branch}`, json("PUT", { content, commit_message: message }));
  expect(res.ok).toBe(true);
}

describe("provenance", () => {
  it("tracks a value from a direct commit, through a pending PR, to approved", async () => {
    const id = await createPizzaProject(app);

    // Seeded directly on main.
    const direct = await prov(id, PIZZA, "A baked dish");
    expect(direct.status).toBe("direct");
    expect(direct.on_default_branch).toBe(true);
    expect(direct.introduced_in?.message).toBe("Seed pizza ontology");
    expect(direct.pull_request).toBeNull();

    // Not present anywhere.
    expect((await prov(id, PIZZA, "nope")).status).toBe("unknown");

    // Added on a branch.
    await app.request(`/api/v1/projects/${id}/branches`, json("POST", { name: "prompt" }));
    const withPrompt = PIZZA_TTL.replace(
      ':Topping a owl:Class ;\n    rdfs:label "Topping" .',
      ':Topping a owl:Class ;\n    rdfs:label "Topping" ;\n    rdfs:comment "Summarize every \\"topping\\" in one line" .',
    );
    await putSource(id, withPrompt, "prompt", "Add a prompt");
    const value = 'Summarize every "topping" in one line';

    let p = await prov(id, TOPPING, value, "prompt");
    expect(p.status).toBe("pending");
    expect(p.pull_request).toBeNull();
    expect(p.introduced_in?.message).toBe("Add a prompt");

    const prRes = await app.request(
      `/api/v1/projects/${id}/pull-requests`,
      json("POST", { title: "Agree the prompt", source_branch: "prompt", target_branch: "main" }),
    );
    expect(prRes.status).toBe(201);
    const pr = (await prRes.json()) as { pr_number: number };

    p = await prov(id, TOPPING, value, "prompt");
    expect(p.status).toBe("pending");
    expect(p.pull_request).toMatchObject({ number: pr.pr_number, status: "open", approvals: [] });
    // Viewed from main it is still found through the open PR.
    expect((await prov(id, TOPPING, value)).status).toBe("pending");

    const review = await app.request(
      `/api/v1/projects/${id}/pull-requests/${pr.pr_number}/reviews`,
      json("POST", { status: "approved", body: "LGTM" }),
    );
    expect(review.status).toBe(201);
    p = await prov(id, TOPPING, value, "prompt");
    expect(p.pull_request?.approvals).toHaveLength(1);

    const merge = await app.request(`/api/v1/projects/${id}/pull-requests/${pr.pr_number}/merge`, json("POST", {}));
    expect(merge.status).toBe(200);

    p = await prov(id, TOPPING, value);
    expect(p.status).toBe("approved");
    expect(p.on_default_branch).toBe(true);
    expect(p.introduced_in?.message).toBe("Add a prompt");
    expect(p.pull_request).toMatchObject({ number: pr.pr_number, status: "merged" });
    expect(p.pull_request?.approvals[0].reviewer).toBe("Local User");

    // The seeded value is still direct.
    expect((await prov(id, PIZZA, "A baked dish")).status).toBe("direct");
  });

  it("treats a merged PR without approvals as direct", async () => {
    const id = await createPizzaProject(app);
    await app.request(`/api/v1/projects/${id}/branches`, json("POST", { name: "quick" }));
    await putSource(id, PIZZA_TTL.replace('rdfs:label "Food" .', 'rdfs:label "Food" ;\n    rdfs:comment "Edible things" .'), "quick", "Describe food");
    const pr = (await (
      await app.request(`/api/v1/projects/${id}/pull-requests`, json("POST", { title: "Food", source_branch: "quick" }))
    ).json()) as { pr_number: number };
    expect((await app.request(`/api/v1/projects/${id}/pull-requests/${pr.pr_number}/merge`, json("POST", {}))).status).toBe(200);
    const p = await prov(id, "http://example.org/pizza#Food", "Edible things");
    expect(p.status).toBe("direct");
    expect(p.pull_request?.number).toBe(pr.pr_number);
  });

  it("answers a batch in order and validates input", async () => {
    const id = await createPizzaProject(app);
    const res = await app.request(
      `/api/v1/projects/${id}/provenance/batch`,
      json("POST", {
        items: [
          { iri: PIZZA, property: COMMENT, value: "A baked dish" },
          { iri: PIZZA, property: COMMENT, value: "missing" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Prov[] };
    expect(body.items.map((i) => i.status)).toEqual(["direct", "unknown"]);

    expect((await app.request(`/api/v1/projects/${id}/provenance/batch`, json("POST", { items: "x" }))).status).toBe(422);
    expect((await app.request(`/api/v1/projects/${id}/provenance/batch`, json("POST", { items: [{ iri: PIZZA }] }))).status).toBe(422);
    expect((await app.request(`/api/v1/projects/${id}/provenance?property=${encodeURIComponent(COMMENT)}&value=x`)).status).toBe(422);
    expect((await app.request(`/api/v1/projects/nope/provenance/batch`, json("POST", { items: [] }))).status).toBe(404);
  });
});
