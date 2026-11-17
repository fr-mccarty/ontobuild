// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./helpers";
import type { ToolContext, ToolExecution } from "@/server/agent/tools";

/** The sidebar agent committing changes made to the ontology file outside its ontology tools. */

let dataDir: string;
let app: AppLike;
let executeTool: (name: string, input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolExecution>;
let ctx: ToolContext;
let ontologyFile: string;
let folder: string;

const ENV = { ...process.env };
for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete (ENV as Record<string, string | undefined>)[k];
const sh = (...args: string[]) => execFileSync("git", args, { cwd: folder, encoding: "utf8", env: ENV }).trim();

async function run(name: string, input: Record<string, unknown> = {}) {
  const out = await executeTool(name, input, ctx);
  return { ...out, data: JSON.parse(out.content) };
}

const OUTSIDE_EDIT = `
<http://example.org/pizza#Calzone> a <http://www.w3.org/2002/07/owl#Class> ;
    <http://www.w3.org/2000/01/rdf-schema#label> "Calzone" .
`;

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
  executeTool = (await import("@/server/agent/tools")).executeTool;
  const projectId = await createPizzaProject(app);
  const project = (await (await app.request(`/api/v1/projects/${projectId}`)).json()) as { folder: string; git_ontology_path: string };
  folder = path.join(dataDir, "projects", project.folder);
  ontologyFile = path.join(folder, project.git_ontology_path);
  ctx = { projectId, branch: "main", request: (p, init) => Promise.resolve(app.request(p, init)) };
}, 30_000);

afterAll(() => removeDir(dataDir));

describe("commit_ontology_folder_changes", () => {
  it("get_project reports no uncommitted changes when there are none", async () => {
    expect((await run("get_project")).data.uncommitted_ontology_changes).toBeNull();
  });

  it("get_project reports changes made in the folder, and the agent commits them with its message", async () => {
    fs.appendFileSync(ontologyFile, OUTSIDE_EDIT);
    expect((await run("get_project")).data.uncommitted_ontology_changes).toEqual({
      path: "ontology.ttl",
      folder_branch: "main",
      can_commit: true,
      problem: null,
    });

    const out = await run("commit_ontology_folder_changes", { commit_message: "Add Calzone" });
    expect(out.is_error).toBe(false);
    expect(out.summary).toBe("Committed the changes to ontology.ttl on main");
    // Reported like every other commit, so the user's editor reloads.
    expect(out.ontology_changes).toEqual([{ branch: "main", commit_hash: sh("rev-parse", "main"), deleted_iris: [] }]);
    expect(sh("log", "-1", "--format=%s")).toBe("Add Calzone");
    expect(sh("status", "--porcelain")).toBe("");

    const entity = await run("get_entity", { iri: "http://example.org/pizza#Calzone" });
    expect(entity.is_error).toBe(false);
    expect((await run("get_project")).data.uncommitted_ontology_changes).toBeNull();
  });

  it("is an error when there is nothing to commit", async () => {
    const out = await run("commit_ontology_folder_changes");
    expect(out.is_error).toBe(true);
    expect(out.summary).toContain("no uncommitted changes");
  });

  it("is refused without permission to edit the ontology", async () => {
    fs.appendFileSync(ontologyFile, "\n");
    const readOnly: ToolContext = {
      ...ctx,
      permissions: { edit_ontology: false, edit_code: false, edit_imports: false },
    };
    const out = await executeTool("commit_ontology_folder_changes", {}, readOnly);
    expect(out.is_error).toBe(true);
    expect(sh("status", "--porcelain")).not.toBe("");
  });
});
