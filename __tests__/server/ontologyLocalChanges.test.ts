// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PIZZA_TTL, createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

/** The ontology file changed in the project folder, outside OntoBuild, and committing it. */

let dataDir: string;
let app: AppLike;
let projectId: string;
let folder: string;

const ENV = { ...process.env };
for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete (ENV as Record<string, string | undefined>)[k];
const sh = (...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8", env: ENV });

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
}, 30_000);

afterAll(() => removeDir(dataDir));

beforeEach(async () => {
  projectId = await createPizzaProject(app);
  const res = await app.request(`/api/v1/projects/${projectId}`);
  const project = (await res.json()) as { folder: string; git_ontology_path: string };
  folder = path.join(dataDir, "projects", project.folder);
  expect(fs.existsSync(path.join(folder, project.git_ontology_path))).toBe(true);
});

const ontologyFile = () => path.join(folder, "ontology.ttl");
const base = () => `/api/v1/projects/${projectId}/ontology-file/local-changes`;

async function status() {
  const res = await app.request(base());
  expect(res.status).toBe(200);
  return (await res.json()) as { branch: string | null; path: string | null; changed: boolean; problem: string | null };
}

const commit = () => app.request(`${base()}/commit`, { method: "POST" });

const AGENT_ADDITION = `
<http://example.org/pizza#Calzone> a <http://www.w3.org/2002/07/owl#Class> ;
    <http://www.w3.org/2000/01/rdf-schema#label> "Calzone" .
`;

describe("Uncommitted changes to the ontology file", () => {
  it("reports nothing when the folder matches the last commit", async () => {
    expect(await status()).toEqual({ branch: "main", path: "ontology.ttl", changed: false, problem: null });
  });

  it("reports a change made in the folder, and commits it so the editor shows it", async () => {
    fs.appendFileSync(ontologyFile(), AGENT_ADDITION);
    expect(await status()).toEqual({ branch: "main", path: "ontology.ttl", changed: true, problem: null });

    const res = await commit();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { branch: string; commit_hash: string };
    expect(body.branch).toBe("main");
    expect(sh("rev-parse", "main").trim()).toBe(body.commit_hash);
    expect(sh("log", "-1", "--format=%s").trim()).toBe("Commit changes to ontology.ttl made outside OntoBuild");

    // The folder is clean and the editor's source now has the change.
    expect(sh("status", "--porcelain").trim()).toBe("");
    expect((await status()).changed).toBe(false);
    const source = await app.request(`/api/v1/projects/${projectId}/source?branch=main`);
    expect(await source.text()).toContain("Calzone");
  });

  it("lets the editor save again after committing (the folder matches the index)", async () => {
    fs.appendFileSync(ontologyFile(), AGENT_ADDITION);
    expect((await commit()).status).toBe(200);
    const put = await app.request(`/api/v1/projects/${projectId}/source?branch=main`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: PIZZA_TTL, commit_message: "Back to the seed" }),
    });
    expect(put.ok).toBe(true);
  });

  it("explains, and refuses to commit, a file that doesn't parse", async () => {
    fs.appendFileSync(ontologyFile(), "\n<http://example.org/pizza#Broken> <http://example.org/p> .\n");
    const s = await status();
    expect(s.changed).toBe(true);
    expect(s.problem).toMatch(/^The file doesn't parse as Turtle: /);
    const res = await commit();
    expect(res.status).toBe(422);
    expect(sh("log", "-1", "--format=%s").trim()).toBe("Seed pizza ontology");
  });

  it("explains a file deleted from the folder", async () => {
    fs.rmSync(ontologyFile());
    const s = await status();
    expect(s.changed).toBe(true);
    expect(s.problem).toBe("The file is missing from the project folder.");
  });

  it("refuses to commit when nothing changed", async () => {
    expect((await commit()).status).toBe(409);
  });
});
