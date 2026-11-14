/**
 * Ontology editor endpoints: class tree (roots / children / ancestors), class detail,
 * class delete, entity search, index status / reindex, entity cross-references.
 *
 * Port of the ontology/* and entities/* parts of ontokit-api routes/projects.py and
 * routes/quality.py (references), services/ontology.py, ontology_index.py and
 * cross_reference_service.py. Instead of a PostgreSQL index everything is computed from
 * the N3 store cached per commit by server/ontology.ts; the "index" is a per-branch
 * entity count memo that is refreshed lazily (and by POST /reindex, as a background job).
 *
 * Property / individual details and form-based edits are handled client-side from the
 * Turtle source (GET/PUT /projects/:id/source, owned by routes/projects.ts).
 */
import { Hono, type Context } from "hono";
import { Store, type Term } from "n3";
import { httpError, noContent } from "../http";
import { nowIso, update } from "../db";
import { isJobActive, latestJob, startJob } from "../jobs";
import {
  NS,
  OWL_ANNOTATION_PROPERTY,
  OWL_CLASS,
  OWL_DATATYPE_PROPERTY,
  OWL_DEPRECATED,
  OWL_DISJOINT_WITH,
  OWL_EQUIVALENT_CLASS,
  OWL_NAMED_INDIVIDUAL,
  OWL_OBJECT_PROPERTY,
  OWL_THING,
  RDFS_CLASS,
  RDFS_COMMENT,
  RDFS_LABEL,
  RDFS_SUBCLASS_OF,
  RDF_PROPERTY,
  RDF_TYPE,
  commitOntology,
  getLiterals,
  getObjectIris,
  getPreferredLabel,
  getSuperClasses,
  hasType,
  invalidateOntologyCache,
  listClasses,
  listIndividuals,
  loadOntology,
  projectLabelPreferences,
  requireProject,
  resolveBranch,
  type LoadedOntology,
  type LocalizedString,
} from "../ontology";
import { serializeTurtle } from "../rdf";

const r = new Hono();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Local name as the old API computed it: after '#', else after the last '/'. */
function localName(iri: string): string {
  return iri.includes("#") ? iri.split("#").pop()! : iri.slice(iri.lastIndexOf("/") + 1);
}

function displayLabel(store: Store, iri: string, prefs: string[] | null): string {
  return getPreferredLabel(store, iri, prefs) || localName(iri);
}

function deprecated(store: Store, iri: string): boolean {
  return store
    .getObjects(iri, OWL_DEPRECATED, null)
    .some((t) => ["true", "1"].includes(t.value.toLowerCase()));
}

function isClass(store: Store, iri: string): boolean {
  return iri !== OWL_THING && (hasType(store, iri, OWL_CLASS) || hasType(store, iri, RDFS_CLASS));
}

/** Direct named subclasses that are declared classes. */
function childClasses(store: Store, iri: string): string[] {
  const out = new Set<string>();
  for (const s of store.getSubjects(RDFS_SUBCLASS_OF, iri, null)) {
    if (s.termType === "NamedNode" && s.value !== iri && isClass(store, s.value)) out.add(s.value);
  }
  return [...out];
}

interface TreeNode {
  iri: string;
  label: string;
  child_count: number;
  deprecated: boolean;
}

function treeNode(store: Store, iri: string, prefs: string[] | null): TreeNode {
  return {
    iri,
    label: displayLabel(store, iri, prefs),
    child_count: childClasses(store, iri).length,
    deprecated: deprecated(store, iri),
  };
}

function sortByLabel(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    const x = a.label.toLowerCase();
    const y = b.label.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** Decoded IRI path param (the frontend encodes it with encodeURIComponent). */
function iriParam(c: Context, name = "iri"): string {
  const raw = c.req.param(name) ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

interface Ctx {
  projectId: string;
  branch: string;
  prefs: string[] | null;
  onto: LoadedOntology;
  store: Store;
}

async function loadCtx(c: Context): Promise<Ctx> {
  const projectId = c.req.param("id")!;
  const project = requireProject(projectId);
  const branch = await resolveBranch(projectId, c.req.query("branch"));
  const onto = await loadOntology(projectId, branch);
  return { projectId, branch, prefs: projectLabelPreferences(project), onto, store: onto.store };
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

function rootClasses(store: Store): string[] {
  const classes = new Set(listClasses(store));
  return [...classes].filter(
    (c) => !getSuperClasses(store, c).some((p) => p !== OWL_THING && classes.has(p)),
  );
}

r.get("/projects/:id/ontology/tree", async (c) => {
  const { store, prefs } = await loadCtx(c);
  const nodes = sortByLabel(rootClasses(store).map((iri) => treeNode(store, iri, prefs)));
  return c.json({ nodes, total_classes: listClasses(store).length });
});

r.get("/projects/:id/ontology/tree/:iri{.+}/children", async (c) => {
  const { store, prefs } = await loadCtx(c);
  const iri = iriParam(c);
  const nodes = sortByLabel(childClasses(store, iri).map((i) => treeNode(store, i, prefs)));
  return c.json({ nodes, total_classes: listClasses(store).length });
});

r.get("/projects/:id/ontology/tree/:iri{.+}/ancestors", async (c) => {
  const { store, prefs } = await loadCtx(c);
  const iri = iriParam(c);
  const path: string[] = [];
  if (isClass(store, iri)) {
    const visited = new Set<string>();
    let current = iri;
    while (!visited.has(current)) {
      visited.add(current);
      const parents = getSuperClasses(store, current)
        .filter((p) => p !== OWL_THING)
        .sort();
      if (!parents.length) break;
      // Prefer a parent that is not already on the path (cycle guard)
      const parent = parents.find((p) => !visited.has(p)) ?? parents[0];
      if (visited.has(parent)) break;
      path.push(parent);
      current = parent;
    }
    path.reverse();
  }
  const nodes = path.map((i) => treeNode(store, i, prefs));
  return c.json({ nodes, total_classes: listClasses(store).length });
});

// ---------------------------------------------------------------------------
// Class detail / delete
// ---------------------------------------------------------------------------

/** Annotation properties shown in class details (label-like properties excluded). */
const ANNOTATION_PROPERTIES: [string, string][] = [
  ...[
    "contributor", "coverage", "creator", "date", "description", "format", "identifier",
    "language", "publisher", "relation", "rights", "source", "subject", "type",
  ].map((n): [string, string] => [`dc:${n}`, NS.dc + n]),
  ...[
    "contributor", "coverage", "created", "creator", "date", "description", "format",
    "identifier", "language", "modified", "publisher", "relation", "rights", "source",
    "subject", "type",
  ].map((n): [string, string] => [`dcterms:${n}`, NS.dcterms + n]),
  ...[
    "hiddenLabel", "definition", "notation", "example", "note", "scopeNote", "historyNote",
    "editorialNote", "changeNote",
  ].map((n): [string, string] => [`skos:${n}`, NS.skos + n]),
  ["rdfs:seeAlso", NS.rdfs + "seeAlso"],
  ["rdfs:isDefinedBy", NS.rdfs + "isDefinedBy"],
];

function classDetail(store: Store, iri: string, prefs: string[] | null) {
  const withDefaultLang = (xs: LocalizedString[]) => xs.map((l) => ({ value: l.value, lang: l.lang || "en" }));
  const parentIris = getObjectIris(store, iri, RDFS_SUBCLASS_OF);
  const parentLabels: Record<string, string> = {};
  for (const p of parentIris) parentLabels[p] = displayLabel(store, p, prefs);

  const annotations: { property_iri: string; property_label: string; values: LocalizedString[] }[] = [];
  for (const [label, prop] of ANNOTATION_PROPERTIES) {
    const values: LocalizedString[] = [];
    for (const o of store.getObjects(iri, prop, null)) {
      if (o.termType === "Literal") values.push({ value: o.value, lang: (o as Term & { language: string }).language || "" });
      else if (o.termType === "NamedNode") values.push({ value: o.value, lang: "" });
    }
    if (values.length) annotations.push({ property_iri: prop, property_label: label, values });
  }

  const instances = new Set(
    store.getSubjects(RDF_TYPE, iri, null).filter((s) => s.termType === "NamedNode").map((s) => s.value),
  );

  return {
    iri,
    labels: withDefaultLang(getLiterals(store, iri, RDFS_LABEL)),
    comments: withDefaultLang(getLiterals(store, iri, RDFS_COMMENT)),
    deprecated: deprecated(store, iri),
    parent_iris: parentIris,
    parent_labels: parentLabels,
    equivalent_iris: getObjectIris(store, iri, OWL_EQUIVALENT_CLASS),
    disjoint_iris: getObjectIris(store, iri, OWL_DISJOINT_WITH),
    child_count: childClasses(store, iri).length,
    instance_count: instances.size,
    is_defined: true,
    source_ontology: null,
    annotations,
  };
}

r.get("/projects/:id/ontology/classes/:iri{.+}", async (c) => {
  const { store, prefs } = await loadCtx(c);
  const iri = iriParam(c);
  if (!isClass(store, iri)) httpError(404, `Class not found: ${iri}`);
  return c.json(classDetail(store, iri, prefs));
});

/**
 * Delete a class: removes every triple about it, every triple pointing at it from a
 * named subject, and whole anonymous class expressions (restrictions, unions, ...)
 * that mention it. Subclasses lose that parent (and become roots if it was the only one).
 */
r.delete("/projects/:id/ontology/classes/:iri{.+}", async (c) => {
  const { projectId, branch, onto, store: shared } = await loadCtx(c);
  const iri = iriParam(c);
  if (!isClass(shared, iri)) httpError(404, `Class not found: ${iri}`);
  const message = c.req.query("commit_message") || `Delete class ${localName(iri)}`;
  if (message.length > 500) httpError(422, "commit_message must be at most 500 characters");

  const store = new Store(shared.getQuads(null, null, null, null));

  const removeBnodeClosure = (bnode: Term, seen = new Set<string>()) => {
    if (seen.has(bnode.value)) return;
    seen.add(bnode.value);
    for (const q of store.getQuads(bnode, null, null, null)) {
      store.removeQuad(q);
      if (q.object.termType === "BlankNode") removeBnodeClosure(q.object, seen);
    }
  };
  /** Remove the anonymous expression containing `bnode` up to its named owner. */
  const removeExpression = (bnode: Term) => {
    let top = bnode;
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(top.value)) break;
      seen.add(top.value);
      const up = store.getQuads(null, null, top, null);
      const bnodeOwner = up.find((q) => q.subject.termType === "BlankNode");
      if (!bnodeOwner) {
        for (const q of up) store.removeQuad(q);
        break;
      }
      top = bnodeOwner.subject;
    }
    removeBnodeClosure(top);
  };

  for (const q of store.getQuads(iri, null, null, null)) {
    store.removeQuad(q);
    if (q.object.termType === "BlankNode" && store.countQuads(null, null, q.object, null) === 0) {
      removeBnodeClosure(q.object);
    }
  }
  for (const q of store.getQuads(null, null, iri, null)) {
    if (q.subject.termType === "BlankNode") removeExpression(q.subject);
    else store.removeQuad(q);
  }

  const content = await serializeTurtle(store, onto.prefixes);
  await commitOntology({ projectId, branch, content, message, origin: "editor" });
  update("projects", { updated_at: nowIso() }, { id: projectId });
  return noContent(c);
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const SEARCH_LABEL_PROPS = [
  RDFS_LABEL,
  NS.skos + "prefLabel",
  NS.skos + "altLabel",
  NS.dcterms + "title",
  NS.dc + "title",
];

type EntityKind = "class" | "property" | "individual";
type PropertyKind = "object" | "data" | "annotation" | null;

/** Every entity with its search type (first matching type wins, like the old index). */
function allEntities(store: Store): Map<string, { type: EntityKind; kind: PropertyKind }> {
  const out = new Map<string, { type: EntityKind; kind: PropertyKind }>();
  const add = (iris: Iterable<string>, type: EntityKind, kind: PropertyKind = null) => {
    for (const i of iris) if (i !== OWL_THING && !out.has(i)) out.set(i, { type, kind });
  };
  const subjectsOf = (t: string) =>
    store.getSubjects(RDF_TYPE, t, null).filter((s) => s.termType === "NamedNode").map((s) => s.value);
  add(subjectsOf(OWL_CLASS), "class");
  add(subjectsOf(RDFS_CLASS), "class");
  add(subjectsOf(OWL_OBJECT_PROPERTY), "property", "object");
  add(subjectsOf(OWL_DATATYPE_PROPERTY), "property", "data");
  add(subjectsOf(OWL_ANNOTATION_PROPERTY), "property", "annotation");
  add(subjectsOf(RDF_PROPERTY), "property", "object");
  add(subjectsOf(OWL_NAMED_INDIVIDUAL), "individual");
  add(listIndividuals(store), "individual");
  return out;
}

r.get("/projects/:id/ontology/search", async (c) => {
  const q = c.req.query("q");
  if (!q || q.length < 1) httpError(422, "Query parameter 'q' is required");
  if (q.length > 200) httpError(422, "Query parameter 'q' must be at most 200 characters");
  const { store, prefs } = await loadCtx(c);
  const typesParam = c.req.query("entity_types");
  const allowed = new Set(
    typesParam ? typesParam.split(",").map((t) => t.trim()).filter(Boolean) : ["class", "property", "individual"],
  );
  const needle = q.toLowerCase();

  const results: {
    iri: string;
    label: string;
    entity_type: EntityKind;
    property_kind: PropertyKind;
    deprecated: boolean;
  }[] = [];
  for (const [iri, { type, kind }] of allEntities(store)) {
    if (!allowed.has(type)) continue;
    if (needle !== "*") {
      const matched =
        localName(iri).toLowerCase().includes(needle) ||
        iri.toLowerCase().includes(needle) ||
        SEARCH_LABEL_PROPS.some((p) =>
          store.getObjects(iri, p, null).some((o) => o.termType === "Literal" && o.value.toLowerCase().includes(needle)),
        );
      if (!matched) continue;
    }
    results.push({
      iri,
      label: displayLabel(store, iri, prefs),
      entity_type: type,
      property_kind: kind,
      deprecated: deprecated(store, iri),
    });
  }
  const key = (r: { label: string }) => [needle !== "*" && r.label.toLowerCase().startsWith(needle) ? 0 : 1, r.label.toLowerCase()] as const;
  results.sort((a, b) => {
    const [pa, la] = key(a);
    const [pb, lb] = key(b);
    return pa - pb || (la < lb ? -1 : la > lb ? 1 : 0);
  });
  return c.json({ results: results.slice(0, 50), total: results.length });
});

// ---------------------------------------------------------------------------
// Index status / reindex (no separate index: memo of entity count per commit)
// ---------------------------------------------------------------------------

const INDEX_JOB = "ontology_index";

interface IndexMemo {
  commit_hash: string;
  entity_count: number;
  indexed_at: string;
}
const memoG = globalThis as typeof globalThis & { __ontokitIndexMemo?: Map<string, IndexMemo> };
const indexMemo: Map<string, IndexMemo> = (memoG.__ontokitIndexMemo ??= new Map());

function indexEntities(onto: LoadedOntology): IndexMemo {
  const memo = {
    commit_hash: onto.commitHash,
    entity_count: allEntities(onto.store).size,
    indexed_at: nowIso(),
  };
  indexMemo.set(`${onto.projectId}:${onto.ref}`, memo);
  return memo;
}

r.get("/projects/:id/ontology/index-status", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const branch = await resolveBranch(projectId, c.req.query("branch"));
  const base = { project_id: projectId, branch };
  const memo = indexMemo.get(`${projectId}:${branch}`);

  if (isJobActive(INDEX_JOB, projectId, branch)) {
    return c.json({
      ...base,
      status: "indexing",
      entity_count: memo?.entity_count ?? null,
      indexed_at: memo?.indexed_at ?? null,
      commit_hash: memo?.commit_hash ?? null,
      error_message: null,
    });
  }

  let onto: LoadedOntology;
  try {
    onto = await loadOntology(projectId, branch);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404) httpError(404, "No index status found for this project and branch");
    const job = latestJob(INDEX_JOB, projectId, branch);
    return c.json({
      ...base,
      status: "failed",
      entity_count: null,
      indexed_at: job?.finished_at ?? null,
      commit_hash: null,
      error_message: (e as { detail?: string }).detail ?? (e as Error).message,
    });
  }
  const current = memo && memo.commit_hash === onto.commitHash ? memo : indexEntities(onto);
  return c.json({ ...base, status: "ready", ...current, error_message: null });
});

r.post("/projects/:id/ontology/reindex", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const branch = await resolveBranch(projectId, c.req.query("branch"));
  if (!isJobActive(INDEX_JOB, projectId, branch)) {
    startJob(INDEX_JOB, { projectId, branch }, async () => {
      invalidateOntologyCache(projectId);
      const onto = await loadOntology(projectId, branch);
      return indexEntities(onto);
    });
  }
  return c.json({ status: "accepted", branch }, 202);
});

// ---------------------------------------------------------------------------
// Cross-references (port of services/cross_reference_service.py)
// ---------------------------------------------------------------------------

const PREDICATE_CONTEXT: Record<string, string> = {
  [RDFS_SUBCLASS_OF]: "parent_iris",
  [NS.rdfs + "domain"]: "domain_iris",
  [NS.rdfs + "range"]: "range_iris",
  [RDF_TYPE]: "type_iris",
  [OWL_EQUIVALENT_CLASS]: "equivalent_iris",
  [OWL_DISJOINT_WITH]: "disjoint_iris",
  [NS.owl + "someValuesFrom"]: "some_values_from",
  [NS.rdfs + "seeAlso"]: "see_also",
  [NS.owl + "inverseOf"]: "inverse_of",
};

const CONTEXT_LABELS: Record<string, string> = {
  parent_iris: "As parent class",
  domain_iris: "As property domain",
  range_iris: "As property range",
  type_iris: "As instance type",
  equivalent_iris: "As equivalent class",
  disjoint_iris: "As disjoint class",
  some_values_from: "In restriction (someValuesFrom)",
  annotation_value: "As annotation value",
  see_also: "Referenced via seeAlso",
  inverse_of: "As inverse property",
};

const TYPE_CHECKS: [string, string][] = [
  [OWL_CLASS, "class"],
  [RDFS_CLASS, "class"],
  [OWL_OBJECT_PROPERTY, "property"],
  [OWL_DATATYPE_PROPERTY, "property"],
  [OWL_ANNOTATION_PROPERTY, "property"],
  [RDF_PROPERTY, "property"],
  [OWL_NAMED_INDIVIDUAL, "individual"],
];

function rdfEntityType(store: Store, iri: string): string {
  for (const [t, label] of TYPE_CHECKS) if (hasType(store, iri, t)) return label;
  return "unknown";
}

function bnodeOwners(store: Store, bnode: Term): string[] {
  const owners: string[] = [];
  const visited = new Set<string>();
  const stack = [bnode];
  while (stack.length) {
    const node = stack.pop()!;
    if (visited.has(node.value)) continue;
    visited.add(node.value);
    for (const s of store.getSubjects(null, node, null)) {
      if (s.termType === "NamedNode") owners.push(s.value);
      else if (s.termType === "BlankNode") stack.push(s);
    }
  }
  return owners;
}

r.get("/projects/:id/entities/:iri{.+}/references", async (c) => {
  const { store } = await loadCtx(c);
  const target = iriParam(c);
  const byContext = new Map<string, Map<string, Record<string, unknown>>>();

  for (const q of store.getQuads(null, null, target, null)) {
    let sources: string[];
    if (q.subject.termType === "NamedNode") sources = [q.subject.value];
    else if (q.subject.termType === "BlankNode") {
      sources = bnodeOwners(store, q.subject);
      if (!sources.length) continue;
    } else continue;

    let context = PREDICATE_CONTEXT[q.predicate.value];
    if (!context) {
      if (hasType(store, q.predicate.value, OWL_ANNOTATION_PROPERTY)) context = "annotation_value";
      else continue;
    }
    let seen = byContext.get(context);
    if (!seen) byContext.set(context, (seen = new Map()));
    for (const s of sources) {
      if (seen.has(s)) continue;
      const label = store.getObjects(s, RDFS_LABEL, null).find((o) => o.termType === "Literal");
      seen.set(s, {
        source_iri: s,
        source_type: rdfEntityType(store, s),
        source_label: label ? label.value : null,
        reference_context: context,
      });
    }
  }

  let total = 0;
  const groups = [...byContext].map(([context, refs]) => {
    total += refs.size;
    return { context, context_label: CONTEXT_LABELS[context] ?? context, references: [...refs.values()] };
  });
  return c.json({ target_iri: target, total, groups });
});

export default r;
