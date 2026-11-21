// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

const A = "http://example.org/onto/a";
const B = "http://example.org/onto/b";
const C = "http://example.org/onto/c";

const ttl = (iri: string, body: string) => `@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix : <${iri}#> .

# A comment that must survive import edits.
<${iri}> a owl:Ontology ;
    rdfs:label "Ontology ${iri.slice(-1).toUpperCase()}" .

${body}
`;

const REMOTE_TTL = `@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<http://remote.test/onto> a owl:Ontology ; rdfs:label "Remote ontology" .
<http://remote.test/onto#Widget> a owl:Class ; rdfs:label "Widget" .
<http://remote.test/onto#Gadget> a owl:Class ; rdfs:label "Gadget" ; rdfs:subClassOf <http://remote.test/onto#Widget> .
`;

interface ImportStatus {
  iri: string;
  source: string;
  project_id?: string;
  status: string;
  error?: string;
  class_count: number;
  direct: boolean;
  imported_by: string[];
}
interface ImportsResponse {
  direct: string[];
  closure: ImportStatus[];
}

let dataDir: string;
let app: AppLike;
let projA: string;
let projB: string;
let projC: string;
let server: http.Server;
let remoteHits = 0;
let remoteUrl = "";

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const enc = encodeURIComponent;

async function createProject(name: string, iri: string, body: string): Promise<string> {
  const res = await app.request("/api/v1/projects", json("POST", { name }));
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const put = await app.request(
    `/api/v1/projects/${id}/source?branch=main`,
    json("PUT", { content: ttl(iri, body), commit_message: "Seed" }),
  );
  expect(put.status).toBe(200);
  return id;
}

async function addImport(projectId: string, iri: string) {
  return app.request(`/api/v1/projects/${projectId}/imports?branch=main`, json("POST", { iri }));
}

async function getImports(projectId: string): Promise<ImportsResponse> {
  const res = await app.request(`/api/v1/projects/${projectId}/imports?branch=main`);
  expect(res.status).toBe(200);
  return (await res.json()) as ImportsResponse;
}

async function ontologyFile(projectId: string): Promise<string> {
  const project = (await (await app.request(`/api/v1/projects/${projectId}`)).json()) as { folder: string };
  return fs.readFileSync(path.join(dataDir, "projects", project.folder, "ontology.ttl"), "utf8");
}

beforeAll(async () => {
  dataDir = useTempDataDir();
  delete process.env.ONTOBUILD_IMPORT_ALLOW_PRIVATE;
  app = (await import("@/server/app")).default;
  projA = await createProject("Alpha", A, `:Pizza a owl:Class ; rdfs:label "Pizza" ; rdfs:subClassOf <${B}#Food> .\n:Local a owl:Class ; rdfs:label "Local" .`);
  projB = await createProject("Beta", B, `:Food a owl:Class ; rdfs:label "Food" ; rdfs:subClassOf <${C}#Thing> .`);
  projC = await createProject("Gamma", C, `:Thing a owl:Class ; rdfs:label "Thing C" .\n:Other a owl:Class ; rdfs:label "Other" .`);

  server = http.createServer((req, res) => {
    remoteHits++;
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/onto.ttl" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/turtle" });
    res.end(REMOTE_TTL);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  remoteUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/redirect`;
}, 60_000);

afterAll(async () => {
  delete process.env.ONTOBUILD_IMPORT_ALLOW_PRIVATE;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  removeDir(dataDir);
});

describe("ontology imports", () => {
  it("imports another local project by its ontology IRI", async () => {
    const res = await addImport(projA, B);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ImportsResponse;
    expect(body.direct).toEqual([B]);
    const b = body.closure.find((e) => e.iri === B)!;
    expect(b).toMatchObject({ source: "project", project_id: projB, status: "ok", class_count: 1, direct: true, imported_by: [A] });

    const onDisk = await ontologyFile(projA);
    expect(onDisk).toContain(`owl:imports <${B}>`);
    // Only the header changed: the comment and the rest of the text are kept.
    expect(onDisk).toContain("# A comment that must survive import edits.");
    expect(onDisk).toContain(`:Local a owl:Class ; rdfs:label "Local" .`);
  });

  it("rejects importing itself and importing twice", async () => {
    const self = await addImport(projA, A);
    expect(self.status).toBe(400);
    const selfHash = await addImport(projA, `${A}#`);
    expect(selfHash.status).toBe(400);
    const dup = await addImport(projA, B);
    expect(dup.status).toBe(409);
  });

  it("rejects non-http IRIs that are not local projects", async () => {
    expect((await addImport(projA, "ftp://example.com/onto.ttl")).status).toBe(400);
    expect((await addImport(projA, "file:///etc/passwd")).status).toBe(400);
    expect((await addImport(projA, "not an iri")).status).toBe(422);
  });

  it("resolves imports transitively", async () => {
    expect((await addImport(projB, C)).status).toBe(200);
    const body = await getImports(projA);
    expect(body.direct).toEqual([B]);
    const c = body.closure.find((e) => e.iri === C)!;
    expect(c).toMatchObject({ source: "project", project_id: projC, status: "ok", class_count: 2, direct: false, imported_by: [B] });
  });

  it("merges imported classes into the tree, read-only", async () => {
    const tree = (await (await app.request(`/api/v1/projects/${projA}/ontology/tree?branch=main`)).json()) as {
      nodes: { iri: string; imported_from?: string; child_count: number }[];
      total_classes: number;
    };
    expect(tree.total_classes).toBe(2);
    const local = tree.nodes.find((n) => n.iri === `${A}#Local`)!;
    expect(local.imported_from).toBeUndefined();
    expect(tree.nodes.find((n) => n.iri === `${A}#Pizza`)).toBeUndefined();
    const thing = tree.nodes.find((n) => n.iri === `${C}#Thing`)!;
    expect(thing.imported_from).toBe(C);

    const children = (await (
      await app.request(`/api/v1/projects/${projA}/ontology/tree/${enc(`${B}#Food`)}/children?branch=main`)
    ).json()) as { nodes: { iri: string; imported_from?: string }[] };
    expect(children.nodes.map((n) => n.iri)).toEqual([`${A}#Pizza`]);
    expect(children.nodes[0].imported_from).toBeUndefined();

    const ancestors = (await (
      await app.request(`/api/v1/projects/${projA}/ontology/tree/${enc(`${A}#Pizza`)}/ancestors?branch=main`)
    ).json()) as { nodes: { iri: string }[] };
    expect(ancestors.nodes.map((n) => n.iri)).toEqual([`${C}#Thing`, `${B}#Food`]);

    const detail = await app.request(`/api/v1/projects/${projA}/ontology/classes/${enc(`${B}#Food`)}?branch=main`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ iri: `${B}#Food`, imported_from: B, imported_from_label: "Beta" });

    const search = (await (
      await app.request(`/api/v1/projects/${projA}/ontology/search?q=food&entity_types=class&branch=main`)
    ).json()) as { results: { iri: string; imported_from?: string }[] };
    expect(search.results).toEqual([expect.objectContaining({ iri: `${B}#Food`, imported_from: B })]);

    const del = await app.request(`/api/v1/projects/${projA}/ontology/classes/${enc(`${B}#Food`)}?branch=main`, { method: "DELETE" });
    expect(del.status).toBe(403);
    const delEntity = await app.request(`/api/v1/projects/${projA}/ontology/entities/${enc(`${C}#Thing`)}?branch=main`, { method: "DELETE" });
    expect(delEntity.status).toBe(403);
  });

  it("does not lint a parent from an import as undefined", async () => {
    const { lintOntology } = await import("@/server/linter");
    const { loadOntology } = await import("@/server/ontology");
    const onto = await loadOntology(projA, "main");
    const issues = lintOntology(onto.store, { enabledRules: new Set(["undefined-parent"]) });
    expect(issues).toEqual([]);
  });

  it("reports a cycle without hanging", async () => {
    expect((await addImport(projC, A)).status).toBe(200);
    const body = await getImports(projA);
    const self = body.closure.find((e) => e.iri === A)!;
    expect(self).toMatchObject({ status: "cycle", imported_by: [C] });
    expect(body.closure.find((e) => e.iri === B)!.status).toBe("ok");
    expect(body.closure.find((e) => e.iri === C)!.status).toBe("ok");
    // The tree still loads.
    const tree = await app.request(`/api/v1/projects/${projA}/ontology/tree?branch=main`);
    expect(tree.status).toBe(200);
  });

  it("lists import candidates", async () => {
    const res = await app.request(`/api/v1/import-candidates?q=gam`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({ project_id: projC, name: "Gamma", ontology_iri: C }),
    ]);
    const byIri = (await (await app.request(`/api/v1/import-candidates?q=${enc("onto/b")}`)).json()) as { project_id: string }[];
    expect(byIri.map((c) => c.project_id)).toEqual([projB]);
  });

  it("removes an import", async () => {
    const res = await app.request(`/api/v1/projects/${projC}/imports?branch=main&iri=${enc(A)}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ImportsResponse).direct).toEqual([]);
    expect(await ontologyFile(projC)).not.toContain("owl:imports");
    const missing = await app.request(`/api/v1/projects/${projC}/imports?branch=main&iri=${enc(A)}`, { method: "DELETE" });
    expect(missing.status).toBe(404);
  });

  it("fetches a remote IRI, blocks loopback by default, and caches the result", async () => {
    const add = await addImport(projC, remoteUrl);
    expect(add.status).toBe(200);
    const blocked = ((await add.json()) as ImportsResponse).closure.find((e) => e.iri === remoteUrl)!;
    expect(blocked).toMatchObject({ source: "remote", status: "error" });
    expect(blocked.error).toMatch(/private|loopback/);
    expect(remoteHits).toBe(0);

    process.env.ONTOBUILD_IMPORT_ALLOW_PRIVATE = "1";
    const refreshed = await app.request(`/api/v1/projects/${projC}/imports/refresh?branch=main`, { method: "POST" });
    expect(refreshed.status).toBe(200);
    const ok = ((await refreshed.json()) as ImportsResponse).closure.find((e) => e.iri === remoteUrl)!;
    expect(ok).toMatchObject({ source: "remote", status: "ok", class_count: 2, direct: true });
    expect(remoteHits).toBe(2); // the redirect and the document

    const cacheFiles = fs.readdirSync(path.join(dataDir, "import-cache"));
    expect(cacheFiles.some((f) => f.endsWith(".ttl"))).toBe(true);
    expect(cacheFiles.some((f) => f.endsWith(".json"))).toBe(true);

    // A second read uses the cache.
    const again = await getImports(projC);
    expect(again.closure.find((e) => e.iri === remoteUrl)!.status).toBe("ok");
    const tree = (await (await app.request(`/api/v1/projects/${projC}/ontology/tree?branch=main`)).json()) as {
      nodes: { iri: string; imported_from?: string }[];
    };
    expect(tree.nodes.find((n) => n.iri === "http://remote.test/onto#Widget")?.imported_from).toBe("http://remote.test/onto");
    expect(remoteHits).toBe(2);

    // Refresh fetches again.
    await app.request(`/api/v1/projects/${projC}/imports/refresh?branch=main`, { method: "POST" });
    expect(remoteHits).toBe(4);
  });
});
