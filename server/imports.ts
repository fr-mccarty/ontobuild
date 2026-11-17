/**
 * Ontology imports (owl:imports).
 *
 * A project's ontology lists the ontologies it imports as `owl:imports <iri>` triples on its
 * owl:Ontology header. Each import IRI is resolved, in order, to:
 *   1. another OntoBuilder project whose ontology IRI (the `projects.ontology_iri` column, or the
 *      owl:Ontology subject of its source on its default branch) is that IRI, read from git; or
 *   2. a document fetched over http(s) and cached under DATA_DIR/import-cache/.
 * Imports are transitive: the closure is resolved breadth-first, cycle-safe, to a depth of 10.
 *
 * The editor shows imported classes read-only next to the local ones through getImportView(),
 * which merges the closure into a read-only "view" store.
 */
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { DataFactory, Store } from "n3";
import { all } from "./db";
import * as git from "./git";
import { httpError } from "./http";
import { setExternalClassResolver } from "./linter";
import {
  NS,
  RDF_TYPE,
  RDFS_LABEL,
  commitOntology,
  findOntologyIri,
  getProjectRow,
  hasType,
  listClasses,
  loadOntology,
  onOntologyEvent,
  ontologyFilePath,
  requireProject,
  type LoadedOntology,
  type ProjectRow,
} from "./ontology";
import { formatFromFilename, parseRdf, parseTurtle, serializeTurtle, type RdfFormat } from "./rdf";
import { findBlockSpan, iriTurtleForms, lexTurtle, parseDeclarations, type TurtleToken } from "@/lib/ontology/turtleUtils";

export const OWL_IMPORTS = NS.owl + "imports";
export const OWL_ONTOLOGY = NS.owl + "Ontology";
const OWL_CLASS = NS.owl + "Class";
const RDFS_CLASS = NS.rdfs + "Class";

export const MAX_IMPORT_DEPTH = 10;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** How long a failed remote fetch is remembered before it is tried again (a refresh retries at once). */
const NEGATIVE_CACHE_MS = 5 * 60_000;
/** Upper bound on how long a merged view or the project IRI index is reused without a commit event. */
const VIEW_TTL_MS = 30_000;
const ACCEPT = "text/turtle, application/rdf+xml, application/ld+json;q=0.9, */*;q=0.1";

export interface ImportStatus {
  iri: string;
  source: "project" | "remote";
  project_id?: string;
  project_name?: string;
  status: "ok" | "error" | "cycle";
  error?: string;
  class_count: number;
  direct: boolean;
  imported_by: string[];
  /** Display name: the project name, the ontology's label, or null. */
  label: string | null;
  /** For remote imports: when the cached copy was fetched. */
  fetched_at?: string | null;
}

export interface ImportsResponse {
  direct: string[];
  closure: ImportStatus[];
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** Compares ontology IRIs the way people write them: a trailing `#` or `/` does not matter. */
export function normIri(iri: string): string {
  return iri.trim().replace(/[#/]+$/, "");
}

const IRI_RE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/;

export function isValidIri(iri: string): boolean {
  return IRI_RE.test(iri);
}

// ---------------------------------------------------------------------------
// Reading owl:imports from a store
// ---------------------------------------------------------------------------

/** The owl:Ontology header subjects (named nodes) of a store. */
function ontologySubjects(store: Store): string[] {
  return store
    .getSubjects(RDF_TYPE, OWL_ONTOLOGY, null)
    .filter((s) => s.termType === "NamedNode")
    .map((s) => s.value);
}

/**
 * The IRIs a store imports directly, in source order: owl:imports objects on its ontology
 * header(s), or on any subject when the store declares no owl:Ontology.
 */
export function directImports(store: Store): string[] {
  const headers = ontologySubjects(store);
  const quads = headers.length
    ? headers.flatMap((h) => store.getQuads(h, OWL_IMPORTS, null, null))
    : store.getQuads(null, OWL_IMPORTS, null, null);
  const out: string[] = [];
  for (const q of quads) if (q.object.termType === "NamedNode" && !out.includes(q.object.value)) out.push(q.object.value);
  return out;
}

function ontologyLabel(store: Store, ontologyIri: string | null): string | null {
  if (!ontologyIri) return null;
  for (const p of [NS.dcterms + "title", NS.dc + "title", RDFS_LABEL]) {
    const o = store.getObjects(ontologyIri, p, null).find((t) => t.termType === "Literal" && t.value.trim());
    if (o) return o.value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Local projects by ontology IRI
// ---------------------------------------------------------------------------

interface ProjectIriEntry {
  projectId: string;
  name: string;
  description: string | null;
  /** IRIs this project answers to: the column and the source's owl:Ontology subject. */
  iris: string[];
}

type G = typeof globalThis & {
  __ontobuilderImportState?: {
    projectIndex: { at: number; entries: ProjectIriEntry[] } | null;
    generation: number;
    views: Map<string, { at: number; generation: number; view: ImportView }>;
    remoteMemo: Map<string, { fetchedAt: string; store: Store; ontologyIri: string | null; label: string | null }>;
    remoteFailures: Map<string, { at: number; error: string }>;
    classSets: Map<string, ReadonlySet<string>>;
  };
};
const state = ((globalThis as G).__ontobuilderImportState ??= {
  projectIndex: null,
  generation: 0,
  views: new Map(),
  remoteMemo: new Map(),
  remoteFailures: new Map(),
  classSets: new Map(),
});

onOntologyEvent("imports:invalidate", () => {
  state.projectIndex = null;
  state.generation++;
});

const iriMemoG = globalThis as typeof globalThis & { __ontobuilderImportIriMemo?: Map<string, { sha: string; iri: string | null }> };
const iriMemo = (iriMemoG.__ontobuilderImportIriMemo ??= new Map());

/**
 * The owl:Ontology IRI declared by a project's source on its default branch. Memoized per
 * commit, and read straight from git so scanning projects does not evict the ontology cache.
 */
async function defaultBranchOntologyIri(projectId: string): Promise<string | null> {
  try {
    if (!git.repoExists(projectId)) return null;
    const project = getProjectRow(projectId);
    if (!project) return null;
    const sha = await git.resolveRef(projectId, await git.getDefaultBranch(projectId));
    const memo = iriMemo.get(projectId);
    if (memo && memo.sha === sha) return memo.iri;
    const content = await git.readFileOrNull(projectId, sha, ontologyFilePath(project));
    let iri: string | null = null;
    if (content !== null) {
      try {
        iri = findOntologyIri(parseTurtle(content).store);
      } catch {
        iri = null;
      }
    }
    iriMemo.set(projectId, { sha, iri });
    return iri;
  } catch {
    return null;
  }
}

async function projectIndex(): Promise<ProjectIriEntry[]> {
  const cached = state.projectIndex;
  if (cached && Date.now() - cached.at < VIEW_TTL_MS) return cached.entries;
  const rows = all<ProjectRow>("SELECT * FROM projects ORDER BY created_at");
  const entries: ProjectIriEntry[] = [];
  for (const row of rows) {
    const iris = new Set<string>();
    if (row.ontology_iri) iris.add(row.ontology_iri);
    const fromSource = await defaultBranchOntologyIri(row.id);
    if (fromSource) iris.add(fromSource);
    entries.push({ projectId: row.id, name: row.name, description: row.description, iris: [...iris] });
  }
  state.projectIndex = { at: Date.now(), entries };
  return entries;
}

/** The OntoBuilder project whose ontology IRI is `iri`, if any. */
export async function findProjectByIri(iri: string): Promise<ProjectIriEntry | null> {
  const n = normIri(iri);
  for (const e of await projectIndex()) if (e.iris.some((i) => normIri(i) === n)) return e;
  return null;
}

/** Projects with an ontology IRI whose name or IRI contains `q` (all of them when `q` is empty). */
export async function importCandidates(q: string): Promise<
  { project_id: string; name: string; ontology_iri: string; description: string | null }[]
> {
  const needle = q.trim().toLowerCase();
  const out = [];
  for (const e of await projectIndex()) {
    if (!e.iris.length) continue;
    const row = getProjectRow(e.projectId);
    // Prefer the IRI the source declares: that is what other ontologies will import.
    const iri = (await defaultBranchOntologyIri(e.projectId)) ?? row?.ontology_iri ?? e.iris[0];
    const hay = [e.name, ...e.iris].map((s) => s.toLowerCase());
    if (needle && !hay.some((s) => s.includes(needle))) continue;
    out.push({ project_id: e.projectId, name: e.name, ontology_iri: iri, description: e.description });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50);
}

// ---------------------------------------------------------------------------
// Remote fetching (with SSRF hygiene) and the on-disk cache
// ---------------------------------------------------------------------------

function cacheDir(): string {
  const dataDir = path.resolve(process.env.ONTOBUILDER_DATA_DIR || path.join(process.cwd(), "data"));
  return path.join(dataDir, "import-cache");
}

function cacheKey(iri: string): string {
  return crypto.createHash("sha256").update(iri).digest("hex");
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return (
    lower === "::" ||
    lower === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(lower) ||
    /^fe[89ab][0-9a-f]:/.test(lower) ||
    /^ff[0-9a-f]{2}:/.test(lower)
  );
}

function allowPrivate(): boolean {
  return process.env.ONTOBUILDER_IMPORT_ALLOW_PRIVATE === "1";
}

async function assertFetchable(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImportError(`Only http and https IRIs can be fetched (got ${url.protocol.replace(/:$/, "")})`);
  }
  if (allowPrivate()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (net.isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch (e) {
      throw new ImportError(`Cannot resolve host ${host}: ${(e as Error).message}`);
    }
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new ImportError(`Refusing to fetch ${url.host}: it is a loopback or private network address`);
  }
}

function formatFromContentType(contentType: string | null): RdfFormat | null {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const map: Record<string, RdfFormat> = {
    "text/turtle": "turtle",
    "application/x-turtle": "turtle",
    "application/rdf+xml": "rdfxml",
    "application/owl+xml": "rdfxml",
    "application/ld+json": "jsonld",
    "application/n-triples": "ntriples",
    "application/n-quads": "nquads",
    "application/trig": "trig",
    "text/n3": "n3",
  };
  return map[ct] ?? null;
}

function sniffFormat(body: string): RdfFormat {
  const head = body.trimStart().slice(0, 500);
  if (head.startsWith("<?xml") || /^<rdf:RDF\b/.test(head) || /^<!DOCTYPE/i.test(head)) return "rdfxml";
  if (head.startsWith("{") || head.startsWith("[")) return "jsonld";
  return "turtle";
}

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_FETCH_BYTES) throw new ImportError(`The document is larger than ${MAX_FETCH_BYTES / 1024 / 1024} MB`);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ImportError(`The document is larger than ${MAX_FETCH_BYTES / 1024 / 1024} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Fetches and parses an RDF document; follows redirects, checking every hop. */
export async function fetchRdf(iri: string): Promise<{ store: Store; prefixes: Record<string, string>; finalUrl: string }> {
  let url: URL;
  try {
    url = new URL(iri);
  } catch {
    throw new ImportError(`Not a valid URL: ${iri}`);
  }
  url.hash = "";
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertFetchable(url);
    try {
      res = await fetch(url, { headers: { Accept: ACCEPT }, redirect: "manual", signal });
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError")
        throw new ImportError(`Timed out after ${FETCH_TIMEOUT_MS / 1000}s fetching ${url.href}`);
      throw new ImportError(`Could not fetch ${url.href}: ${err.message}`);
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      url = new URL(location, url);
      url.hash = "";
      res = null;
      continue;
    }
    break;
  }
  if (!res) throw new ImportError(`Too many redirects fetching ${iri}`);
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ImportError(`Fetching ${url.href} failed: HTTP ${res.status}`);
  }
  const body = await readCapped(res);
  const format = formatFromContentType(res.headers.get("content-type")) ?? formatFromFilename(url.pathname) ?? sniffFormat(body);
  try {
    const parsed = await parseRdf(body, format, { baseIRI: url.href });
    return { store: parsed.store, prefixes: parsed.prefixes, finalUrl: url.href };
  } catch (e) {
    throw new ImportError(`Could not parse ${url.href} as RDF: ${(e as Error).message}`);
  }
}

interface RemoteDoc {
  store: Store;
  fetchedAt: string;
  ontologyIri: string | null;
  label: string | null;
}

/**
 * The parsed document at a remote IRI: from memory, then the disk cache, then the network
 * (always the network when `refresh`). A successful fetch is written to the disk cache.
 */
export async function loadRemote(iri: string, opts: { refresh?: boolean } = {}): Promise<RemoteDoc> {
  const key = cacheKey(iri);
  if (!opts.refresh) {
    const mem = state.remoteMemo.get(key);
    if (mem) return mem;
    const ttl = path.join(cacheDir(), `${key}.ttl`);
    const meta = path.join(cacheDir(), `${key}.json`);
    if (fs.existsSync(ttl)) {
      try {
        const m = JSON.parse(fs.readFileSync(meta, "utf8")) as { fetched_at?: string };
        const parsed = parseTurtle(fs.readFileSync(ttl, "utf8"));
        const ontologyIri = findOntologyIri(parsed.store);
        const doc = {
          store: parsed.store,
          fetchedAt: m.fetched_at ?? fs.statSync(ttl).mtime.toISOString(),
          ontologyIri,
          label: ontologyLabel(parsed.store, ontologyIri),
        };
        state.remoteMemo.set(key, doc);
        return doc;
      } catch {
        // A damaged cache entry is refetched below.
      }
    }
    const failed = state.remoteFailures.get(key);
    if (failed && Date.now() - failed.at < NEGATIVE_CACHE_MS) throw new ImportError(failed.error);
  }
  let fetched;
  try {
    fetched = await fetchRdf(iri);
  } catch (e) {
    const message = (e as Error).message;
    state.remoteFailures.set(key, { at: Date.now(), error: message });
    throw e instanceof ImportError ? e : new ImportError(message);
  }
  state.remoteFailures.delete(key);
  const fetchedAt = new Date().toISOString();
  const turtle = await serializeTurtle(fetched.store, fetched.prefixes);
  fs.mkdirSync(cacheDir(), { recursive: true });
  fs.writeFileSync(path.join(cacheDir(), `${key}.ttl`), turtle);
  fs.writeFileSync(
    path.join(cacheDir(), `${key}.json`),
    JSON.stringify({ iri, final_url: fetched.finalUrl, fetched_at: fetchedAt }, null, 2),
  );
  const ontologyIri = findOntologyIri(fetched.store);
  const doc = { store: fetched.store, fetchedAt, ontologyIri, label: ontologyLabel(fetched.store, ontologyIri) };
  state.remoteMemo.set(key, doc);
  state.generation++;
  return doc;
}

// ---------------------------------------------------------------------------
// Closure resolution
// ---------------------------------------------------------------------------

interface ResolvedImport {
  status: ImportStatus;
  store: Store | null;
  /** The ontology IRI the imported document declares (falls back to the import IRI). */
  ontologyIri: string;
}

async function resolveOne(
  iri: string,
  rootProjectId: string,
  refresh: boolean,
): Promise<{ status: Omit<ImportStatus, "direct" | "imported_by">; store: Store | null; ontologyIri: string }> {
  const project = await findProjectByIri(iri);
  if (project) {
    const base = { iri, source: "project" as const, project_id: project.projectId, project_name: project.name };
    if (project.projectId === rootProjectId) {
      return { status: { ...base, status: "cycle", class_count: 0, label: project.name }, store: null, ontologyIri: iri };
    }
    try {
      const onto = await loadOntology(project.projectId, await git.getDefaultBranch(project.projectId));
      return {
        status: { ...base, status: "ok", class_count: listClasses(onto.store).length, label: project.name },
        store: onto.store,
        ontologyIri: findOntologyIri(onto.store) ?? iri,
      };
    } catch (e) {
      const detail = (e as { detail?: unknown }).detail;
      return {
        status: { ...base, status: "error", error: typeof detail === "string" ? detail : (e as Error).message, class_count: 0, label: project.name },
        store: null,
        ontologyIri: iri,
      };
    }
  }
  try {
    const doc = await loadRemote(iri, { refresh });
    return {
      status: {
        iri,
        source: "remote",
        status: "ok",
        class_count: listClasses(doc.store).length,
        label: doc.label,
        fetched_at: doc.fetchedAt,
      },
      store: doc.store,
      ontologyIri: doc.ontologyIri ?? iri,
    };
  } catch (e) {
    return {
      status: { iri, source: "remote", status: "error", error: (e as Error).message, class_count: 0, label: null, fetched_at: null },
      store: null,
      ontologyIri: iri,
    };
  }
}

export interface ImportClosure {
  direct: string[];
  resolved: ResolvedImport[];
}

/** Resolves the transitive imports of `store` (a branch of `projectId`), breadth-first. */
export async function resolveClosure(
  projectId: string,
  store: Store,
  opts: { refresh?: boolean } = {},
): Promise<ImportClosure> {
  const project = requireProject(projectId);
  const rootIri = findOntologyIri(store) ?? project.ontology_iri ?? `urn:ontobuilder:project:${projectId}`;
  const rootNorms = new Set([normIri(rootIri), ...(project.ontology_iri ? [normIri(project.ontology_iri)] : [])]);
  const direct = directImports(store);
  const entries = new Map<string, ResolvedImport>();
  const queue = direct.map((iri) => ({ iri, parent: rootIri, depth: 1 }));
  while (queue.length) {
    const { iri, parent, depth } = queue.shift()!;
    const n = normIri(iri);
    const existing = entries.get(n);
    if (existing) {
      if (!existing.status.imported_by.includes(parent)) existing.status.imported_by.push(parent);
      if (depth === 1) existing.status.direct = true;
      continue;
    }
    if (rootNorms.has(n)) {
      entries.set(n, {
        status: {
          iri,
          source: "project",
          project_id: projectId,
          project_name: project.name,
          status: "cycle",
          error: "Imports this ontology back, forming a cycle",
          class_count: 0,
          direct: depth === 1,
          imported_by: [parent],
          label: project.name,
        },
        store: null,
        ontologyIri: iri,
      });
      continue;
    }
    if (depth > MAX_IMPORT_DEPTH) {
      entries.set(n, {
        status: {
          iri,
          source: "remote",
          status: "error",
          error: `Not resolved: imports are followed to a depth of ${MAX_IMPORT_DEPTH}`,
          class_count: 0,
          direct: false,
          imported_by: [parent],
          label: null,
        },
        store: null,
        ontologyIri: iri,
      });
      continue;
    }
    const r = await resolveOne(iri, projectId, !!opts.refresh);
    if (r.status.status === "cycle") r.status.error = "Imports this ontology back, forming a cycle";
    const entry: ResolvedImport = {
      status: { ...r.status, direct: depth === 1, imported_by: [parent] },
      store: r.store,
      ontologyIri: r.ontologyIri,
    };
    entries.set(n, entry);
    if (r.store) for (const child of directImports(r.store)) queue.push({ iri: child, parent: iri, depth: depth + 1 });
  }
  return { direct, resolved: [...entries.values()] };
}

export function closureResponse(closure: ImportClosure): ImportsResponse {
  return { direct: closure.direct, closure: closure.resolved.map((r) => r.status) };
}

// ---------------------------------------------------------------------------
// Merged view for the editor
// ---------------------------------------------------------------------------

export interface ImportedFrom {
  /** IRI of the ontology that declares the class. */
  iri: string;
  /** Project name or ontology label, for display. */
  label: string | null;
}

export interface ImportView {
  /** Local triples plus every resolved import's triples (except their ontology headers). Read-only. */
  store: Store;
  /** Imported classes (not declared as classes locally), with the ontology they come from. */
  importedFrom: Map<string, ImportedFrom>;
  closure: ImportClosure;
}

function isLocalClass(store: Store, iri: string): boolean {
  return hasType(store, iri, OWL_CLASS) || hasType(store, iri, RDFS_CLASS);
}

/**
 * The local ontology merged with its imports. Returns the local store unchanged when the
 * ontology imports nothing. Cached per commit until any ontology changes (or 30 s pass).
 */
export async function getImportView(onto: LoadedOntology): Promise<ImportView> {
  const direct = directImports(onto.store);
  if (!direct.length) {
    return { store: onto.store, importedFrom: new Map(), closure: { direct: [], resolved: [] } };
  }
  const key = `${onto.projectId}:${onto.commitHash}`;
  const hit = state.views.get(key);
  if (hit && hit.generation === state.generation && Date.now() - hit.at < VIEW_TTL_MS) return hit.view;

  const closure = await resolveClosure(onto.projectId, onto.store);
  const merged = new Store(onto.store.getQuads(null, null, null, null));
  const importedFrom = new Map<string, ImportedFrom>();
  for (const r of closure.resolved) {
    if (!r.store) continue;
    const headers = new Set(ontologySubjects(r.store));
    for (const q of r.store.getQuads(null, null, null, null)) {
      if (headers.has(q.subject.value)) continue;
      merged.addQuad(q);
    }
    const from = { iri: r.ontologyIri, label: r.status.project_name ?? r.status.label ?? null };
    for (const cls of listClasses(r.store)) {
      if (!importedFrom.has(cls) && !isLocalClass(onto.store, cls)) importedFrom.set(cls, from);
    }
  }
  const view = { store: merged, importedFrom, closure };
  state.views.set(key, { at: Date.now(), generation: state.generation, view });
  while (state.views.size > 12) state.views.delete(state.views.keys().next().value!);
  state.classSets.set(signature(direct), new Set(importedFrom.keys()));
  return view;
}

function signature(direct: string[]): string {
  return [...direct].map(normIri).sort().join("\n");
}

// The linter runs synchronously on the local store; let it know which classes the
// ontology's imports provide (from the last resolution) so it does not report them
// as undefined parents.
setExternalClassResolver((store) => {
  const direct = directImports(store);
  if (!direct.length) return null;
  return state.classSets.get(signature(direct)) ?? null;
});

// ---------------------------------------------------------------------------
// Editing owl:imports in the Turtle source (text-preserving)
// ---------------------------------------------------------------------------

function termForm(iri: string, prefixes: Record<string, string>): string {
  for (const [alias, ns] of Object.entries(prefixes)) {
    if (iri.startsWith(ns)) {
      const local = iri.slice(ns.length);
      if (/^[A-Za-z_][\w-]*$/.test(local)) return `${alias}:${local}`;
    }
  }
  return `<${iri}>`;
}

function tokensIn(source: string, start: number, end: number): TurtleToken[] {
  const out: TurtleToken[] = [];
  for (const tok of lexTurtle(source, start)) {
    if (tok.start >= end) break;
    out.push(tok);
  }
  return out;
}

function sameTriples(content: string, expectedCount: number, check: (s: Store) => boolean): boolean {
  try {
    const { store } = parseTurtle(content);
    return store.size === expectedCount && check(store);
  } catch {
    return false;
  }
}

/**
 * Adds `<ontology> owl:imports <importIri>` to Turtle source, editing only the ontology
 * header's text. Creates an owl:Ontology header named `fallbackOntologyIri` when there is none.
 * Falls back to re-serializing the graph if the text edit does not produce the expected triples.
 */
export async function addImportToTurtle(source: string, importIri: string, fallbackOntologyIri: string): Promise<string> {
  const parsed = parseTurtle(source);
  const { prefixes, base } = parseDeclarations(source);
  const existingOntology = findOntologyIri(parsed.store);
  const ontologyIri = existingOntology ?? fallbackOntologyIri;
  const pred = termForm(OWL_IMPORTS, prefixes);
  const obj = `<${importIri}>`;
  const expected = parsed.store.size + (existingOntology ? 1 : 2);
  const has = (s: Store) => s.countQuads(ontologyIri, OWL_IMPORTS, importIri, null) === 1;

  let edited: string | null = null;
  if (existingOntology) {
    const span = findBlockSpan(source, ontologyIri, prefixes, base);
    if (span) {
      const toks = tokensIn(source, span.start, span.end);
      const last = toks[toks.length - 1];
      if (last && last.kind === "punct" && last.text === ".") {
        const before = source.slice(0, last.start).replace(/\s+$/, "");
        edited = `${before} ;\n    ${pred} ${obj} .${source.slice(last.end)}`;
      }
    }
  } else {
    const header = `<${ontologyIri}> a ${termForm(OWL_ONTOLOGY, prefixes)} ;\n    ${pred} ${obj} .\n`;
    const lines = source.split("\n");
    let lastDirective = -1;
    lines.forEach((l, i) => {
      if (/^\s*(@prefix|@base|PREFIX|BASE)\b/i.test(l)) lastDirective = i;
    });
    if (lastDirective >= 0) {
      lines.splice(lastDirective + 1, 0, "", header.trimEnd());
      edited = lines.join("\n");
    } else {
      edited = header + (source.trim() ? "\n" + source : "");
    }
  }
  if (edited !== null && sameTriples(edited, expected, has)) return edited;

  const store = new Store(parsed.store.getQuads(null, null, null, null));
  const { namedNode } = DataFactory;
  if (!existingOntology) store.addQuad(namedNode(ontologyIri), namedNode(RDF_TYPE), namedNode(OWL_ONTOLOGY));
  store.addQuad(namedNode(ontologyIri), namedNode(OWL_IMPORTS), namedNode(importIri));
  return serializeTurtle(store, parsed.prefixes);
}

interface PoGroup {
  /** First token of the group (the predicate) and its last token. */
  first: TurtleToken;
  last: TurtleToken;
  predicate: TurtleToken;
  objects: { first: TurtleToken; last: TurtleToken }[];
  /** The `;` before the group, if any. */
  sepBefore: TurtleToken | null;
  /** The `;` after the group, if any. */
  sepAfter: TurtleToken | null;
}

/** Splits a statement's tokens (subject ... `.`) into predicate-object groups at depth 0. */
function poGroups(toks: TurtleToken[]): PoGroup[] {
  const groups: PoGroup[] = [];
  let depth = 0;
  let cur: { tokens: TurtleToken[]; sepBefore: TurtleToken | null } = { tokens: [], sepBefore: null };
  const flush = (sepAfter: TurtleToken | null) => {
    const t = cur.tokens;
    if (t.length >= 2) {
      const objects: { first: TurtleToken; last: TurtleToken }[] = [];
      let objStart: TurtleToken | null = null;
      let prev: TurtleToken | null = null;
      let d = 0;
      for (const tok of t.slice(1)) {
        if (tok.kind === "punct" && (tok.text === "[" || tok.text === "(")) d++;
        if (tok.kind === "punct" && (tok.text === "]" || tok.text === ")")) d--;
        if (d === 0 && tok.kind === "punct" && tok.text === ",") {
          if (objStart && prev) objects.push({ first: objStart, last: prev });
          objStart = null;
        } else if (!objStart) objStart = tok;
        prev = tok;
      }
      if (objStart && prev) objects.push({ first: objStart, last: prev });
      groups.push({ first: t[0], last: t[t.length - 1], predicate: t[0], objects, sepBefore: cur.sepBefore, sepAfter });
    }
  };
  // toks[0] is the subject; the final token is the terminating `.`.
  for (const tok of toks.slice(1, -1)) {
    if (tok.kind === "punct" && (tok.text === "[" || tok.text === "(")) depth++;
    if (tok.kind === "punct" && (tok.text === "]" || tok.text === ")")) depth--;
    if (depth === 0 && tok.kind === "punct" && tok.text === ";") {
      flush(tok);
      cur = { tokens: [], sepBefore: tok };
      continue;
    }
    cur.tokens.push(tok);
  }
  flush(null);
  return groups;
}

/** Removes every `<ontology> owl:imports <importIri>` triple, editing only that text where possible. */
export async function removeImportFromTurtle(source: string, importIri: string): Promise<string> {
  const parsed = parseTurtle(source);
  const { prefixes, base } = parseDeclarations(source);
  const targets = parsed.store.getQuads(null, OWL_IMPORTS, importIri, null);
  if (!targets.length) return source;
  const expected = parsed.store.size - targets.length;
  const gone = (s: Store) => s.countQuads(null, OWL_IMPORTS, importIri, null) === 0;
  const predForms = new Set(iriTurtleForms(OWL_IMPORTS, prefixes, base));
  const objForms = new Set(iriTurtleForms(importIri, prefixes, base));

  let text = source;
  for (const subject of new Set(targets.map((q) => q.subject.value))) {
    for (let guard = 0; guard < 20; guard++) {
      const span = findBlockSpan(text, subject, prefixes, base);
      if (!span) break;
      const toks = tokensIn(text, span.start, span.end);
      const groups = poGroups(toks);
      let cut: [number, number] | null = null;
      for (const g of groups) {
        if (!predForms.has(g.predicate.text)) continue;
        const idx = g.objects.findIndex((o) => o.first === o.last && objForms.has(o.first.text));
        if (idx < 0) continue;
        const o = g.objects[idx];
        if (g.objects.length > 1) {
          // Drop the object and one neighbouring comma.
          cut = idx < g.objects.length - 1 ? [o.first.start, g.objects[idx + 1].first.start] : [g.objects[idx - 1].last.end, o.last.end];
        } else if (groups.length === 1) {
          cut = [span.start, span.end];
        } else if (g.sepBefore) {
          cut = [g.sepBefore.start, g.last.end];
        } else if (g.sepAfter) {
          const next = groups[groups.indexOf(g) + 1];
          cut = [g.first.start, next ? next.first.start : g.sepAfter.end];
        }
        break;
      }
      if (!cut) break;
      text = text.slice(0, cut[0]) + text.slice(cut[1]);
    }
  }
  if (sameTriples(text, expected, gone)) return text;

  const store = new Store(parsed.store.getQuads(null, null, null, null));
  for (const q of targets) store.removeQuad(q);
  return serializeTurtle(store, parsed.prefixes);
}

// ---------------------------------------------------------------------------
// Operations used by the routes
// ---------------------------------------------------------------------------

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "ontology"
  );
}

export async function listImports(projectId: string, branch: string, opts: { refresh?: boolean } = {}): Promise<ImportsResponse> {
  const onto = await loadOntology(projectId, branch);
  if (opts.refresh) {
    state.remoteFailures.clear();
    state.projectIndex = null;
    state.generation++;
  }
  return closureResponse(await resolveClosure(projectId, onto.store, opts));
}

export async function addImport(
  projectId: string,
  branch: string,
  iri: string,
  commitMessage?: string,
): Promise<ImportsResponse> {
  const project = requireProject(projectId);
  if (!isValidIri(iri)) httpError(422, "Field 'iri' must be an absolute IRI");
  const onto = await loadOntology(projectId, branch);
  const own = findOntologyIri(onto.store);
  const n = normIri(iri);
  if ((own && normIri(own) === n) || (project.ontology_iri && normIri(project.ontology_iri) === n)) {
    httpError(400, "An ontology cannot import itself");
  }
  const target = await findProjectByIri(iri);
  if (target?.projectId === projectId) httpError(400, "An ontology cannot import itself");
  if (directImports(onto.store).some((d) => normIri(d) === n)) httpError(409, `Already imported: ${iri}`);
  if (!target) {
    let scheme = "";
    try {
      scheme = new URL(iri).protocol;
    } catch {
      scheme = "";
    }
    if (scheme !== "http:" && scheme !== "https:") {
      httpError(400, "No OntoBuilder project has this ontology IRI, and only http(s) IRIs can be fetched");
    }
  }
  const fallback = project.ontology_iri ?? `http://example.org/ontologies/${slug(project.name)}`;
  const content = await addImportToTurtle(onto.content, iri, fallback);
  await commitOntology({
    projectId,
    branch,
    content,
    message: commitMessage || `Import ${target ? target.name : iri}`,
    origin: "imports",
  });
  // Resolve now so a remote document is fetched and cached while the user waits.
  const after = await loadOntology(projectId, branch);
  return closureResponse(await resolveClosure(projectId, after.store));
}

export async function removeImport(
  projectId: string,
  branch: string,
  iri: string,
  commitMessage?: string,
): Promise<ImportsResponse> {
  requireProject(projectId);
  const onto = await loadOntology(projectId, branch);
  const n = normIri(iri);
  const match = directImports(onto.store).find((d) => d === iri) ?? directImports(onto.store).find((d) => normIri(d) === n);
  if (!match) httpError(404, `Not imported: ${iri}`);
  const content = await removeImportFromTurtle(onto.content, match);
  await commitOntology({
    projectId,
    branch,
    content,
    message: commitMessage || `Remove import ${match}`,
    origin: "imports",
  });
  const after = await loadOntology(projectId, branch);
  return closureResponse(await resolveClosure(projectId, after.store));
}

/** Clears cached views (used by tests and the refresh action). */
export function invalidateImportCaches(): void {
  state.views.clear();
  state.remoteMemo.clear();
  state.remoteFailures.clear();
  state.projectIndex = null;
  state.generation++;
}
