// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./helpers";
import type { ToolContext, ToolExecution } from "@/server/agent/tools";

/** The sidebar agent committing changes made in the project folder outside its ontology tools. */

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

describe("commit_folder_changes", () => {
  const codeCtx = (): ToolContext => ({ ...ctx, permissions: { edit_ontology: true, edit_code: true, edit_imports: false } });
  const runCode = async (input: Record<string, unknown> = {}) => {
    const out = await executeTool("commit_folder_changes", input, codeCtx());
    return { ...out, data: out.is_error ? null : JSON.parse(out.content) };
  };

  it("commits added, modified and deleted files with the agent's message, leaving out the ontology file and node_modules", async () => {
    // Start clean: commit what the previous describe left in the ontology file.
    if (sh("status", "--porcelain")) await run("commit_ontology_folder_changes");
    fs.mkdirSync(path.join(folder, "code"), { recursive: true });
    fs.writeFileSync(path.join(folder, "code", "old.py"), "print('old')\n");
    fs.writeFileSync(path.join(folder, "code", "keep.py"), "print(1)\n");
    await runCode({ commit_message: "Add scripts" });

    fs.writeFileSync(path.join(folder, "code", "keep.py"), "print(2)\n");
    fs.rmSync(path.join(folder, "code", "old.py"));
    fs.writeFileSync(path.join(folder, "code", "new.py"), "print('new')\n");
    fs.mkdirSync(path.join(folder, "code", "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(folder, "code", "node_modules", "pkg", "index.js"), "x");
    fs.appendFileSync(ontologyFile, OUTSIDE_EDIT.replace(/Calzone/g, "Stromboli"));

    const changes = (await (await app.request(`/api/v1/projects/${ctx.projectId}/files/changes`)).json()) as {
      files: { path: string; status: string }[];
      ontology_changed: boolean;
    };
    expect(changes.ontology_changed).toBe(true);
    expect(changes.files).toEqual(
      expect.arrayContaining([
        { path: "code/keep.py", status: "modified" },
        { path: "code/old.py", status: "deleted" },
        { path: "code/new.py", status: "added" },
      ]),
    );
    expect(changes.files).toHaveLength(3);

    const out = await runCode({ commit_message: "Rework the scripts" });
    expect(out.is_error).toBe(false);
    expect(out.summary).toBe("Committed 3 files on main");
    expect(out.data.ontology_changed).toBe(true);
    expect(out.data.commit_hash).toBe(sh("rev-parse", "main"));
    expect(sh("log", "-1", "--format=%s")).toBe("Rework the scripts");
    expect(sh("show", "--name-status", "--format=", "HEAD").split("\n").sort()).toEqual([
      "A\tcode/new.py",
      "D\tcode/old.py",
      "M\tcode/keep.py",
    ]);
    // The ontology file and node_modules are still uncommitted.
    const raw = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "-z"], { cwd: folder, encoding: "utf8", env: ENV });
    expect(raw.split("\0").filter(Boolean).sort()).toEqual([
      " M ontology.ttl",
      "?? code/node_modules/pkg/index.js",
    ]);
  });

  it("is an error when there is nothing to commit", async () => {
    const out = await runCode();
    expect(out.is_error).toBe(true);
    expect(out.summary).toContain("no uncommitted changes");
  });

  it("is refused without permission to edit code", async () => {
    fs.writeFileSync(path.join(folder, "code", "blocked.py"), "x\n");
    const out = await executeTool("commit_folder_changes", {}, { ...ctx, permissions: { edit_ontology: true, edit_code: false, edit_imports: false } });
    expect(out.is_error).toBe(true);
    expect(sh("status", "--porcelain", "--", "code/blocked.py")).toBe("?? code/blocked.py");
  });
});
