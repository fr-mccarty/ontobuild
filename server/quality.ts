import type { Store, Term } from "n3";
import { NS } from "./rdf";

const RDF_TYPE = NS.rdf + "type";
const RDF_PROPERTY = NS.rdf + "Property";
const RDFS_LABEL = NS.rdfs + "label";
const RDFS_COMMENT = NS.rdfs + "comment";
const RDFS_SUBCLASS_OF = NS.rdfs + "subClassOf";
const RDFS_DOMAIN = NS.rdfs + "domain";
const RDFS_RANGE = NS.rdfs + "range";
const RDFS_CLASS = NS.rdfs + "Class";
const OWL_CLASS = NS.owl + "Class";
const OWL_THING = NS.owl + "Thing";
const OWL_OBJECT_PROPERTY = NS.owl + "ObjectProperty";
const OWL_DATATYPE_PROPERTY = NS.owl + "DatatypeProperty";
const OWL_ANNOTATION_PROPERTY = NS.owl + "AnnotationProperty";
const OWL_NAMED_INDIVIDUAL = NS.owl + "NamedIndividual";
const OWL_DEPRECATED = NS.owl + "deprecated";
const OWL_IMPORTS = NS.owl + "imports";

const CLASS_TYPES = [OWL_CLASS, RDFS_CLASS];
const PROPERTY_TYPES = [OWL_OBJECT_PROPERTY, OWL_DATATYPE_PROPERTY, OWL_ANNOTATION_PROPERTY, RDF_PROPERTY];
const TYPE_CHECKS: [string, string][] = [
  [OWL_CLASS, "class"],
  [RDFS_CLASS, "class"],
  [OWL_OBJECT_PROPERTY, "property"],
  [OWL_DATATYPE_PROPERTY, "property"],
  [OWL_ANNOTATION_PROPERTY, "property"],
  [RDF_PROPERTY, "property"],
  [OWL_NAMED_INDIVIDUAL, "individual"],
];

export type ConsistencyRuleId =
  | "orphan_class"
  | "cycle_detect"
  | "unused_property"
  | "missing_label"
  | "missing_comment"
  | "orphan_individual"
  | "empty_domain"
  | "empty_range"
  | "duplicate_label"
  | "deprecated_parent"
  | "dangling_ref"
  | "multi_root";

export interface ConsistencyIssue {
  rule_id: ConsistencyRuleId;
  severity: "error" | "warning" | "info";
  entity_iri: string;
  entity_type: string;
  message: string;
  details: Record<string, unknown> | null;
}

export interface ConsistencyCheckResult {
  project_id: string;
  branch: string;
  issues: ConsistencyIssue[];
  checked_at: string;
  duration_ms: number;
}

export interface DuplicateEntity {
  iri: string;
  label: string;
  entity_type: string;
}
export interface DuplicateCluster {
  entities: DuplicateEntity[];
  similarity: number;
}
export interface DuplicateDetectionResult {
  clusters: DuplicateCluster[];
  threshold: number;
  checked_at: string;
}

const isNamed = (t: Term) => t.termType === "NamedNode";
const isLiteral = (t: Term) => t.termType === "Literal";

function has(store: Store, s: string, p: string, o: string): boolean {
  return store.countQuads(s, p, o, null) > 0;
}

export function qualityEntityType(store: Store, iri: string): string {
  for (const [t, label] of TYPE_CHECKS) if (has(store, iri, RDF_TYPE, t)) return label;
  return "unknown";
}

function isDeprecated(store: Store, iri: string): boolean {
  return store.getObjects(iri, OWL_DEPRECATED, null).some((o) => ["true", "1"].includes(o.value.toLowerCase()));
}

function namedSubjects(store: Store, p: string | null, o: string | null): string[] {
  return [...new Set(store.getSubjects(p, o, null).filter(isNamed).map((t) => t.value))];
}

function classes(store: Store): string[] {
  const out = new Set<string>();
  for (const t of CLASS_TYPES) for (const s of namedSubjects(store, RDF_TYPE, t)) out.add(s);
  return [...out];
}

function declaredUris(store: Store): string[] {
  return namedSubjects(store, RDF_TYPE, null);
}

const ci = (
  rule_id: ConsistencyRuleId,
  severity: ConsistencyIssue["severity"],
  entity_iri: string,
  entity_type: string,
  message: string,
  details: Record<string, unknown> | null = null,
): ConsistencyIssue => ({ rule_id, severity, entity_iri, entity_type, message, details });

function namedParents(store: Store, cls: string): string[] {
  return store
    .getObjects(cls, RDFS_SUBCLASS_OF, null)
    .filter((p) => isNamed(p) && p.value !== OWL_THING)
    .map((p) => p.value);
}

const CHECKS: ((store: Store) => ConsistencyIssue[])[] = [
  (store) =>
    classes(store)
      .filter((c) => c !== OWL_THING)
      .filter(
        (c) =>
          namedParents(store, c).length === 0 &&
          store.countQuads(null, RDFS_SUBCLASS_OF, c, null) === 0 &&
          store.countQuads(null, RDF_TYPE, c, null) === 0,
      )
      .map((c) => ci("orphan_class", "warning", c, "class", "Orphan class: no parent, no children, no instances")),

  (store) => {
    const out: ConsistencyIssue[] = [];
    const reported = new Set<string>();
    for (const cls of classes(store)) {
      const path = new Set<string>();
      const finished = new Set<string>();
      const stack: [string, boolean][] = [[cls, false]];
      let found = false;
      while (stack.length && !found) {
        const [cur, backtrack] = stack.pop()!;
        if (backtrack) {
          path.delete(cur);
          continue;
        }
        if (path.has(cur)) {
          if (!reported.has(cur)) {
            out.push(ci("cycle_detect", "error", cur, "class", "Cycle detected in subClassOf hierarchy"));
            reported.add(cur);
          }
          found = true;
          continue;
        }
        if (finished.has(cur)) continue;
        path.add(cur);
        stack.push([cur, true]);
        for (const p of store.getObjects(cur, RDFS_SUBCLASS_OF, null)) if (isNamed(p)) stack.push([p.value, false]);
        finished.add(cur);
      }
    }
    return out;
  },

  (store) => {
    const out: ConsistencyIssue[] = [];
    for (const t of PROPERTY_TYPES) {
      for (const prop of namedSubjects(store, RDF_TYPE, t)) {
        const used = store.getSubjects(prop, null, null).some((s) => s.value !== prop || !isNamed(s));
        if (!used)
          out.push(ci("unused_property", "warning", prop, "property", "Property is declared but never used as a predicate"));
      }
    }
    return out;
  },

  (store) =>
    declaredUris(store)
      .filter((u) => u !== OWL_THING)
      .map((u) => [u, qualityEntityType(store, u)] as const)
      .filter(([u, t]) => t !== "unknown" && !store.getObjects(u, RDFS_LABEL, null).some(isLiteral))
      .map(([u, t]) => ci("missing_label", "warning", u, t, "Entity has no rdfs:label")),

  (store) =>
    declaredUris(store)
      .filter((u) => u !== OWL_THING)
      .map((u) => [u, qualityEntityType(store, u)] as const)
      .filter(([u, t]) => t !== "unknown" && !store.getObjects(u, RDFS_COMMENT, null).some(isLiteral))
      .map(([u, t]) => ci("missing_comment", "info", u, t, "Entity has no rdfs:comment")),

  (store) => {
    const out: ConsistencyIssue[] = [];
    const declared = new Set(classes(store));
    for (const ind of namedSubjects(store, RDF_TYPE, OWL_NAMED_INDIVIDUAL)) {
      for (const t of store.getObjects(ind, RDF_TYPE, null)) {
        if (!isNamed(t) || t.value === OWL_NAMED_INDIVIDUAL || declared.has(t.value)) continue;
        out.push(
          ci("orphan_individual", "warning", ind, "individual", `Individual's type ${t.value} is not declared as owl:Class`, {
            undeclared_type: t.value,
          }),
        );
      }
    }
    return out;
  },

  (store) => {
    const out: ConsistencyIssue[] = [];
    for (const t of [OWL_OBJECT_PROPERTY, OWL_DATATYPE_PROPERTY])
      for (const p of namedSubjects(store, RDF_TYPE, t))
        if (store.countQuads(p, RDFS_DOMAIN, null, null) === 0)
          out.push(ci("empty_domain", "info", p, "property", "Property has no rdfs:domain"));
    return out;
  },

  (store) => {
    const out: ConsistencyIssue[] = [];
    for (const t of [OWL_OBJECT_PROPERTY, OWL_DATATYPE_PROPERTY])
      for (const p of namedSubjects(store, RDF_TYPE, t))
        if (store.countQuads(p, RDFS_RANGE, null, null) === 0)
          out.push(ci("empty_range", "info", p, "property", "Property has no rdfs:range"));
    return out;
  },

  (store) => {
    const map = new Map<string, { etype: string; value: string; lang: string; iris: string[] }>();
    for (const u of declaredUris(store)) {
      if (u === OWL_THING) continue;
      const etype = qualityEntityType(store, u);
      if (etype === "unknown") continue;
      for (const o of store.getObjects(u, RDFS_LABEL, null)) {
        if (!isLiteral(o)) continue;
        const lang = (o as unknown as { language: string }).language || "";
        const key = `${etype}\u0000${o.value}\u0000${lang}`;
        if (!map.has(key)) map.set(key, { etype, value: o.value, lang, iris: [] });
        map.get(key)!.iris.push(u);
      }
    }
    const out: ConsistencyIssue[] = [];
    const reported = new Set<string>();
    for (const { etype, value, lang, iris } of map.values()) {
      if (iris.length < 2) continue;
      for (const iri of iris) {
        if (reported.has(iri)) continue;
        reported.add(iri);
        const langStr = lang ? `@${lang}` : "";
        out.push(
          ci(
            "duplicate_label",
            "warning",
            iri,
            etype,
            `Duplicate label "${value}"${langStr} shared with ${iris.length - 1} other ${etype}(s)`,
            { duplicates: iris.filter((i) => i !== iri) },
          ),
        );
      }
    }
    return out;
  },

  (store) => {
    const out: ConsistencyIssue[] = [];
    for (const cls of classes(store))
      for (const p of store.getObjects(cls, RDFS_SUBCLASS_OF, null))
        if (isNamed(p) && isDeprecated(store, p.value))
          out.push(
            ci("deprecated_parent", "warning", cls, "class", `Parent class ${p.value} is deprecated`, {
              deprecated_parent: p.value,
            }),
          );
    return out;
  },

  (store) => {
    const known = new Set([...declaredUris(store), ...namedSubjects(store, null, null)]);
    const external: string[] = [NS.rdf, NS.rdfs, NS.owl, NS.xsd, NS.skos, NS.dcterms];
    for (const q of store.getQuads(null, OWL_IMPORTS, null, null)) {
      if (!isNamed(q.object)) continue;
      let s = q.object.value;
      if (!s.endsWith("/") && !s.endsWith("#")) s += "/";
      external.push(s);
    }
    const out: ConsistencyIssue[] = [];
    const reported = new Set<string>();
    for (const pred of [RDFS_SUBCLASS_OF, RDFS_DOMAIN, RDFS_RANGE]) {
      for (const q of store.getQuads(null, pred, null, null)) {
        if (!isNamed(q.object) || q.object.value === OWL_THING || known.has(q.object.value)) continue;
        const o = q.object.value;
        if (external.some((ns) => o.startsWith(ns))) continue;
        const key = `${q.subject.value}\u0000${o}`;
        if (reported.has(key)) continue;
        reported.add(key);
        if (isNamed(q.subject)) {
          out.push(
            ci("dangling_ref", "error", q.subject.value, qualityEntityType(store, q.subject.value), `References undeclared entity ${o}`, {
              predicate: pred,
              dangling_target: o,
            }),
          );
        }
      }
    }
    return out;
  },

  (store) => {
    const roots = classes(store).filter((c) => c !== OWL_THING && namedParents(store, c).length === 0);
    if (roots.length <= 5) return [];
    return [
      ci("multi_root", "info", "", "ontology", `Ontology has ${roots.length} root classes (classes with no parent)`, {
        root_count: roots.length,
        root_iris: roots.slice(0, 20),
      }),
    ];
  },
];

export function runConsistencyCheck(store: Store, projectId: string, branch: string): ConsistencyCheckResult {
  const start = performance.now();
  const issues: ConsistencyIssue[] = [];
  for (const check of CHECKS) issues.push(...check(store));
  const duration = performance.now() - start;
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  issues.sort((a, b) => cmp(a.rule_id, b.rule_id) || cmp(a.entity_iri, b.entity_iri) || cmp(a.message, b.message));
  return {
    project_id: projectId,
    branch,
    issues,
    checked_at: new Date().toISOString(),
    duration_ms: Math.round(duration * 100) / 100,
  };
}

export function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    const padded = `  ${word} `;
    const chars = [...padded];
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(""));
  }
  return out;
}

export function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

class DisjointSet {
  private parent = new Map<string, string>();
  find(x: string): string {
    while ((this.parent.get(x) ?? x) !== x) {
      const p = this.parent.get(x)!;
      this.parent.set(x, this.parent.get(p) ?? p);
      x = this.parent.get(x)!;
    }
    return x;
  }
  union(x: string, y: string) {
    const px = this.find(x);
    const py = this.find(y);
    if (px !== py) this.parent.set(px, py);
  }
}

export function findDuplicates(
  store: Store,
  entities: { iri: string; entity_type: string }[],
  threshold = 0.85,
): DuplicateDetectionResult {
  const labelled: { iri: string; label: string; type: string; tri: Set<string> }[] = [];
  for (const e of entities) {
    const labels = store
      .getObjects(e.iri, RDFS_LABEL, null)
      .filter(isLiteral)
      .map((l) => ({ value: l.value, lang: (l as unknown as { language: string }).language || "" }))
      .sort((a, b) => {
        if (!a.lang !== !b.lang) return a.lang ? -1 : 1;
        return a.lang < b.lang ? -1 : a.lang > b.lang ? 1 : 0;
      });
    if (!labels.length) continue;
    labelled.push({ iri: e.iri, label: labels[0].value, type: e.entity_type, tri: trigrams(labels[0].value) });
  }

  const byType = new Map<string, number[]>();
  labelled.forEach((e, i) => {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push(i);
  });

  const pairSim = new Map<string, number>();
  const ds = new DisjointSet();
  const members = new Set<string>();
  for (const idxs of byType.values()) {
    const index = new Map<string, number[]>();
    for (const i of idxs) for (const t of labelled[i].tri) (index.get(t) ?? index.set(t, []).get(t)!).push(i);
    for (const i of idxs) {
      const a = labelled[i];
      const candidates = new Set<number>();
      for (const t of a.tri) for (const j of index.get(t) ?? []) if (j > i) candidates.add(j);
      for (const j of candidates) {
        const b = labelled[j];
        const sim = trigramSimilarity(a.tri, b.tri);
        if (sim < threshold) continue;
        pairSim.set(`${a.iri}\u0000${b.iri}`, sim);
        ds.union(a.iri, b.iri);
        members.add(a.iri);
        members.add(b.iri);
      }
    }
  }

  const info = new Map(labelled.map((e) => [e.iri, e]));
  const groups = new Map<string, string[]>();
  for (const iri of members) {
    const root = ds.find(iri);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(iri);
  }
  const clusters: DuplicateCluster[] = [];
  for (const iris of groups.values()) {
    if (iris.length < 2) continue;
    const sims: number[] = [];
    for (let i = 0; i < iris.length; i++)
      for (let j = i + 1; j < iris.length; j++) {
        const s = pairSim.get(`${iris[i]}\u0000${iris[j]}`) ?? pairSim.get(`${iris[j]}\u0000${iris[i]}`);
        if (s !== undefined) sims.push(s);
      }
    const avg = sims.length ? sims.reduce((x, y) => x + y, 0) / sims.length : threshold;
    clusters.push({
      entities: iris.map((iri) => ({ iri, label: info.get(iri)!.label, entity_type: info.get(iri)!.type })),
      similarity: Math.round(avg * 1000) / 1000,
    });
  }
  clusters.sort((a, b) => b.similarity - a.similarity);
  return { clusters, threshold, checked_at: new Date().toISOString() };
}

const INDEX_TYPE_MAP: [string, string][] = [
  [OWL_CLASS, "class"],
  [RDFS_CLASS, "class"],
  [OWL_OBJECT_PROPERTY, "object_property"],
  [OWL_DATATYPE_PROPERTY, "datatype_property"],
  [OWL_ANNOTATION_PROPERTY, "annotation_property"],
  [RDF_PROPERTY, "object_property"],
  [OWL_NAMED_INDIVIDUAL, "individual"],
];

export function indexedEntities(store: Store): { iri: string; entity_type: string }[] {
  const out = new Map<string, string>();
  for (const [t, type] of INDEX_TYPE_MAP)
    for (const s of namedSubjects(store, RDF_TYPE, t)) if (s !== OWL_THING && !out.has(s)) out.set(s, type);
  return [...out].map(([iri, entity_type]) => ({ iri, entity_type }));
}
