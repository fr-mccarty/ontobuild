// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PIZZA_TTL, createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

let dataDir: string;
let app: AppLike;

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
}, 30_000);

afterAll(() => removeDir(dataDir));

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function getProject(id: string): Promise<{ folder: string }> {
  return (await (await app.request(`/api/v1/projects/${id}`)).json()) as { folder: string };
}

function dirOf(folder: string) {
  return path.join(dataDir, "projects", folder);
}

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
}

async function putSource(id: string, content: string, branch = "main") {
  return app.request(
    `/api/v1/projects/${id}/source?branch=${branch}`,
    jsonInit("PUT", { content, commit_message: "Edit source" }),
  );
}

describe("project folders", () => {
  it("creates <folder>/ontology.ttl and <folder>/code/ as a clean git working tree", async () => {
    const id = await createPizzaProject(app);
    const { folder } = await getProject(id);
    expect(folder).toBe("pizza");
    const dir = dirOf(folder);
    expect(fs.readFileSync(path.join(dir, "ontology.ttl"), "utf8")).toContain(":Pizza a owl:Class");
    expect(fs.statSync(path.join(dir, "code")).isDirectory()).toBe(true);
    expect(gitIn(dir, "status", "--porcelain")).toBe("");
    expect(gitIn(dir, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
  });

  it("gives projects with the same name different folders", async () => {
    const a = await createPizzaProject(app);
    const b = await createPizzaProject(app);
    const fa = (await getProject(a)).folder;
    const fb = (await getProject(b)).folder;
    expect(fa).not.toBe(fb);
    expect(fb).toMatch(/^pizza-\d+$/);
  });

  it("writes edits on the checked-out branch to disk and keeps untracked code", async () => {
    const id = await createPizzaProject(app);
    const dir = dirOf((await getProject(id)).folder);
    fs.writeFileSync(path.join(dir, "code", "main.py"), "print('hi')\n");

    const res = await putSource(id, PIZZA_TTL.replace('"Topping"', '"Pizza topping"'));
    expect(res.ok).toBe(true);

    expect(fs.readFileSync(path.join(dir, "ontology.ttl"), "utf8")).toContain('"Pizza topping"');
    expect(fs.readFileSync(path.join(dir, "code", "main.py"), "utf8")).toBe("print('hi')\n");
    expect(gitIn(dir, "status", "--porcelain")).toBe("?? code/main.py\n");
  });

  it("leaves the folder alone for edits on other branches", async () => {
    const id = await createPizzaProject(app);
    const dir = dirOf((await getProject(id)).folder);
    const created = await app.request(`/api/v1/projects/${id}/branches`, jsonInit("POST", { name: "feature" }));
    expect(created.ok).toBe(true);

    const res = await putSource(id, PIZZA_TTL.replace('"Food"', '"Feature food"'), "feature");
    expect(res.ok).toBe(true);

    expect(fs.readFileSync(path.join(dir, "ontology.ttl"), "utf8")).not.toContain("Feature food");
    expect(gitIn(dir, "status", "--porcelain")).toBe("");
  });

  it("refuses an edit that would overwrite uncommitted changes to the ontology file", async () => {
    const id = await createPizzaProject(app);
    const dir = dirOf((await getProject(id)).folder);
    const file = path.join(dir, "ontology.ttl");
    const local = fs.readFileSync(file, "utf8") + "\n# local note\n";
    fs.writeFileSync(file, local);
    const before = gitIn(dir, "rev-parse", "HEAD");

    const res = await putSource(id, PIZZA_TTL.replace('"Food"', '"Food!"'));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/uncommitted changes/);

    expect(fs.readFileSync(file, "utf8")).toBe(local);
    expect(gitIn(dir, "rev-parse", "HEAD")).toBe(before);
  });

  it("updates the folder when a branch is merged into the checked-out branch", async () => {
    const git = await import("@/server/git");
    const id = await createPizzaProject(app);
    const dir = dirOf((await getProject(id)).folder);
    await git.createBranch(id, "merge-me", "main");
    await putSource(id, PIZZA_TTL.replace('"Food"', '"Merged food"'), "merge-me");

    const result = await git.mergeBranch(id, "merge-me", "main");
    expect(result.success).toBe(true);

    expect(fs.readFileSync(path.join(dir, "ontology.ttl"), "utf8")).toContain("Merged food");
    expect(gitIn(dir, "status", "--porcelain")).toBe("");
  });

  it("checks out the default branch when the checked-out branch is deleted", async () => {
    const git = await import("@/server/git");
    const id = await createPizzaProject(app);
    const dir = dirOf((await getProject(id)).folder);
    await git.createBranch(id, "temp", "main");
    await putSource(id, PIZZA_TTL.replace('"Food"', '"Temp food"'), "temp");
    await git.checkoutBranch(id, "temp");
    expect(fs.readFileSync(path.join(dir, "ontology.ttl"), "utf8")).toContain("Temp food");

    await git.deleteBranch(id, "temp", true);

    expect(gitIn(dir, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
    expect(fs.readFileSync(path.join(dir, "ontology.ttl"), "utf8")).not.toContain("Temp food");
  });

  it("deletes the folder with the project", async () => {
    const id = await createPizzaProject(app);
    const dir = dirOf((await getProject(id)).folder);
    expect(fs.existsSync(dir)).toBe(true);
    const res = await app.request(`/api/v1/projects/${id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("migrating legacy bare repositories", () => {
  it("moves data/repos/<id>.git into a checked-out project folder", async () => {
    const db = await import("@/server/db");
    const workspace = await import("@/server/workspace");

    // A project as it was stored before project folders: a row without a folder and a bare repo.
    const id = "legacy-project";
    db.insert("projects", {
      id,
      name: "Legacy Ontology",
      is_public: 0,
      owner_id: "local",
      created_at: db.nowIso(),
      source_file_path: `projects/${id}/ontology.ttl`,
      git_ontology_path: "ontology.ttl",
    });
    const scratch = fs.mkdtempSync(path.join(dataDir, "scratch-"));
    gitIn(scratch, "init", "--quiet", "--initial-branch=main");
    fs.writeFileSync(path.join(scratch, "ontology.ttl"), PIZZA_TTL);
    gitIn(scratch, "add", ".");
    gitIn(scratch, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "init");
    const legacy = path.join(dataDir, "repos", `${id}.git`);
    execFileSync("git", ["clone", "--quiet", "--bare", scratch, legacy]);

    workspace.migrateProjectFolders();

    const dir = workspace.projectDir(id)!;
    expect(path.basename(dir)).toBe("legacy-ontology");
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(path.join(dir, "ontology.ttl"), "utf8")).toBe(PIZZA_TTL);
    expect(fs.statSync(path.join(dir, "code")).isDirectory()).toBe(true);
    expect(gitIn(dir, "status", "--porcelain")).toBe("");
    const tree = await (await app.request(`/api/v1/projects/${id}/source?branch=main`)).text();
    expect(tree).toContain(":Pizza");
  });
});

describe("local-only API", () => {
  it("rejects requests for a non-loopback Host (DNS rebinding)", async () => {
    const res = await app.request("http://evil.example/api/v1/health");
    expect(res.status).toBe(403);
  });

  it("rejects browser requests from another origin", async () => {
    const res = await app.request("http://localhost:3000/api/v1/projects", {
      ...jsonInit("POST", { name: "x" }),
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
    const sameSiteOtherPort = await app.request("http://localhost:3000/api/v1/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(sameSiteOtherPort.status).toBe(403);
    const noOrigin = await app.request("http://localhost:3000/api/v1/health", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(noOrigin.status).toBe(403);
  });

  it("allows same-origin browser requests and non-browser clients", async () => {
    const same = await app.request("http://localhost:3000/api/v1/health", {
      headers: { Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin" },
    });
    expect(same.status).toBe(200);
    expect((await app.request("http://127.0.0.1:3000/api/v1/health")).status).toBe(200);
    expect((await app.request("/api/v1/health")).status).toBe(200);
  });
});
