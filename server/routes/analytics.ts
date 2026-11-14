/**
 * Analytics: entity change events (activity, contributors, hot entities, entity history).
 * Port of ontokit-api/ontokit/{models/change_event.py, services/change_event_service.py,
 * api/routes/analytics.py}.
 *
 * Events are derived like the old service did on source saves: the ontology at the parent
 * commit is compared with the new commit at the entity level (created / deleted entities,
 * label / parent / deprecation / comment / other changes). Here this runs for every
 * "commit" ontology event that has a parent, except merges (whose changes were already
 * recorded on the source branch) and imports.
 */
import { Hono } from "hono";
import type { Store, Term } from "n3";
import { all, get, insert, newId, nowIso, toJson, fromJson, transaction } from "../db";
import { queryInt } from "../http";
import { LOCAL_USER } from "../user";
import {
  NS,
  RDF_TYPE,
  RDFS_COMMENT,
  RDFS_LABEL,
  RDFS_SUBCLASS_OF,
  RDFS_SUBPROPERTY_OF,
  getLiterals,
  getObjectIris,
  getPreferredLabel,
  isDeprecated,
  loadOntology,
  onOntologyEvent,
  projectLabelPreferences,
  requireProject,
  type OntologyEvent,
} from "../ontology";

const r = new Hono();

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/** Same order as ontokit-api services/rdf_utils.py _TYPE_CHECKS. */
const TYPE_CHECKS: [string, string][] = [
  [NS.owl + "Class", "class"],
  [NS.rdfs + "Class", "class"],
  [NS.owl + "ObjectProperty", "property"],
  [NS.owl + "DatatypeProperty", "property"],
  [NS.owl + "AnnotationProperty", "property"],
  [NS.rdf + "Property", "property"],
  [NS.owl + "NamedIndividual", "individual"],
];
const OWL_THING = NS.owl + "Thing";

function declaredEntities(store: Store): Map<string, string> {
  const out = new Map<string, string>();
  for (const [typeIri, label] of TYPE_CHECKS) {
    for (const s of store.getSubjects(RDF_TYPE, typeIri, null)) {
      if (s.termType !== "NamedNode" || s.value === OWL_THING || out.has(s.value)) continue;
      out.set(s.value, label);
    }
  }
  return out;
}

const sortedEq = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
};

/** Stable signature of a term; blank nodes are expanded (their ids differ between parses). */
function termSig(store: Store, t: Term, depth = 0): string {
  if (t.termType === "BlankNode") {
    if (depth > 8) return "[]";
    const inner = store
      .getQuads(t, null, null, null)
      .map((q) => `${q.predicate.value} ${termSig(store, q.object, depth + 1)}`)
      .sort();
    return `[${inner.join(";")}]`;
  }
  if (t.termType === "Literal") {
    const l = t as unknown as { language: string; datatype?: { value: string } };
    return JSON.stringify(t.value) + (l.language ? "@" + l.language : l.datatype ? "^^" + l.datatype.value : "");
  }
  return `<${t.value}>`;
}

function tripleSigs(store: Store, iri: string): string[] {
  return store.getQuads(iri, null, null, null).map((q) => `${q.predicate.value} ${termSig(store, q.object)}`);
}

export interface EntityChange {
  entity_iri: string;
  entity_type: string;
  event_type: "create" | "update" | "delete" | "rename" | "reparent" | "deprecate";
  changed_fields: string[];
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

/** Entity-level diff of two ontology stores (port of record_events_from_diff). */
export function diffEntities(oldStore: Store | null, newStore: Store): EntityChange[] {
  const oldEntities = oldStore ? declaredEntities(oldStore) : new Map<string, string>();
  const newEntities = declaredEntities(newStore);
  const changes: EntityChange[] = [];

  for (const [iri, etype] of newEntities) {
    if (!oldEntities.has(iri))
      changes.push({ entity_iri: iri, entity_type: etype, event_type: "create", changed_fields: [], old_values: null, new_values: null });
  }
  for (const [iri, etype] of oldEntities) {
    if (!newEntities.has(iri))
      changes.push({ entity_iri: iri, entity_type: etype, event_type: "delete", changed_fields: [], old_values: null, new_values: null });
  }
  if (!oldStore) return changes;

  for (const [iri, etype] of newEntities) {
    if (!oldEntities.has(iri)) continue;
    const changed: string[] = [];
    const oldVals: Record<string, unknown> = {};
    const newVals: Record<string, unknown> = {};

    const oldLabels = getLiterals(oldStore, iri, RDFS_LABEL).map((l) => l.value);
    const newLabels = getLiterals(newStore, iri, RDFS_LABEL).map((l) => l.value);
    if (!sortedEq(oldLabels, newLabels)) {
      changed.push("labels");
      oldVals.labels = oldLabels;
      newVals.labels = newLabels;
    }

    const parentPred = etype === "property" ? RDFS_SUBPROPERTY_OF : RDFS_SUBCLASS_OF;
    const oldParents = getObjectIris(oldStore, iri, parentPred);
    const newParents = getObjectIris(newStore, iri, parentPred);
    if (!sortedEq(oldParents, newParents)) {
      changed.push("parents");
      oldVals.parents = oldParents;
      newVals.parents = newParents;
    }

    const oldDep = isDeprecated(oldStore, iri);
    const newDep = isDeprecated(newStore, iri);
    if (oldDep !== newDep) {
      changed.push("deprecated");
      oldVals.deprecated = oldDep;
      newVals.deprecated = newDep;
    }

    const oldComments = getLiterals(oldStore, iri, RDFS_COMMENT).map((l) => l.value);
    const newComments = getLiterals(newStore, iri, RDFS_COMMENT).map((l) => l.value);
    if (!sortedEq(oldComments, newComments)) changed.push("comments");

    if (changed.length === 0 && !sortedEq(tripleSigs(oldStore, iri), tripleSigs(newStore, iri))) changed.push("other");
    if (changed.length === 0) continue;

    let eventType: EntityChange["event_type"] = "update";
    if (changed.length === 1 && changed[0] === "labels") eventType = "rename";
    else if (changed.length === 1 && changed[0] === "parents") eventType = "reparent";
    else if (changed.includes("deprecated")) eventType = "deprecate";

    changes.push({
      entity_iri: iri,
      entity_type: etype,
      event_type: eventType,
      changed_fields: changed,
      old_values: Object.keys(oldVals).length ? oldVals : null,
      new_values: Object.keys(newVals).length ? newVals : null,
    });
  }
  return changes;
}

/** Store change events for a commit (diffing parent vs. new commit). Returns the count. */
export async function recordCommitChangeEvents(e: Extract<OntologyEvent, { type: "commit" }>): Promise<number> {
  if (!e.parentHash || e.parentHash === e.commitHash) return 0;
  if (e.origin === "merge" || e.origin === "import") return 0;
  let oldStore: Store | null = null;
  try {
    oldStore = (await loadOntology(e.projectId, e.parentHash)).store;
  } catch {
    oldStore = null; // parent had no (parseable) ontology file
  }
  const newStore = (await loadOntology(e.projectId, e.commitHash)).store;
  const changes = diffEntities(oldStore, newStore);
  if (!changes.length) return 0;
  const createdAt = nowIso();
  transaction(() => {
    for (const ch of changes) {
      insert("entity_change_events", {
        id: newId(),
        project_id: e.projectId,
        branch: e.branch,
        entity_iri: ch.entity_iri,
        entity_type: ch.entity_type,
        event_type: ch.event_type,
        user_id: LOCAL_USER.id,
        user_name: LOCAL_USER.name,
        commit_hash: e.commitHash,
        changed_fields: toJson(ch.changed_fields),
        old_values: toJson(ch.old_values),
        new_values: toJson(ch.new_values),
        created_at: createdAt,
      });
    }
  });
  return changes.length;
}

onOntologyEvent("analytics:change-events", async (e) => {
  if (e.type === "commit") await recordCommitChangeEvents(e);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface EventRow {
  id: string;
  project_id: string;
  branch: string;
  entity_iri: string;
  entity_type: string;
  event_type: string;
  user_id: string;
  user_name: string | null;
  commit_hash: string | null;
  changed_fields: string | null;
  old_values: string | null;
  new_values: string | null;
  created_at: string;
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

r.get("/projects/:id/analytics/activity", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const days = queryInt(c, "days", 30, { min: 1, max: 365 });
  const cutoff = cutoffIso(days);
  const daily = all<{ day: string; cnt: number }>(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS cnt FROM entity_change_events
     WHERE project_id = ? AND created_at >= ? GROUP BY day ORDER BY day`,
    id,
    cutoff,
  );
  const total = Number(
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM entity_change_events WHERE project_id = ? AND created_at >= ?",
      id,
      cutoff,
    )!.n,
  );
  const editors = all<{ user_id: string; user_name: string | null; cnt: number }>(
    `SELECT user_id, user_name, COUNT(*) AS cnt FROM entity_change_events
     WHERE project_id = ? AND created_at >= ? GROUP BY user_id, user_name ORDER BY cnt DESC LIMIT 10`,
    id,
    cutoff,
  );
  return c.json({
    daily_counts: daily.map((d) => ({ date: d.day, count: Number(d.cnt) })),
    total_events: total,
    top_editors: editors.map((e) => ({ user_id: e.user_id, user_name: e.user_name ?? "", edit_count: Number(e.cnt) })),
  });
});

r.get("/projects/:id/analytics/entity/:iri{.+}/history", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  let iri = c.req.param("iri");
  // The old API unquoted the (already decoded) path once more.
  if (/%[0-9A-Fa-f]{2}/.test(iri)) {
    try {
      iri = decodeURIComponent(iri);
    } catch {
      /* keep as is */
    }
  }
  const branch = c.req.query("branch") || null;
  const limit = queryInt(c, "limit", 50, { min: 1, max: 200 });
  const where = branch ? "project_id = ? AND entity_iri = ? AND branch = ?" : "project_id = ? AND entity_iri = ?";
  const params = branch ? [id, iri, branch] : [id, iri];
  const rows = all<EventRow>(
    `SELECT * FROM entity_change_events WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    ...params,
    limit,
  );
  const total = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM entity_change_events WHERE ${where}`, ...params)!.n);
  return c.json({
    entity_iri: iri,
    events: rows.map((row) => ({
      id: row.id,
      project_id: row.project_id,
      branch: row.branch,
      entity_iri: row.entity_iri,
      entity_type: row.entity_type,
      event_type: row.event_type,
      user_id: row.user_id,
      user_name: row.user_name,
      commit_hash: row.commit_hash,
      changed_fields: fromJson<string[]>(row.changed_fields, []),
      old_values: fromJson<Record<string, unknown> | null>(row.old_values, null),
      new_values: fromJson<Record<string, unknown> | null>(row.new_values, null),
      created_at: row.created_at,
    })),
    total,
  });
});

r.get("/projects/:id/analytics/hot-entities", async (c) => {
  const id = c.req.param("id");
  const project = requireProject(id);
  const limit = queryInt(c, "limit", 20, { min: 1, max: 100 });
  const rows = all<{
    entity_iri: string;
    entity_type: string;
    edit_count: number;
    editor_count: number;
    last_edited_at: string;
  }>(
    `SELECT entity_iri, entity_type, COUNT(*) AS edit_count, COUNT(DISTINCT user_id) AS editor_count,
            MAX(created_at) AS last_edited_at
     FROM entity_change_events WHERE project_id = ? AND created_at >= ?
     GROUP BY entity_iri, entity_type ORDER BY edit_count DESC, last_edited_at DESC LIMIT ?`,
    id,
    cutoffIso(30),
    limit,
  );
  // Resolve labels from the default branch when possible (the old API returned null).
  let store: Store | null = null;
  if (rows.length) {
    try {
      store = (await loadOntology(id)).store;
    } catch {
      store = null;
    }
  }
  const prefs = projectLabelPreferences(project);
  return c.json(
    rows.map((row) => ({
      entity_iri: row.entity_iri,
      entity_type: row.entity_type,
      label: store ? getPreferredLabel(store, row.entity_iri, prefs) : null,
      edit_count: Number(row.edit_count),
      editor_count: Number(row.editor_count),
      last_edited_at: row.last_edited_at,
    })),
  );
});

r.get("/projects/:id/analytics/contributors", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const days = queryInt(c, "days", 30, { min: 1, max: 365 });
  const rows = all<{
    user_id: string;
    user_name: string | null;
    create_count: number;
    update_count: number;
    delete_count: number;
    total_count: number;
    last_active_at: string;
  }>(
    `SELECT user_id, user_name,
            SUM(CASE WHEN event_type = 'create' THEN 1 ELSE 0 END) AS create_count,
            SUM(CASE WHEN event_type IN ('update', 'rename', 'reparent', 'deprecate') THEN 1 ELSE 0 END) AS update_count,
            SUM(CASE WHEN event_type = 'delete' THEN 1 ELSE 0 END) AS delete_count,
            COUNT(*) AS total_count,
            MAX(created_at) AS last_active_at
     FROM entity_change_events WHERE project_id = ? AND created_at >= ?
     GROUP BY user_id, user_name ORDER BY total_count DESC`,
    id,
    cutoffIso(days),
  );
  return c.json(
    rows.map((row) => ({
      user_id: row.user_id,
      user_name: row.user_name ?? "",
      create_count: Number(row.create_count),
      update_count: Number(row.update_count),
      delete_count: Number(row.delete_count),
      total_count: Number(row.total_count),
      last_active_at: row.last_active_at,
    })),
  );
});

export default r;
