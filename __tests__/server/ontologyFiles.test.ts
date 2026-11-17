// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PIZZA_TTL, removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

/** Choosing which RDF file in a project folder is the ontology, and creating a new one. */

let dataDir: string;
let tmp: string;
let app: AppLike;

beforeAll(async () => {
  dataDir = useTempDataDir();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ontobuilder-ontofiles-test-"));
  process.env.ONTOBUILDER_GH_BIN = path.join(tmp, "no-such-gh");
  app = (await import("@/server/app")).default;
}, 30_000);

afterAll(() => {
  removeDir(dataDir);
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ONTOBUILDER_GH_BIN;
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

const TEA_TTL = `@prefix : <http://example.org/tea#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

<http://example.org/tea> a owl:Ontology ; rdfs:label "Tea" .
:Tea a owl:Class ; rdfs:label "Tea" .
:GreenTea a owl:Class ; rdfs:label "Green tea" ; rdfs:subClassOf :Tea .
:BlackTea a owl:Class ; rdfs:label "Black tea" ; rdfs:subClassOf :Tea .
`;

const WINE_RDFXML = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
         xmlns:owl="http://www.w3.org/2002/07/owl#">
  <owl:Ontology rdf:about="http://example.org/wine"/>
  <owl:Class rdf:about="http://example.org/wine#Wine"><rdfs:label>Wine</rdfs:label></owl:Class>
</rdf:RDF>
`;

let remoteCount = 0;
/** A bare repository with these files (and symbolic links) committed on main. */
function makeRemote(files: Record<string, string>, links: Record<string, string> = {}): string {
  const name = `repo${++remoteCount}`;
  const work = path.join(tmp, `${name}-work`);
  fs.mkdirSync(work, { recursive: true });
  sh(work, "init", "--quiet", "--initial-branch=main");
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
    fs.writeFileSync(path.join(work, rel), content);
  }
  for (const [rel, target] of Object.entries(links)) fs.symlinkSync(target, path.join(work, rel));
  sh(work, "add", "-A");
  sh(work, "commit", "--quiet", "--allow-empty", "-m", "First commit");
  const bare = path.join(tmp, `${name}.git`);
  execFileSync("git", ["clone", "--quiet", "--bare", work, bare], { env: GIT_ENV });
  return `file://${bare}`;
}

interface Project {
  id: string;
  folder: string;
  source_file_path: string | null;
  git_ontology_path: string | null;
  ontology_iri: string | null;
  normalization_report: { original_format: string; notes: string[] } | null;
  label_preferences: string[] | null;
}

async function clone(url: string): Promise<Project> {
  const res = await app.request("/api/v1/projects/clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (res.status !== 201) throw new Error(`clone failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as Project;
}

const base = (id: string) => `/api/v1/projects/${id}`;
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

interface FileList {
  branch: string;
  active_path: string | null;
  active_exists: boolean;
  suggested_file_name: string;
  files: { path: string; format: string; active: boolean; turtle_path: string | null; turtle_exists: boolean }[];
}

interface Change {
  project: Project;
  branch: string;
  path: string;
  source_path: string;
  converted: boolean;
  reused: boolean;
  previous_path: string | null;
  replaced: boolean;
  commit_hash: string | null;
  warnings: string[];
  detail?: string;
  code?: string;
  turtle_path?: string;
  reason?: string;
}

async function list(id: string, branch?: string): Promise<FileList> {
  const res = await app.request(`${base(id)}/ontology-files${branch ? `?branch=${branch}` : ""}`);
  expect(res.status).toBe(200);
  return (await res.json()) as FileList;
}

async function switchTo(id: string, body: unknown): Promise<{ status: number; data: Change }> {
  const res = await app.request(`${base(id)}/ontology-file`, json("PUT", body));
  return { status: res.status, data: (await res.json()) as Change };
}

async function create(id: string, body: unknown): Promise<{ status: number; data: Change }> {
  const res = await app.request(`${base(id)}/ontology-file`, json("POST", body));
  return { status: res.status, data: (await res.json()) as Change };
}

async function rootLabels(id: string, branch = "main"): Promise<string[]> {
  const res = await app.request(`${base(id)}/ontology/tree?branch=${branch}`);
  const data = (await res.json()) as { nodes: { label: string }[] };
  return data.nodes.map((n) => n.label);
}

async function waitFor<T>(fn: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out");
}

describe("Ontology files of a project", () => {
  let project: Project;
  let folder: string;

  beforeAll(async () => {
    project = await clone(
      makeRemote(
        {
          "ontology.ttl": PIZZA_TTL,
          "tea/tea.ttl": TEA_TTL,
          "wine/wine.owl": WINE_RDFXML,
          "broken.ttl": "this is not turtle",
          "README.md": "# Drinks\n",
        },
        { "linked.ttl": "tea/tea.ttl" },
      ),
    );
    folder = path.join(dataDir, "projects", project.folder);
    expect(project.git_ontology_path).toBe("ontology.ttl");
  }, 30_000);

  it("lists the tracked RDF files, best first, with the active one and what a conversion would do", async () => {
    fs.writeFileSync(path.join(folder, "untracked.ttl"), TEA_TTL);
    const data = await list(project.id);
    expect(data).toMatchObject({ branch: "main", active_path: "ontology.ttl", active_exists: true, suggested_file_name: "ontology-2.ttl" });
    const paths = data.files.map((f) => f.path);
    expect(paths[0]).toBe("ontology.ttl");
    expect(paths).toEqual(expect.arrayContaining(["tea/tea.ttl", "wine/wine.owl", "broken.ttl"]));
    // Symbolic links and untracked files are not candidates.
    expect(paths).not.toContain("linked.ttl");
    expect(paths).not.toContain("untracked.ttl");
    expect(data.files.find((f) => f.path === "ontology.ttl")).toMatchObject({ active: true, turtle_path: null });
    expect(data.files.find((f) => f.path === "wine/wine.owl")).toMatchObject({
      format: "rdfxml",
      active: false,
      turtle_path: "wine/wine.ttl",
      turtle_exists: false,
    });
  });

  it("rejects paths outside the repository, links, untracked, missing, non-RDF and unreadable files", async () => {
    const cases: [unknown, number, RegExp][] = [
      [{}, 422, /'path' is required/],
      [{ path: "../etc/passwd" }, 422, /inside the repository/],
      [{ path: "/etc/passwd" }, 422, /inside the repository/],
      [{ path: "tea/../ontology.ttl" }, 422, /inside the repository/],
      [{ path: ".git/config" }, 422, /inside the repository/],
      [{ path: 5 }, 422, /must be a string/],
      [{ path: "linked.ttl" }, 422, /symbolic link/],
      [{ path: "untracked.ttl" }, 422, /isn't committed/],
      [{ path: "nope.ttl" }, 422, /nope\.ttl isn't in the repository on branch 'main'/],
      [{ path: "README.md" }, 422, /isn't an RDF file/],
      [{ path: "broken.ttl" }, 422, /Failed to parse broken\.ttl/],
      [{ path: "tea/tea.ttl", branch: "no-such-branch" }, 404, /Branch not found/],
    ];
    for (const [body, status, detail] of cases) {
      const { status: got, data } = await switchTo(project.id, body);
      expect(got, JSON.stringify(body)).toBe(status);
      expect(data.detail, JSON.stringify(body)).toMatch(detail);
    }
    expect((await app.request(`${base(project.id)}/ontology-file`, { method: "PUT", body: "{" })).status).toBe(422);
    expect((await app.request(`${base("nope")}/ontology-file`, json("PUT", { path: "a.ttl" }))).status).toBe(404);
    // Nothing changed.
    expect((await list(project.id)).active_path).toBe("ontology.ttl");
  });

  it("switches to another Turtle file and drops what was worked out from the old one", async () => {
    // Derived state of the pizza ontology: label preferences (kept), lint, quality, index status.
    await app.request(base(project.id), json("PATCH", { label_preferences: ["skos:prefLabel", "rdfs:label"] }));
    expect(await rootLabels(project.id)).toEqual(["Food", "Topping"]);
    expect((await app.request(`${base(project.id)}/lint/run`, { method: "POST" })).status).toBe(202);
    await waitFor(async () => {
      const s = (await (await app.request(`${base(project.id)}/lint/status`)).json()) as { last_run: { status: string } | null };
      return s.last_run?.status === "completed" ? true : undefined;
    });
    expect((await app.request(`${base(project.id)}/quality/check`, { method: "POST" })).status).toBe(202);
    await waitFor(async () => {
      const q = (await (await app.request(`${base(project.id)}/quality/issues`)).json()) as { checked_at: string | null };
      return q.checked_at ? true : undefined;
    });
    const indexBefore = (await (await app.request(`${base(project.id)}/ontology/index-status`)).json()) as { entity_count: number };
    await (await app.request(`${base(project.id)}/normalization/status`)).json();

    const head = sh(folder, "rev-parse", "HEAD").trim();
    const { status, data } = await switchTo(project.id, { path: "tea/tea.ttl", branch: "main" });
    expect(status).toBe(200);
    expect(data).toMatchObject({
      branch: "main",
      path: "tea/tea.ttl",
      source_path: "tea/tea.ttl",
      converted: false,
      reused: false,
      previous_path: "ontology.ttl",
      commit_hash: null,
    });
    expect(data.project).toMatchObject({
      git_ontology_path: "tea/tea.ttl",
      source_file_path: `projects/${project.id}/tea/tea.ttl`,
      ontology_iri: "http://example.org/tea",
      normalization_report: null,
      label_preferences: ["skos:prefLabel", "rdfs:label"],
    });
    expect(sh(folder, "rev-parse", "HEAD").trim()).toBe(head); // nothing committed

    // The editor's endpoints read the new file at the same commit.
    expect(await rootLabels(project.id)).toEqual(["Tea"]);
    const source = (await (await app.request(`${base(project.id)}/source`)).json()) as { filename: string };
    expect(source.filename).toBe("tea/tea.ttl");
    const indexAfter = (await (await app.request(`${base(project.id)}/ontology/index-status`)).json()) as { entity_count: number };
    expect(indexAfter.entity_count).not.toBe(indexBefore.entity_count);
    const lint = (await (await app.request(`${base(project.id)}/lint/status`)).json()) as { last_run: unknown; total_issues: number };
    expect(lint).toMatchObject({ last_run: null, total_issues: 0 });
    const quality = (await (await app.request(`${base(project.id)}/quality/issues`)).json()) as { checked_at: string | null };
    expect(quality.checked_at).toBeNull();
    const dups = (await (await app.request(`${base(project.id)}/quality/duplicates/latest`)).json()) as { checked_at: string | null };
    expect(dups.checked_at).toBeNull();

    // Choosing the active file again changes nothing.
    const again = await switchTo(project.id, { path: "tea/tea.ttl" });
    expect(again.status).toBe(200);
    expect(again.data.previous_path).toBe("tea/tea.ttl");
  });

  it("converts a non-Turtle file next to it in a commit, and reuses that file later", async () => {
    const { status, data } = await switchTo(project.id, { path: "wine/wine.owl" });
    expect(status).toBe(200);
    expect(data).toMatchObject({ path: "wine/wine.ttl", source_path: "wine/wine.owl", converted: true, reused: false });
    expect(data.commit_hash).toMatch(/^[0-9a-f]{40}$/);
    expect(data.project).toMatchObject({ git_ontology_path: "wine/wine.ttl", ontology_iri: "http://example.org/wine" });
    expect(data.project.normalization_report?.original_format).toBe("RDF/XML");
    expect(data.project.normalization_report?.notes.join("\n")).toMatch(/Saved as wine\/wine\.ttl, committed on branch main/);
    expect(sh(folder, "log", "-1", "--format=%s").trim()).toBe("Convert wine/wine.owl to Turtle for OntoBuilder");
    expect(fs.readFileSync(path.join(folder, "wine/wine.owl"), "utf8")).toBe(WINE_RDFXML);
    expect(fs.readFileSync(path.join(folder, "wine/wine.ttl"), "utf8")).toMatch(/wine#Wine/);
    expect(await rootLabels(project.id)).toEqual(["Wine"]);

    const listed = await list(project.id);
    expect(listed.files.find((f) => f.path === "wine/wine.owl")).toMatchObject({ turtle_path: "wine/wine.ttl", turtle_exists: true });

    // Back to the pizza, then the wine again: the converted file is used as it is.
    expect((await switchTo(project.id, { path: "ontology.ttl" })).status).toBe(200);
    const head = sh(folder, "rev-parse", "HEAD").trim();
    const reused = await switchTo(project.id, { path: "wine/wine.owl" });
    expect(reused.status).toBe(200);
    expect(reused.data).toMatchObject({ path: "wine/wine.ttl", converted: false, reused: true, commit_hash: null });
    // wine.owl hasn't changed since the conversion, so there is nothing to warn about.
    expect(reused.data.warnings).toEqual([]);
    expect(sh(folder, "rev-parse", "HEAD").trim()).toBe(head);
  });

  it("creates a new ontology file, validating the name, IRI and title", async () => {
    const bad: [unknown, number, RegExp][] = [
      [{ ontology_iri: "http://example.org/x", title: "X" }, 422, /'file_name' is required/],
      [{ file_name: "x.owl", ontology_iri: "http://example.org/x", title: "X" }, 422, /must end in \.ttl/],
      [{ file_name: "../x.ttl", ontology_iri: "http://example.org/x", title: "X" }, 422, /inside the repository/],
      [{ file_name: "x.ttl", ontology_iri: "not an iri", title: "X" }, 422, /absolute IRI/],
      [{ file_name: "x.ttl", ontology_iri: "http://example.org/x>", title: "X" }, 422, /absolute IRI/],
      [{ file_name: "x.ttl", ontology_iri: "http://example.org/x", title: "  " }, 422, /'title' is required/],
      [{ file_name: "ontology.ttl", ontology_iri: "http://example.org/x", title: "X" }, 409, /already exists on branch 'main'/],
      [{ file_name: "untracked.ttl", ontology_iri: "http://example.org/x", title: "X" }, 409, /already exists in the project folder/],
      [{ file_name: "tea", ontology_iri: "http://example.org/x", title: "X" }, 422, /must end in \.ttl/],
      [{ file_name: "ontology.ttl/x.ttl", ontology_iri: "http://example.org/x", title: "X" }, 409, /is a file/],
    ];
    for (const [body, status, detail] of bad) {
      const out = await create(project.id, body);
      expect(out.status, JSON.stringify(body)).toBe(status);
      expect(out.data.detail, JSON.stringify(body)).toMatch(detail);
    }

    const before = (await list(project.id)).active_path;
    const { status, data } = await create(project.id, {
      file_name: "src/coffee.ttl",
      ontology_iri: "http://example.org/coffee",
      title: 'Coffee "beans"',
    });
    expect(status).toBe(201);
    expect(data).toMatchObject({ path: "src/coffee.ttl", previous_path: before, converted: false });
    expect(data.project).toMatchObject({ git_ontology_path: "src/coffee.ttl", ontology_iri: "http://example.org/coffee" });
    expect(sh(folder, "log", "-1", "--format=%s").trim()).toBe("Create ontology src/coffee.ttl");
    const written = fs.readFileSync(path.join(folder, "src/coffee.ttl"), "utf8");
    expect(written).toMatch(/<http:\/\/example\.org\/coffee> a owl:Ontology/);
    expect(written).toContain('dc:title "Coffee \\"beans\\""');
    expect(await rootLabels(project.id)).toEqual([]);
    expect((await list(project.id)).files.find((f) => f.path === "src/coffee.ttl")?.active).toBe(true);
  });

  it("keeps one path for the project: a file created on a branch is missing on the others", async () => {
    expect((await app.request(`${base(project.id)}/branches`, json("POST", { name: "feature", from_branch: "main" }))).status).toBe(201);
    const { status, data } = await create(project.id, {
      file_name: "feature-only.ttl",
      ontology_iri: "http://example.org/feature",
      title: "Feature",
      branch: "feature",
    });
    expect(status).toBe(201);
    expect(data.branch).toBe("feature");
    expect(await rootLabels(project.id, "feature")).toEqual([]);

    const onMain = await list(project.id, "main");
    expect(onMain).toMatchObject({ active_path: "feature-only.ttl", active_exists: false });
    const tree = await app.request(`${base(project.id)}/ontology/tree?branch=main`);
    expect(tree.status).toBe(404);
    expect(((await tree.json()) as { detail: string }).detail).toMatch(
      /feature-only\.ttl doesn't exist on branch 'main'.*choose another ontology file/,
    );
    const source = await app.request(`${base(project.id)}/source?branch=main`);
    expect(source.status).toBe(404);

    // Switching on main to a file that only exists on feature fails; a main file works.
    expect((await switchTo(project.id, { path: "feature-only.ttl", branch: "main" })).status).toBe(422);
    expect((await switchTo(project.id, { path: "ontology.ttl", branch: "main" })).status).toBe(200);
  });
});

describe("A project without an ontology", () => {
  it("lists no files and creates ontology.ttl, which the editor then opens", async () => {
    const project = await clone(makeRemote({ "README.md": "nothing yet\n" }));
    expect(project.source_file_path).toBeNull();
    const before = await list(project.id);
    expect(before).toMatchObject({ active_path: null, active_exists: false, files: [], suggested_file_name: "ontology.ttl" });

    const { status, data } = await create(project.id, {
      file_name: before.suggested_file_name,
      ontology_iri: "http://example.org/ontologies/new",
      title: "New",
    });
    expect(status).toBe(201);
    expect(data).toMatchObject({ path: "ontology.ttl", previous_path: null });
    expect(data.project.source_file_path).toBe(`projects/${project.id}/ontology.ttl`);
    const source = (await (await app.request(`${base(project.id)}/source`)).json()) as { filename: string; content: string };
    expect(source.filename).toBe("ontology.ttl");
    expect(source.content).toContain("<http://example.org/ontologies/new> a owl:Ontology");
  });
});

/** RDF/XML with a blank node (an owl:Restriction), and Turtle with the same triples written differently. */
const BEER_RDFXML = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
         xmlns:owl="http://www.w3.org/2002/07/owl#">
  <owl:Ontology rdf:about="http://example.org/beer"/>
  <owl:Class rdf:about="http://example.org/beer#Beer"><rdfs:label xml:lang="en">Beer</rdfs:label></owl:Class>
  <owl:Class rdf:about="http://example.org/beer#Hop"/>
  <owl:ObjectProperty rdf:about="http://example.org/beer#hasHop"/>
  <owl:Class rdf:about="http://example.org/beer#Ipa">
    <rdfs:subClassOf rdf:resource="http://example.org/beer#Beer"/>
    <rdfs:subClassOf>
      <owl:Restriction>
        <owl:onProperty rdf:resource="http://example.org/beer#hasHop"/>
        <owl:someValuesFrom rdf:resource="http://example.org/beer#Hop"/>
      </owl:Restriction>
    </rdfs:subClassOf>
  </owl:Class>
</rdf:RDF>
`;

const BEER_TTL = `@prefix b: <http://example.org/beer#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

b:Ipa a owl:Class ;
  rdfs:subClassOf [ a owl:Restriction ; owl:someValuesFrom b:Hop ; owl:onProperty b:hasHop ] , b:Beer .
<http://example.org/beer> a owl:Ontology .
b:hasHop a owl:ObjectProperty .
b:Hop a owl:Class .
b:Beer a owl:Class ; rdfs:label "Beer" .
`;

describe("A Turtle file next to a non-Turtle one", () => {
  let project: Project;
  let folder: string;

  beforeAll(async () => {
    project = await clone(
      makeRemote({
        "ontology.ttl": PIZZA_TTL,
        "beer/beer.owl": BEER_RDFXML,
        "beer/beer.ttl": BEER_TTL,
        // The same, but the Turtle copy lacks the restriction's someValuesFrom: out of date.
        "ale/ale.owl": BEER_RDFXML,
        "ale/ale.ttl": BEER_TTL.replace("owl:someValuesFrom b:Hop ; ", ""),
      }),
    );
    folder = path.join(dataDir, "projects", project.folder);
  }, 30_000);

  /** Commits a change to a file in the project folder, as the user would outside OntoBuilder. */
  function commitInFolder(rel: string, content: string, message: string) {
    fs.writeFileSync(path.join(folder, rel), content);
    sh(folder, "add", rel);
    sh(folder, "commit", "--quiet", "-m", message);
  }

  it("reuses a .ttl with the same triples (blank nodes and language tags aside) without a warning", async () => {
    const head = sh(folder, "rev-parse", "HEAD").trim();
    const { status, data } = await switchTo(project.id, { path: "beer/beer.owl" });
    expect(status).toBe(200);
    expect(data).toMatchObject({ path: "beer/beer.ttl", source_path: "beer/beer.owl", converted: false, reused: true, replaced: false });
    expect(data.warnings).toEqual([]);
    expect(sh(folder, "rev-parse", "HEAD").trim()).toBe(head);
  });

  it("asks what to do when the .ttl has other triples, and does what the caller chooses", async () => {
    expect((await switchTo(project.id, { path: "ontology.ttl" })).status).toBe(200);
    const head = sh(folder, "rev-parse", "HEAD").trim();

    // Without `reconvert`: 409 with a code the client acts on, and nothing changes.
    const asked = await switchTo(project.id, { path: "ale/ale.owl" });
    expect(asked.status).toBe(409);
    expect(asked.data).toMatchObject({ code: "turtle_out_of_date", turtle_path: "ale/ale.ttl" });
    expect(asked.data.reason).toMatch(/ale\/ale\.ttl doesn't have the same triples as ale\/ale\.owl/);
    expect(asked.data.detail).toMatch(/convert ale\/ale\.owl again, which overwrites ale\/ale\.ttl/);
    expect((await list(project.id)).active_path).toBe("ontology.ttl");
    expect((await switchTo(project.id, { path: "ale/ale.owl", reconvert: "yes" })).status).toBe(422);

    // "Use the existing file": reused with a warning, nothing committed.
    const used = await switchTo(project.id, { path: "ale/ale.owl", reconvert: false });
    expect(used.status).toBe(200);
    expect(used.data).toMatchObject({ path: "ale/ale.ttl", converted: false, reused: true, commit_hash: null });
    expect(used.data.warnings.join(" ")).toMatch(/used as it is, although it may be out of date/);
    expect(sh(folder, "rev-parse", "HEAD").trim()).toBe(head);

    // "Convert again": the .ttl is overwritten in a new conversion commit.
    expect((await switchTo(project.id, { path: "ontology.ttl" })).status).toBe(200);
    const again = await switchTo(project.id, { path: "ale/ale.owl", reconvert: true });
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ path: "ale/ale.ttl", converted: true, reused: false, replaced: true });
    expect(again.data.commit_hash).toMatch(/^[0-9a-f]{40}$/);
    expect(sh(folder, "log", "-1", "--format=%s").trim()).toBe("Convert ale/ale.owl to Turtle for OntoBuilder");
    expect(sh(folder, "show", "--name-status", "--format=", "HEAD").trim()).toBe("M\tale/ale.ttl");
    expect(fs.readFileSync(path.join(folder, "ale/ale.ttl"), "utf8")).toMatch(/someValuesFrom/);
    expect(fs.readFileSync(path.join(folder, "ale/ale.owl"), "utf8")).toBe(BEER_RDFXML);
    expect(again.data.project.normalization_report?.notes.join("\n")).toMatch(/replacing the earlier file/);

    // Now it is OntoBuilder's conversion and up to date: reused without asking.
    expect((await switchTo(project.id, { path: "ontology.ttl" })).status).toBe(200);
    const later = await switchTo(project.id, { path: "ale/ale.owl" });
    expect(later.status).toBe(200);
    expect(later.data).toMatchObject({ reused: true, warnings: [] });
  });

  it("asks again when the source changed since OntoBuilder converted it, but not for a change that keeps its triples", async () => {
    expect((await switchTo(project.id, { path: "ontology.ttl" })).status).toBe(200);
    // Reformatting the RDF/XML doesn't change its triples.
    commitInFolder("ale/ale.owl", BEER_RDFXML.replace(/\n {2}/g, "\n    "), "Reindent ale.owl");
    const same = await switchTo(project.id, { path: "ale/ale.owl" });
    expect(same.status).toBe(200);
    expect(same.data).toMatchObject({ reused: true, warnings: [] });

    expect((await switchTo(project.id, { path: "ontology.ttl" })).status).toBe(200);
    commitInFolder(
      "ale/ale.owl",
      BEER_RDFXML.replace("</rdf:RDF>", '  <owl:Class rdf:about="http://example.org/beer#Stout"/>\n</rdf:RDF>'),
      "Add stouts",
    );
    const asked = await switchTo(project.id, { path: "ale/ale.owl" });
    expect(asked.status).toBe(409);
    expect(asked.data.code).toBe("turtle_out_of_date");
    expect(asked.data.reason).toMatch(/ale\/ale\.owl has changed since it was converted to ale\/ale\.ttl in commit [0-9a-f]{8}/);
    const again = await switchTo(project.id, { path: "ale/ale.owl", reconvert: true });
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ converted: true, replaced: true });
    expect(fs.readFileSync(path.join(folder, "ale/ale.ttl"), "utf8")).toMatch(/Stout/);
  });
});

describe("Normalization history of a project with several ontology files", () => {
  interface Status {
    last_run: string | null;
    last_run_id: string | null;
  }
  interface History {
    items: { id: string; ontology_path: string | null }[];
    total: number;
  }

  it("keeps a history per file, and old runs without a file go to the file that was active", async () => {
    const project = await clone(
      makeRemote({ "ontology.ttl": PIZZA_TTL, "tea/tea.ttl": TEA_TTL, "wine/wine.owl": WINE_RDFXML }),
    );
    const id = project.id;
    const status = async () => (await (await app.request(`${base(id)}/normalization/status`)).json()) as Status;
    const history = async () => (await (await app.request(`${base(id)}/normalization/history`)).json()) as History;

    // A run on the pizza file.
    const ran = await app.request(`${base(id)}/normalization`, json("POST", {}));
    expect(ran.status).toBe(200);
    const pizzaRun = (await ran.json()) as { id: string; ontology_path: string };
    expect(pizzaRun.ontology_path).toBe("ontology.ttl");
    expect((await status()).last_run_id).toBe(pizzaRun.id);

    // A run from before runs recorded their file.
    const { run } = await import("@/server/db");
    run(
      `INSERT INTO normalization_runs (id, project_id, created_at, trigger_type, report_json, original_format,
         original_size_bytes, normalized_size_bytes, triple_count, is_dry_run)
       VALUES ('legacy-run', ?, '2000-01-01T00:00:00Z', 'manual', '{}', 'Turtle', 1, 1, 1, 0)`,
      id,
    );
    expect((await history()).items.map((r) => r.id)).toEqual([pizzaRun.id, "legacy-run"]);

    // Switching files: the tea file has no runs yet.
    expect((await switchTo(id, { path: "tea/tea.ttl" })).status).toBe(200);
    expect(await status()).toMatchObject({ last_run: null, last_run_id: null });
    expect(await history()).toEqual({ items: [], total: 0 });

    // A conversion records an import run for the converted file only.
    expect((await switchTo(id, { path: "wine/wine.owl" })).status).toBe(200);
    const wine = await history();
    expect(wine.total).toBe(1);
    expect(wine.items[0].ontology_path).toBe("wine/wine.ttl");
    expect((await status()).last_run_id).toBe(wine.items[0].id);

    // Back on the pizza file, its runs are there again, the old one included.
    expect((await switchTo(id, { path: "ontology.ttl" })).status).toBe(200);
    const pizza = await history();
    expect(pizza.items.map((r) => [r.id, r.ontology_path])).toEqual([
      [pizzaRun.id, "ontology.ttl"],
      ["legacy-run", "ontology.ttl"],
    ]);
    expect((await status()).last_run_id).toBe(pizzaRun.id);
    // The single-run endpoint still finds any run of the project.
    expect((await app.request(`${base(id)}/normalization/runs/${wine.items[0].id}`)).status).toBe(200);
  });
});
