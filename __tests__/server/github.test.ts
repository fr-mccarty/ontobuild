// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

let dataDir: string;
let tmp: string;
let app: AppLike;

beforeAll(async () => {
  dataDir = useTempDataDir();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ontobuild-github-test-"));
  process.env.ONTOBUILD_GH_BIN = path.join(tmp, "no-such-gh");
  app = (await import("@/server/app")).default;
}, 30_000);

afterAll(() => {
  removeDir(dataDir);
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ONTOBUILD_GH_BIN;
});

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Other",
  GIT_AUTHOR_EMAIL: "other@example.org",
  GIT_COMMITTER_NAME: "Other",
  GIT_COMMITTER_EMAIL: "other@example.org",
};
for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete (GIT_ENV as Record<string, string | undefined>)[k];

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
}

function bareRemote(name: string): { dir: string; url: string } {
  const dir = path.join(tmp, `${name}.git`);
  execFileSync("git", ["init", "--bare", "--quiet", "--initial-branch=main", dir], { env: GIT_ENV });
  return { dir, url: `file://${dir}` };
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function folderOf(id: string): Promise<string> {
  const p = (await (await app.request(`/api/v1/projects/${id}`)).json()) as { folder: string };
  return path.join(dataDir, "projects", p.folder);
}

interface Remote {
  remote_url: string | null;
  web_url: string | null;
  branch: string;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  gh_available: boolean;
  output?: string;
}

async function call(id: string, method: string, sub = "", body?: unknown): Promise<{ status: number; data: Remote & { detail?: string } }> {
  const res = await app.request(`/api/v1/projects/${id}/github${sub}`, json(method, body));
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : ({} as Remote) };
}

describe("GitHub link", () => {
  it("reports an unlinked project", async () => {
    const id = await createPizzaProject(app);
    const { status, data } = await call(id, "GET");
    expect(status).toBe(200);
    expect(data).toMatchObject({ remote_url: null, web_url: null, branch: "main", upstream: null, ahead: null, behind: null, gh_available: false });
  });

  it("validates remote URLs and derives the web URL", async () => {
    const id = await createPizzaProject(app);
    expect((await call(id, "PUT", "", { remote_url: "not a url" })).status).toBe(400);
    expect((await call(id, "PUT", "", { remote_url: "http://github.com/a/b" })).status).toBe(400);
    expect((await call(id, "PUT", "", { remote_url: "https://user:tok@github.com/a/b.git" })).status).toBe(400);
    expect((await call(id, "PUT", "", { remote_url: "https://github.com/a" })).status).toBe(400);
    expect((await call(id, "PUT", "", {})).status).toBe(400);

    let r = await call(id, "PUT", "", { remote_url: "git@github.com:acme/pizza.git" });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ remote_url: "git@github.com:acme/pizza.git", web_url: "https://github.com/acme/pizza", is_github: true });
    r = await call(id, "PUT", "", { remote_url: "https://github.com/acme/pizza2.git" });
    expect(r.data).toMatchObject({ web_url: "https://github.com/acme/pizza2", is_github: true });
    r = await call(id, "PUT", "", { remote_url: "https://gitlab.com/group/sub/repo.git" });
    expect(r.data).toMatchObject({ web_url: "https://gitlab.com/group/sub/repo", is_github: false, host: "gitlab.com" });

    expect((await call(id, "DELETE")).status).toBe(204);
    expect((await call(id, "GET")).data.remote_url).toBeNull();
    expect((await call(id, "DELETE")).status).toBe(404);
  });

  it("pushes, pulls fast-forward, tracks ahead/behind and refuses a diverged pull", async () => {
    const id = await createPizzaProject(app);
    const folder = await folderOf(id);
    const remote = bareRemote("pizza");

    expect((await call(id, "POST", "/push")).status).toBe(409); // not linked yet
    expect((await call(id, "PUT", "", { remote_url: remote.url })).status).toBe(200);

    const pushed = await call(id, "POST", "/push");
    expect(pushed.status).toBe(200);
    expect(pushed.data).toMatchObject({ upstream: "origin/main", ahead: 0, behind: 0 });
    expect(sh(remote.dir, "rev-parse", "main").trim()).toBe(sh(folder, "rev-parse", "main").trim());

    // Another clone pushes a commit.
    const clone = path.join(tmp, "clone");
    execFileSync("git", ["clone", "--quiet", remote.dir, clone], { env: GIT_ENV });
    const ttl = path.join(clone, "ontology.ttl");
    fs.writeFileSync(ttl, fs.readFileSync(ttl, "utf8") + '\n:Cheese a owl:Class ;\n    rdfs:label "Cheese" .\n');
    sh(clone, "commit", "--quiet", "-am", "Add Cheese");
    sh(clone, "push", "--quiet", "origin", "main");

    const fetched = await call(id, "POST", "/fetch");
    expect(fetched.status).toBe(200);
    expect(fetched.data).toMatchObject({ ahead: 0, behind: 1 });

    const pulled = await call(id, "POST", "/pull");
    expect(pulled.status).toBe(200);
    expect(pulled.data).toMatchObject({ ahead: 0, behind: 0 });
    expect(fs.readFileSync(path.join(folder, "ontology.ttl"), "utf8")).toContain('"Cheese"');
    const tree = (await (await app.request(`/api/v1/projects/${id}/source?branch=main`)).text());
    expect(tree).toContain("Cheese");

    // Local commit → ahead 1.
    const src = fs.readFileSync(path.join(folder, "ontology.ttl"), "utf8");
    const put = await app.request(
      `/api/v1/projects/${id}/source?branch=main`,
      json("PUT", { content: src + '\n:Olive a owl:Class ;\n    rdfs:label "Olive" .\n', commit_message: "Add Olive" }),
    );
    expect(put.ok).toBe(true);
    expect((await call(id, "GET")).data).toMatchObject({ ahead: 1, behind: 0 });

    // Remote diverges.
    fs.writeFileSync(ttl, fs.readFileSync(ttl, "utf8") + '\n:Basil a owl:Class ;\n    rdfs:label "Basil" .\n');
    sh(clone, "commit", "--quiet", "-am", "Add Basil");
    sh(clone, "push", "--quiet", "origin", "main");
    const diverged = await call(id, "POST", "/pull");
    expect(diverged.status).toBe(409);
    expect(diverged.data.detail).toMatch(/fast-forward/);
    expect((await call(id, "GET")).data).toMatchObject({ ahead: 1, behind: 1 });

    // Push is rejected too.
    const rejected = await call(id, "POST", "/push");
    expect(rejected.status).toBe(409);
  });

  it("refuses a pull that would overwrite uncommitted changes in the folder", async () => {
    const id = await createPizzaProject(app);
    const folder = await folderOf(id);
    const remote = bareRemote("pizza-dirty");
    await call(id, "PUT", "", { remote_url: remote.url });
    expect((await call(id, "POST", "/push")).status).toBe(200);
    const clone = path.join(tmp, "clone-dirty");
    execFileSync("git", ["clone", "--quiet", remote.dir, clone], { env: GIT_ENV });
    const ttl = path.join(clone, "ontology.ttl");
    fs.writeFileSync(ttl, fs.readFileSync(ttl, "utf8") + "\n# remote edit\n");
    sh(clone, "commit", "--quiet", "-am", "Remote edit");
    sh(clone, "push", "--quiet", "origin", "main");

    const local = path.join(folder, "ontology.ttl");
    const before = fs.readFileSync(local, "utf8") + "\n# local uncommitted edit\n";
    fs.writeFileSync(local, before);
    const r = await call(id, "POST", "/pull");
    expect(r.status).toBe(409);
    expect(r.data.detail).toMatch(/uncommitted changes/);
    expect(fs.readFileSync(local, "utf8")).toBe(before);
  });

  it("pushes all branches", async () => {
    const id = await createPizzaProject(app);
    const remote = bareRemote("pizza-all");
    await app.request(`/api/v1/projects/${id}/branches`, json("POST", { name: "feature" }));
    await call(id, "PUT", "", { remote_url: remote.url });
    expect((await call(id, "POST", "/push", { all: true })).status).toBe(200);
    expect(sh(remote.dir, "branch", "--list", "--format=%(refname:short)").split("\n").map((s) => s.trim()).filter(Boolean).sort()).toEqual(["feature", "main"]);
  });

  it("refuses to create a GitHub repository without gh", async () => {
    const id = await createPizzaProject(app);
    const r = await call(id, "POST", "/create", { name: "pizza", private: true });
    expect(r.status).toBe(400);
    expect(r.data.detail).toMatch(/gh/);
    expect((await call(id, "POST", "/create", { name: "bad name!", private: true })).status).toBe(400);
  });
});
