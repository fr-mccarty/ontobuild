// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PIZZA_TTL, removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

let dataDir: string;
let tmp: string;
let app: AppLike;

beforeAll(async () => {
  dataDir = useTempDataDir();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ontobuild-clone-test-"));
  process.env.ONTOBUILD_GH_BIN = path.join(tmp, "no-such-gh");
  app = (await import("@/server/app")).default;
}, 30_000);

afterAll(() => {
  removeDir(dataDir);
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ONTOBUILD_GH_BIN;
});

afterEach(() => {
  delete process.env.ONTOBUILD_CLONE_TIMEOUT_MS;
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

const PIZZA_RDFXML = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
         xmlns:owl="http://www.w3.org/2002/07/owl#">
  <owl:Ontology rdf:about="http://example.org/xmlpizza">
    <rdfs:comment>Pizza in RDF/XML</rdfs:comment>
  </owl:Ontology>
  <owl:Class rdf:about="http://example.org/xmlpizza#Pizza">
    <rdfs:label xml:lang="en">Pizza</rdfs:label>
  </owl:Class>
</rdf:RDF>
`;

/** A bare repository with the given files committed on `main` (and optional extra branches). */
function makeRemote(name: string, files: Record<string, string>, branches: Record<string, Record<string, string>> = {}): string {
  const work = path.join(tmp, `${name}-work`);
  fs.mkdirSync(work, { recursive: true });
  sh(work, "init", "--quiet", "--initial-branch=main");
  const write = (fileMap: Record<string, string>) => {
    for (const [rel, content] of Object.entries(fileMap)) {
      fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
      fs.writeFileSync(path.join(work, rel), content);
    }
    sh(work, "add", "-A");
  };
  write(files);
  sh(work, "commit", "--quiet", "--allow-empty", "-m", "First commit");
  sh(work, "commit", "--quiet", "--allow-empty", "-m", "Second commit");
  for (const [b, fileMap] of Object.entries(branches)) {
    sh(work, "checkout", "--quiet", "-b", b);
    write(fileMap);
    sh(work, "commit", "--quiet", "-m", `On ${b}`);
    sh(work, "checkout", "--quiet", "main");
  }
  const bare = path.join(tmp, `${name}.git`);
  execFileSync("git", ["clone", "--quiet", "--bare", work, bare], { env: GIT_ENV });
  return `file://${bare}`;
}

interface CloneResponse {
  id: string;
  name: string;
  description: string | null;
  folder: string;
  source_file_path: string | null;
  git_ontology_path: string | null;
  ontology_iri: string | null;
  normalization_report: { original_format: string; notes: string[] } | null;
  git_import: {
    remote_url: string;
    branch: string | null;
    ontology_path: string | null;
    source_path: string | null;
    converted: boolean;
    selection: string;
    candidates: { path: string; declares_ontology: boolean }[];
    warnings: string[];
  };
  detail?: string;
}

async function clone(body: unknown): Promise<{ status: number; data: CloneResponse }> {
  const res = await app.request("/api/v1/projects/clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as CloneResponse };
}

function projectFolders(): string[] {
  const dir = path.join(dataDir, "projects");
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

async function projectCount(): Promise<number> {
  const res = await app.request("/api/v1/projects?limit=100");
  return ((await res.json()) as { total: number }).total;
}

describe("Import a project from a Git repository", () => {
  it("clones with history, links origin and edits ontology.ttl in place", async () => {
    const url = makeRemote("pizza", { "ontology.ttl": PIZZA_TTL, "other/extra.ttl": PIZZA_TTL, "README.md": "# Pizza\n" });
    const { status, data } = await clone({ url });
    expect(status).toBe(201);
    expect(data.name).toBe("pizza");
    expect(data.git_ontology_path).toBe("ontology.ttl");
    expect(data.ontology_iri).toBe("http://example.org/pizza");
    expect(data.normalization_report).toBeNull();
    expect(data.git_import).toMatchObject({
      remote_url: url,
      branch: "main",
      ontology_path: "ontology.ttl",
      source_path: "ontology.ttl",
      converted: false,
      selection: "automatic",
    });
    expect(data.git_import.candidates.map((c) => c.path)).toEqual(["ontology.ttl", "other/extra.ttl"]);

    const folder = path.join(dataDir, "projects", data.folder);
    expect(sh(folder, "log", "--format=%s").trim().split("\n")).toEqual(["Second commit", "First commit"]);
    expect(fs.existsSync(path.join(folder, "code"))).toBe(true);
    expect(fs.readFileSync(path.join(folder, "ontology.ttl"), "utf8")).toBe(PIZZA_TTL);

    // The editor reads it, and the Repository button sees the remote and its upstream.
    const tree = await app.request(`/api/v1/projects/${data.id}/source`);
    expect(tree.status).toBe(200);
    const remote = (await (await app.request(`/api/v1/projects/${data.id}/github`)).json()) as Record<string, unknown>;
    expect(remote).toMatchObject({ remote_url: url, upstream: "origin/main", ahead: 0, behind: 0 });
    const fetched = await app.request(`/api/v1/projects/${data.id}/github/fetch`, { method: "POST" });
    expect(fetched.status).toBe(200);
  });

  it("uses the name and description given, and checks out the requested branch", async () => {
    const url = makeRemote("branchy", { "README.md": "hi\n" }, { develop: { "src/onto.ttl": PIZZA_TTL } });
    const { status, data } = await clone({ url, branch: "develop", name: "My Pizza", description: "Mine" });
    expect(status).toBe(201);
    expect(data).toMatchObject({ name: "My Pizza", description: "Mine", git_ontology_path: "src/onto.ttl" });
    expect(data.git_import.branch).toBe("develop");
    const source = (await (await app.request(`/api/v1/projects/${data.id}/source`)).json()) as { branch: string; filename: string };
    expect(source).toMatchObject({ branch: "develop", filename: "src/onto.ttl" });
  });

  it("prefers a file declaring owl:Ontology outside test folders, and Turtle over RDF/XML", async () => {
    const vocab = "@prefix ex: <http://example.org/> .\nex:a ex:b ex:c .\n";
    const url = makeRemote("ranked", {
      "data.ttl": vocab,
      "tests/fixture.ttl": PIZZA_TTL,
      "src/pizza.owl": PIZZA_RDFXML,
      "src/ontology/pizza.ttl": PIZZA_TTL,
      "package.json": "{}",
    });
    const { data } = await clone({ url });
    expect(data.git_import.ontology_path).toBe("src/ontology/pizza.ttl");
    expect(data.git_import.candidates.map((c) => c.path)).toEqual([
      "src/ontology/pizza.ttl",
      "src/pizza.owl",
      "tests/fixture.ttl",
      "data.ttl",
    ]);
  });

  it("converts a non-Turtle ontology to ontology.ttl in a local commit and keeps the original", async () => {
    const url = makeRemote("xmlpizza", { "src/pizza.owl": PIZZA_RDFXML });
    const { status, data } = await clone({ url });
    expect(status).toBe(201);
    expect(data.git_import).toMatchObject({ ontology_path: "ontology.ttl", source_path: "src/pizza.owl", converted: true });
    expect(data).toMatchObject({ git_ontology_path: "ontology.ttl", ontology_iri: "http://example.org/xmlpizza", description: "Pizza in RDF/XML" });
    expect(data.normalization_report?.original_format).toBe("RDF/XML");
    expect(data.normalization_report?.notes.join("\n")).toMatch(/Removed language tags from 1 literal/);

    const folder = path.join(dataDir, "projects", data.folder);
    expect(fs.readFileSync(path.join(folder, "src/pizza.owl"), "utf8")).toBe(PIZZA_RDFXML);
    expect(fs.readFileSync(path.join(folder, "ontology.ttl"), "utf8")).toMatch(/xmlpizza#Pizza/);
    expect(sh(folder, "log", "-1", "--format=%s").trim()).toBe("Convert src/pizza.owl to Turtle for OntoBuild");
    expect(sh(folder, "status", "--porcelain").trim()).toBe("");
    const remote = (await (await app.request(`/api/v1/projects/${data.id}/github`)).json()) as Record<string, unknown>;
    expect(remote).toMatchObject({ ahead: 1, behind: 0 });
  });

  it("uses the requested ontology_path, and rejects one that isn't there", async () => {
    const url = makeRemote("picked", { "a.ttl": PIZZA_TTL, "b/b.ttl": PIZZA_TTL });
    const picked = await clone({ url, ontology_path: "b/b.ttl" });
    expect(picked.status).toBe(201);
    expect(picked.data.git_import).toMatchObject({ ontology_path: "b/b.ttl", selection: "requested" });

    const before = projectFolders();
    const count = await projectCount();
    const missing = await clone({ url, ontology_path: "nope.ttl" });
    expect(missing.status).toBe(422);
    expect(missing.data.detail).toMatch(/nope\.ttl isn't in the repository.*a\.ttl/);
    expect((await clone({ url, ontology_path: "../etc/passwd" })).status).toBe(422);
    expect(projectFolders()).toEqual(before);
    expect(await projectCount()).toBe(count);
  });

  it("creates a project without an ontology when the repository has none, skipping unreadable files", async () => {
    const url = makeRemote("noonto", { "README.md": "nothing\n", "broken.ttl": "this is not turtle" });
    const { status, data } = await clone({ url });
    expect(status).toBe(201);
    expect(data).toMatchObject({ source_file_path: null, git_ontology_path: null, ontology_iri: null });
    expect(data.git_import).toMatchObject({ ontology_path: null, selection: "none" });
    expect(data.git_import.warnings.join("\n")).toMatch(/Skipped broken\.ttl/);
    expect(data.git_import.warnings.join("\n")).toMatch(/no ontology yet/);
  });

  it("validates the URL and branch without cloning", async () => {
    const before = projectFolders();
    for (const url of [
      "",
      "not a url",
      "/tmp/some/repo",
      "ext::sh -c touch% /tmp/pwned",
      "ext::foo",
      "-uploadpack=touch",
      "git@-oProxyCommand:a/b",
      "http://github.com/a/b",
      "ftp://example.org/a/b",
      "https://user:token@github.com/a/b.git",
    ]) {
      const { status } = await clone({ url });
      expect([400, 422], url).toContain(status);
    }
    expect((await clone({ url: "https://github.com/a/b.git", branch: "-bad" })).status).toBe(422);
    expect((await clone({ url: "https://github.com/a/b.git", branch: "a..b" })).status).toBe(422);
    expect(projectFolders()).toEqual(before);
  });

  it("reports a missing repository and a missing branch, cleaning up the partial project", async () => {
    const before = projectFolders();
    const count = await projectCount();
    const missing = await clone({ url: `file://${path.join(tmp, "nope.git")}` });
    expect(missing.status).toBe(404);
    expect(missing.data.detail).toMatch(/Repository not found/);

    const url = makeRemote("onebranch", { "ontology.ttl": PIZZA_TTL });
    const badBranch = await clone({ url, branch: "nope" });
    expect(badBranch.status).toBe(404);
    expect(badBranch.data.detail).toMatch(/no branch 'nope'/);
    expect(projectFolders()).toEqual(before);
    expect(await projectCount()).toBe(count);
  });

  it("stops a clone that takes too long and cleans up", async () => {
    const url = makeRemote("slow", { "ontology.ttl": PIZZA_TTL });
    const before = projectFolders();
    process.env.ONTOBUILD_CLONE_TIMEOUT_MS = "1";
    const { status, data } = await clone({ url });
    expect(status).toBe(504);
    expect(data.detail).toMatch(/took longer than/);
    expect(projectFolders()).toEqual(before);
  });
});

describe("repoNameFromUrl", () => {
  it("takes the last path segment without .git", async () => {
    const { repoNameFromUrl } = await import("@/server/github");
    expect(repoNameFromUrl("https://github.com/acme/pizza-ontology.git")).toBe("pizza-ontology");
    expect(repoNameFromUrl("git@github.com:acme/pizza.git")).toBe("pizza");
    expect(repoNameFromUrl("https://gitlab.com/group/sub/repo/")).toBe("repo");
  });
});
