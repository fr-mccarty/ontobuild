/**
 * Project ontology access: project rows, loading a branch's ontology into an N3 Store
 * (cached by commit sha), committing new Turtle, commit/branch event hooks, and
 * reusable store query helpers (labels, comments, types, classes, properties, ...).
 */
import type { Quad, Term } from "n3";
import { Store } from "n3";
import * as git from "./git";
import { all, bool, fromJson, get } from "./db";
import { httpError } from "./http";
import { LOCAL_USER, LOCAL_ROLE } from "./user";
import { NS, parseTurtle, RdfParseError, findOntologyIri } from "./rdf";

export { NS, findOntologyIri };

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  is_public: number;
  owner_id: string;
  created_at: string;
  updated_at: string | null;
  source_file_path: string | null;
  git_ontology_path: string | null;
  ontology_iri: string | null;
  label_preferences: string | null;
  normalization_report: string | null;
  pr_approval_required: number;
  preferred_branch: string | null;
}

export const DEFAULT_ONTOLOGY_FILE = "ontology.ttl";

/** Project row or undefined. */
export function getProjectRow(projectId: string): ProjectRow | undefined {
  return get<ProjectRow>("SELECT * FROM projects WHERE id = ?", projectId);
}

/** Project row or 404 `{"detail": "Project not found"}`. */
export function requireProject(projectId: string): ProjectRow {
  const row = getProjectRow(projectId);
  if (!row) httpError(404, "Project not found");
  return row;
}

/** Path of the ontology file inside the project's git repo. */
export function ontologyFilePath(project: ProjectRow): string {
  if (project.git_ontology_path) return project.git_ontology_path;
  if (project.source_file_path) return project.source_file_path.split("/").pop() || DEFAULT_ONTOLOGY_FILE;
  return DEFAULT_ONTOLOGY_FILE;
}

/** Label preferences of a project (array of "rdfs:label@en"-style strings) or null. */
export function projectLabelPreferences(project: ProjectRow): string[] | null {
  return fromJson<string[] | null>(project.label_preferences, null);
}

/**
 * ProjectResponse JSON (FastAPI shape). The local user is always the owner.
 */
export function projectToResponse(p: ProjectRow) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    is_public: bool(p.is_public),
    owner_id: p.owner_id,
    owner: { id: LOCAL_USER.id, name: LOCAL_USER.name, email: LOCAL_USER.email },
    created_at: p.created_at,
    updated_at: p.updated_at,
    member_count: 1,
    user_role: LOCAL_ROLE,
    is_superadmin: false,
    source_file_path: p.source_file_path,
    git_ontology_path: p.source_file_path ? ontologyFilePath(p) : null,
    ontology_iri: p.ontology_iri,
    label_preferences: projectLabelPreferences(p),
    normalization_report: fromJson<Record<string, unknown> | null>(p.normalization_report, null),
  };
}

/** Branch to use when a request does not specify one. */
export async function resolveBranch(projectId: string, branch?: string | null): Promise<string> {
  if (branch) return branch;
  if (!git.repoExists(projectId)) return git.DEFAULT_BRANCH;
  return git.getDefaultBranch(projectId);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface LoadedOntology {
  projectId: string;
  /** The ref that was requested (branch name or commit). */
  ref: string;
  commitHash: string;
  filePath: string;
  /** Raw Turtle source. */
  content: string;
  store: Store;
  prefixes: Record<string, string>;
}

type Cache = Map<string, LoadedOntology>;
const g = globalThis as typeof globalThis & { __ontokitOntologyCache?: Cache };
const cache: Cache = (g.__ontokitOntologyCache ??= new Map());
const CACHE_SIZE = 12;

/**
 * Load the project's ontology at a branch (default branch if omitted) or commit into an
 * N3 Store. Cached by (project, commit sha). 404 if there is no repo / file.
 * Treat the returned store as read-only (it is shared); copy it before mutating
 * (`new Store(loaded.store.getQuads(null, null, null, null))`).
 */
export async function loadOntology(projectId: string, ref?: string | null): Promise<LoadedOntology> {
  const project = requireProject(projectId);
  if (!git.repoExists(projectId)) httpError(404, "No repository found for this project");
  const wanted = await resolveBranch(projectId, ref);
  let sha: string;
  try {
    sha = await git.resolveRef(projectId, wanted);
  } catch {
    httpError(404, `Branch not found: ${wanted}`);
  }
  const filePath = ontologyFilePath(project);
  const key = `${projectId}:${sha}:${filePath}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // LRU bump
    return { ...hit, ref: wanted };
  }
  const content = await git.readFileOrNull(projectId, sha, filePath);
  if (content === null) httpError(404, "Ontology file not found in repository");
  let parsed;
  try {
    parsed = parseTurtle(content);
  } catch (e) {
    httpError(422, `Failed to parse ontology: ${(e as Error).message}`);
  }
  const loaded: LoadedOntology = {
    projectId,
    ref: wanted,
    commitHash: sha,
    filePath,
    content,
    store: parsed.store,
    prefixes: parsed.prefixes,
  };
  cache.set(key, loaded);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return loaded;
}

/** Drop cached stores for a project (all commits). */
export function invalidateOntologyCache(projectId: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(projectId + ":")) cache.delete(k);
}

// ---------------------------------------------------------------------------
// Events (other domains hook in here: indexing, analytics/change events, lint, ...)
// ---------------------------------------------------------------------------

export type OntologyEvent =
  | {
      type: "commit";
      projectId: string;
      branch: string;
      commitHash: string;
      /** Previous head of the branch (null for the first commit). */
      parentHash: string | null;
      message: string;
      /** "import" | "create" | "source" | "metadata" | "merge" | other free-form origin. */
      origin: string;
    }
  | { type: "branch-created"; projectId: string; branch: string; commitHash: string | null }
  | { type: "branch-deleted"; projectId: string; branch: string }
  | { type: "project-deleted"; projectId: string };

type Listener = (e: OntologyEvent) => void | Promise<void>;
const listenersG = globalThis as typeof globalThis & { __ontokitListeners?: Map<string, Listener> };
const listeners: Map<string, Listener> = (listenersG.__ontokitListeners ??= new Map());

/**
 * Register a listener under a unique name (re-registering replaces it — safe under HMR).
 * Listeners run after the response-producing work, errors are logged and swallowed.
 */
export function onOntologyEvent(name: string, fn: Listener) {
  listeners.set(name, fn);
}

/** Fire an event to all listeners (awaits them; never throws). */
export async function emitOntologyEvent(e: OntologyEvent): Promise<void> {
  for (const [name, fn] of listeners) {
    try {
      await fn(e);
    } catch (err) {
      console.warn(`[ontokit] listener '${name}' failed for ${e.type}:`, err);
    }
  }
}

/**
 * Hook point for analytics change events. The analytics agent can replace this by
 * registering an `onOntologyEvent` listener for "commit" events instead.
 */
export function recordChange(_e: Extract<OntologyEvent, { type: "commit" }>): void {
  /* intentionally empty */
}

// ---------------------------------------------------------------------------
// Committing
// ---------------------------------------------------------------------------

/**
 * Validate Turtle and commit it as the project's ontology file on `branch`
 * (default branch if omitted). Fires a "commit" event. Throws 422 for invalid Turtle.
 */
export async function commitOntology(opts: {
  projectId: string;
  branch?: string | null;
  content: string;
  message: string;
  origin?: string;
  validate?: boolean;
}): Promise<git.CommitInfo & { branch: string }> {
  const project = requireProject(opts.projectId);
  if (opts.validate !== false) {
    try {
      parseTurtle(opts.content);
    } catch (e) {
      if (e instanceof RdfParseError) httpError(422, `Invalid Turtle syntax: ${e.message}`);
      throw e;
    }
  }
  const branch = await resolveBranch(opts.projectId, opts.branch);
  let parentHash: string | null = null;
  if (git.repoExists(opts.projectId)) {
    try {
      parentHash = await git.resolveRef(opts.projectId, `refs/heads/${branch}`);
    } catch {
      parentHash = null;
    }
  }
  const commit = await git.commitFile(opts.projectId, {
    branch,
    path: ontologyFilePath(project),
    content: opts.content,
    message: opts.message,
    author: { name: LOCAL_USER.name, email: LOCAL_USER.email },
  });
  const event = {
    type: "commit" as const,
    projectId: opts.projectId,
    branch,
    commitHash: commit.hash,
    parentHash,
    message: opts.message,
    origin: opts.origin ?? "source",
  };
  recordChange(event);
  await emitOntologyEvent(event);
  return { ...commit, branch };
}

// ---------------------------------------------------------------------------
// Store query helpers
// ---------------------------------------------------------------------------

export const RDF_TYPE = NS.rdf + "type";
export const RDFS_LABEL = NS.rdfs + "label";
export const RDFS_COMMENT = NS.rdfs + "comment";
export const RDFS_SUBCLASS_OF = NS.rdfs + "subClassOf";
export const RDFS_SUBPROPERTY_OF = NS.rdfs + "subPropertyOf";
export const RDFS_DOMAIN = NS.rdfs + "domain";
export const RDFS_RANGE = NS.rdfs + "range";
export const OWL_CLASS = NS.owl + "Class";
export const OWL_THING = NS.owl + "Thing";
export const OWL_DEPRECATED = NS.owl + "deprecated";
export const OWL_EQUIVALENT_CLASS = NS.owl + "equivalentClass";
export const OWL_DISJOINT_WITH = NS.owl + "disjointWith";
export const OWL_OBJECT_PROPERTY = NS.owl + "ObjectProperty";
export const OWL_DATATYPE_PROPERTY = NS.owl + "DatatypeProperty";
export const OWL_ANNOTATION_PROPERTY = NS.owl + "AnnotationProperty";
export const OWL_NAMED_INDIVIDUAL = NS.owl + "NamedIndividual";
export const RDFS_CLASS = NS.rdfs + "Class";
export const RDF_PROPERTY = NS.rdf + "Property";
export const SKOS_PREF_LABEL = NS.skos + "prefLabel";

export interface LocalizedString {
  value: string;
  lang: string;
}

/** Prefixed property names usable in label preferences. */
export const LABEL_PROPERTY_MAP: Record<string, string> = {
  "rdfs:label": RDFS_LABEL,
  "skos:prefLabel": SKOS_PREF_LABEL,
  "skos:altLabel": NS.skos + "altLabel",
  "skos:hiddenLabel": NS.skos + "hiddenLabel",
  "dcterms:title": NS.dcterms + "title",
  "dc:title": NS.dc + "title",
};

export const DEFAULT_LABEL_PREFERENCES = ["rdfs:label@en", "rdfs:label", "skos:prefLabel@en", "skos:prefLabel"];

/** Objects of (iri, predicate) as N3 terms. `iri` may be "_:b0"-style for blank nodes. */
export function getObjects(store: Store, iri: string, predicate: string): Term[] {
  return store.getObjects(subjectTerm(iri), predicate, null);
}

/** Subjects having (predicate, object). */
export function getSubjects(store: Store, predicate: string, object: string | Term): Term[] {
  return store.getSubjects(predicate, object as never, null);
}

/** IRIs (named nodes only) among objects of (iri, predicate). */
export function getObjectIris(store: Store, iri: string, predicate: string): string[] {
  return uniq(getObjects(store, iri, predicate).filter(isNamed).map((t) => t.value));
}

/** Literal values of (iri, predicate) as `{value, lang}` (lang "" when untagged). */
export function getLiterals(store: Store, iri: string, predicate: string): LocalizedString[] {
  return getObjects(store, iri, predicate)
    .filter((t) => t.termType === "Literal")
    .map((t) => ({ value: t.value, lang: (t as unknown as { language: string }).language || "" }));
}

/** rdfs:label values. */
export function getLabels(store: Store, iri: string): LocalizedString[] {
  return getLiterals(store, iri, RDFS_LABEL);
}

/** rdfs:comment values. */
export function getComments(store: Store, iri: string): LocalizedString[] {
  return getLiterals(store, iri, RDFS_COMMENT);
}

/** rdf:type IRIs. */
export function getTypes(store: Store, iri: string): string[] {
  return getObjectIris(store, iri, RDF_TYPE);
}

export function hasType(store: Store, iri: string, typeIri: string): boolean {
  return store.countQuads(subjectTerm(iri), RDF_TYPE, typeIri, null) > 0;
}

/** owl:deprecated true? */
export function isDeprecated(store: Store, iri: string): boolean {
  return getObjects(store, iri, OWL_DEPRECATED).some((t) => t.value === "true" || t.value === "1");
}

/** Last path segment / fragment of an IRI. */
export function localName(iri: string): string {
  const m = /[#/:]([^#/:]+)[#/]?$/.exec(iri);
  return m ? m[1] : iri;
}

/**
 * Best display label following preferences like ["rdfs:label@en", "skos:prefLabel"]
 * (an empty language after "@" means untagged). Falls back to any rdfs:label, then
 * (when `fallbackToLocalName`) the IRI's local name, else null.
 */
export function getPreferredLabel(
  store: Store,
  iri: string,
  preferences?: string[] | null,
  fallbackToLocalName = false,
): string | null {
  const prefs = preferences && preferences.length ? preferences : DEFAULT_LABEL_PREFERENCES;
  for (const pref of prefs) {
    const at = pref.lastIndexOf("@");
    const prop = at >= 0 ? pref.slice(0, at) : pref;
    const lang = at >= 0 ? pref.slice(at + 1) : null;
    const propIri = LABEL_PROPERTY_MAP[prop];
    if (!propIri) continue;
    for (const l of getLiterals(store, iri, propIri)) {
      if (lang === null || l.lang === lang) return l.value;
    }
  }
  const any = getLabels(store, iri)[0];
  if (any) return any.value;
  return fallbackToLocalName ? localName(iri) : null;
}

/** Named subjects with any of the given rdf:types, sorted. */
export function listSubjectsOfType(store: Store, types: string[]): string[] {
  const out = new Set<string>();
  for (const t of types) for (const s of store.getSubjects(RDF_TYPE, t, null)) if (isNamed(s)) out.add(s.value);
  return [...out].sort();
}

/** Named classes (owl:Class or rdfs:Class), excluding owl:Thing. */
export function listClasses(store: Store): string[] {
  return listSubjectsOfType(store, [OWL_CLASS, RDFS_CLASS]).filter((c) => c !== OWL_THING);
}

export function listObjectProperties(store: Store): string[] {
  return listSubjectsOfType(store, [OWL_OBJECT_PROPERTY]);
}
export function listDatatypeProperties(store: Store): string[] {
  return listSubjectsOfType(store, [OWL_DATATYPE_PROPERTY]);
}
export function listAnnotationProperties(store: Store): string[] {
  return listSubjectsOfType(store, [OWL_ANNOTATION_PROPERTY]);
}
/** All properties (object, datatype, annotation, rdf:Property). */
export function listProperties(store: Store): string[] {
  return listSubjectsOfType(store, [OWL_OBJECT_PROPERTY, OWL_DATATYPE_PROPERTY, OWL_ANNOTATION_PROPERTY, RDF_PROPERTY]);
}

/** "object" | "data" | "annotation" | null for a property IRI. */
export function propertyKind(store: Store, iri: string): "object" | "data" | "annotation" | null {
  if (hasType(store, iri, OWL_OBJECT_PROPERTY)) return "object";
  if (hasType(store, iri, OWL_DATATYPE_PROPERTY)) return "data";
  if (hasType(store, iri, OWL_ANNOTATION_PROPERTY)) return "annotation";
  return null;
}

/**
 * Individuals: owl:NamedIndividual subjects plus named subjects typed with a class
 * declared in the ontology.
 */
export function listIndividuals(store: Store): string[] {
  const out = new Set(listSubjectsOfType(store, [OWL_NAMED_INDIVIDUAL]));
  const classes = new Set(listClasses(store));
  for (const q of store.getQuads(null, RDF_TYPE, null, null)) {
    if (isNamed(q.subject) && isNamed(q.object) && classes.has(q.object.value)) out.add(q.subject.value);
  }
  for (const c of classes) out.delete(c);
  return [...out].sort();
}

/** "class" | "property" | "individual" | null. */
export function entityType(store: Store, iri: string): "class" | "property" | "individual" | null {
  const types = new Set(getTypes(store, iri));
  if (types.has(OWL_CLASS) || types.has(RDFS_CLASS)) return "class";
  if ([OWL_OBJECT_PROPERTY, OWL_DATATYPE_PROPERTY, OWL_ANNOTATION_PROPERTY, RDF_PROPERTY].some((t) => types.has(t)))
    return "property";
  if (types.size > 0) return "individual";
  return null;
}

/** Direct named superclasses (rdfs:subClassOf with IRI objects). */
export function getSuperClasses(store: Store, iri: string): string[] {
  return getObjectIris(store, iri, RDFS_SUBCLASS_OF).filter((p) => p !== iri);
}

/** Direct named subclasses. */
export function getSubClasses(store: Store, iri: string): string[] {
  return uniq(
    store
      .getSubjects(RDFS_SUBCLASS_OF, iri, null)
      .filter(isNamed)
      .map((t) => t.value)
      .filter((s) => s !== iri),
  ).sort();
}

/** Classes with no named superclass (other than owl:Thing). */
export function getRootClasses(store: Store): string[] {
  const classes = new Set(listClasses(store));
  return [...classes].filter((c) => !getSuperClasses(store, c).some((p) => p !== OWL_THING && classes.has(p)));
}

/** All quads with the IRI as subject. */
export function quadsAbout(store: Store, iri: string): Quad[] {
  return store.getQuads(subjectTerm(iri), null, null, null);
}

/** All quads mentioning the IRI as object. */
export function quadsReferencing(store: Store, iri: string): Quad[] {
  return store.getQuads(null, null, iri, null);
}

function subjectTerm(iri: string): string {
  // N3 store accepts "_:x" strings for blank nodes and plain strings for IRIs
  return iri;
}

function isNamed(t: Term): boolean {
  return t.termType === "NamedNode";
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Open pull requests' source branches, if the pull_requests table exists. */
export function openPullRequestBranches(projectId: string): Set<string> {
  try {
    return new Set(
      all<{ source_branch: string }>(
        "SELECT source_branch FROM pull_requests WHERE project_id = ? AND status = 'open'",
        projectId,
      ).map((r) => r.source_branch),
    );
  } catch {
    return new Set();
  }
}
