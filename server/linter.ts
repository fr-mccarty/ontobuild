import type { Quad, Store, Term } from "n3";
import { NS } from "./rdf";
import { isRule } from "./rulesVocabulary";

export type LintSeverity = "error" | "warning" | "info";
export type LintSubjectType = "class" | "property" | "individual" | "other";

export interface LintResult {
  issue_type: LintSeverity;
  rule_id: string;
  message: string;
  subject_iri: string | null;
  subject_type: LintSubjectType | null;
  details: Record<string, unknown> | null;
}

export interface LintRuleInfo {
  rule_id: string;
  name: string;
  description: string;
  severity: LintSeverity;
  scope: string[];
}

const ALL = ["class", "property", "individual"];

export const LINT_RULES: LintRuleInfo[] = [
  { rule_id: "missing-label", name: "Missing Label", description: "Resources should have at least one rdfs:label annotation", severity: "warning", scope: ALL },
  { rule_id: "missing-comment", name: "Missing Comment", description: "Resources should have a description via rdfs:comment", severity: "info", scope: ALL },
  { rule_id: "orphan-class", name: "Orphan Class", description: "Classes with no parent (other than owl:Thing) and no children may be misplaced", severity: "warning", scope: ["class"] },
  { rule_id: "undefined-parent", name: "Undefined Parent", description: "Class references a parent that is not defined in the ontology", severity: "error", scope: ["class"] },
  { rule_id: "circular-hierarchy", name: "Circular Hierarchy", description: "Circular inheritance detected in class hierarchy", severity: "error", scope: ["class"] },
  { rule_id: "empty-label", name: "Empty Label", description: "Resource has a label that is an empty string", severity: "warning", scope: ALL },
  { rule_id: "duplicate-label", name: "Duplicate Label", description: "Multiple resources share the same label, which may cause confusion", severity: "warning", scope: ALL },
  { rule_id: "undefined-prefix", name: "Undefined Prefix", description: "IRI uses a prefix that is not defined in the namespace bindings", severity: "error", scope: ALL },
  { rule_id: "duplicate-triple", name: "Duplicate Triple", description: "Same predicate-object pair appears multiple times for the same subject", severity: "info", scope: ALL },
  { rule_id: "domain-violation", name: "Domain Violation", description: "Property used on a subject that is not in its declared domain", severity: "warning", scope: ALL },
  { rule_id: "range-violation", name: "Range Violation", description: "Property value is not in the declared range", severity: "warning", scope: ALL },
  { rule_id: "cardinality-violation", name: "Cardinality Violation", description: "Property usage violates declared cardinality constraints", severity: "error", scope: ["individual"] },
  { rule_id: "disjoint-violation", name: "Disjoint Class Violation", description: "Resource is typed with classes declared as disjoint", severity: "error", scope: ["individual"] },
  { rule_id: "inverse-property-inconsistency", name: "Inverse Property Inconsistency", description: "Inverse property relationship is not symmetric", severity: "warning", scope: ["individual"] },
  { rule_id: "missing-type-declaration", name: "Missing Type Declaration", description: "Resource has no rdf:type declaration (not declared as class, property, or individual)", severity: "warning", scope: ALL },
];

const L1 = ["undefined-parent", "circular-hierarchy", "undefined-prefix"];
const L2 = [...L1, "orphan-class", "duplicate-triple", "disjoint-violation", "missing-type-declaration"];
const L3 = [...L2, "missing-label", "empty-label", "duplicate-label"];
const L4 = [...L3, "missing-comment"];
const L5 = LINT_RULES.map((r) => r.rule_id);

export const LINT_LEVELS: Record<number, ReadonlySet<string>> = {
  1: new Set(L1),
  2: new Set(L2),
  3: new Set(L3),
  4: new Set(L4),
  5: new Set(L5),
};

export const ALL_RULE_IDS: ReadonlySet<string> = LINT_LEVELS[5];

export const REMOVED_RULE_IDS: ReadonlySet<string> = new Set([
  "label-per-language",
  "missing-english-label",
  "missing-language-tag",
  "redundant-regional-label",
]);

export const LINT_LEVEL_DEFINITIONS: Record<number, { name: string; description: string; rules: ReadonlySet<string> }> = {
  1: { name: "Critical", description: "Undefined parents, circular hierarchies, undefined prefixes", rules: LINT_LEVELS[1] },
  2: { name: "Consistency", description: "Orphan classes, duplicate triples, and disjointness violations", rules: LINT_LEVELS[2] },
  3: { name: "Labels", description: "Missing, empty, and duplicate label checks", rules: LINT_LEVELS[3] },
  4: { name: "Quality", description: "Missing comment checks", rules: LINT_LEVELS[4] },
  5: { name: "All", description: "All available rules including domain/range and cardinality", rules: LINT_LEVELS[5] },
};

export function getRulesForLevel(level: number): ReadonlySet<string> {
  if (level < 1 || level > 5) throw new Error(`Lint level must be between 1 and 5, got ${level}`);
  return LINT_LEVELS[level];
}

export function getAvailableRules(): LintRuleInfo[] {
  return [...LINT_RULES];
}

const RDF_TYPE = NS.rdf + "type";
const RDF_FIRST = NS.rdf + "first";
const RDF_REST = NS.rdf + "rest";
const RDF_NIL = NS.rdf + "nil";
const RDF_PROPERTY = NS.rdf + "Property";
const RDFS_LABEL = NS.rdfs + "label";
const RDFS_COMMENT = NS.rdfs + "comment";
const RDFS_SUBCLASS_OF = NS.rdfs + "subClassOf";
const RDFS_DOMAIN = NS.rdfs + "domain";
const RDFS_RANGE = NS.rdfs + "range";
const RDFS_CLASS = NS.rdfs + "Class";
const OWL_CLASS = NS.owl + "Class";
const OWL_THING = NS.owl + "Thing";
const OWL_ONTOLOGY = NS.owl + "Ontology";
const OWL_OBJECT_PROPERTY = NS.owl + "ObjectProperty";
const OWL_DATATYPE_PROPERTY = NS.owl + "DatatypeProperty";
const OWL_ANNOTATION_PROPERTY = NS.owl + "AnnotationProperty";
const OWL_RESTRICTION = NS.owl + "Restriction";
const OWL_ON_PROPERTY = NS.owl + "onProperty";
const OWL_MAX_CARD = NS.owl + "maxCardinality";
const OWL_MIN_CARD = NS.owl + "minCardinality";
const OWL_CARD = NS.owl + "cardinality";
const OWL_ALL_DISJOINT = NS.owl + "AllDisjointClasses";
const OWL_MEMBERS = NS.owl + "members";
const OWL_DISJOINT_WITH = NS.owl + "disjointWith";
const OWL_INVERSE_OF = NS.owl + "inverseOf";
const XSD_STRING = NS.xsd + "string";

const DEFAULT_BOUND_NAMESPACES = [
  NS.rdf,
  NS.rdfs,
  NS.owl,
  NS.xsd,
  "http://www.w3.org/XML/1998/namespace",
  ...Object.values(NS),
];

interface Lit {
  value: string;
  datatype: { value: string };
}

const isNamed = (t: Term) => t.termType === "NamedNode";
const isLiteral = (t: Term) => t.termType === "Literal";
const asLit = (t: Term) => t as unknown as Lit;

function localName(iri: string): string {
  if (iri.includes("#")) return iri.split("#").pop()!;
  return iri.slice(iri.lastIndexOf("/") + 1);
}

function termN3(t: Term): string {
  if (t.termType === "NamedNode") return `<${t.value}>`;
  if (t.termType === "BlankNode") return `_:${t.value}`;
  if (t.termType === "Literal") {
    const l = asLit(t);
    const v = JSON.stringify(l.value);
    if (l.datatype && l.datatype.value !== XSD_STRING && l.datatype.value !== NS.rdf + "langString")
      return `${v}^^<${l.datatype.value}>`;
    return v;
  }
  return t.value;
}

class Graph {
  constructor(private store: Store) {}
  objects(s: Term | string, p: string): Term[] {
    return this.store.getObjects(s as never, p, null);
  }
  subjects(p: string | null, o: Term | string | null): Term[] {
    return this.store.getSubjects(p, o as never, null);
  }
  quads(): Quad[] {
    return this.store.getQuads(null, null, null, null);
  }
  has(s: Term, p: string, o: Term): boolean {
    return this.store.countQuads(s, p, o, null) > 0;
  }
  items(list: Term): Term[] {
    const out: Term[] = [];
    const seen = new Set<string>();
    let cur: Term | undefined = list;
    while (cur && cur.value !== RDF_NIL && !seen.has(cur.termType + cur.value)) {
      seen.add(cur.termType + cur.value);
      const first = this.objects(cur, RDF_FIRST)[0];
      if (first) out.push(first);
      cur = this.objects(cur, RDF_REST)[0];
    }
    return out;
  }
  transitiveObjects(start: string, p: string): Set<string> {
    const out = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const o of this.objects(cur, p)) {
        if (!out.has(o.value)) {
          out.add(o.value);
          stack.push(o.value);
        }
      }
    }
    return out;
  }
  typeIris(s: Term | string): string[] {
    return this.objects(s, RDF_TYPE)
      .filter(isNamed)
      .map((t) => t.value);
  }
}

function determineEntityType(g: Graph, s: Term | string): LintSubjectType {
  const types = new Set(g.objects(s, RDF_TYPE).map((t) => t.value));
  if (types.has(OWL_CLASS) || types.has(RDFS_CLASS)) return "class";
  if ([OWL_OBJECT_PROPERTY, OWL_DATATYPE_PROPERTY, OWL_ANNOTATION_PROPERTY, RDF_PROPERTY].some((t) => types.has(t)))
    return "property";
  if (types.size) return "individual";
  return "other";
}

function getLabel(g: Graph, s: Term | string): string | null {
  for (const l of g.objects(s, RDFS_LABEL)) if (isLiteral(l)) return l.value;
  return null;
}

function uniqueNamed(terms: Term[]): Term[] {
  const seen = new Set<string>();
  const out: Term[] = [];
  for (const t of terms) {
    if (isNamed(t) && !seen.has(t.value)) {
      seen.add(t.value);
      out.push(t);
    }
  }
  return out;
}

interface Ctx {
  g: Graph;
  uriSubjects: Term[];
  prefixes: Record<string, string>;
  /** Classes the ontology's owl:imports provide; they count as defined. */
  externalClasses: ReadonlySet<string>;
}

/** Tells the linter which classes an ontology's imports provide (set by server/imports.ts). */
export type ExternalClassResolver = (store: Store) => ReadonlySet<string> | null;
const resolverG = globalThis as typeof globalThis & { __ontobuildLintExternalClasses?: ExternalClassResolver };

export function setExternalClassResolver(fn: ExternalClassResolver): void {
  resolverG.__ontobuildLintExternalClasses = fn;
}

type Checker = (ctx: Ctx) => LintResult[];

const issue = (
  issue_type: LintSeverity,
  rule_id: string,
  message: string,
  subject_iri: string | null,
  subject_type: LintSubjectType | null,
  details: Record<string, unknown> | null,
): LintResult => ({ issue_type, rule_id, message, subject_iri, subject_type, details });

const CHECKERS: Record<string, Checker> = {
  "missing-label": ({ g, uriSubjects }) =>
    uriSubjects
      .filter((s) => g.objects(s, RDFS_LABEL).length === 0)
      .map((s) =>
        issue("warning", "missing-label", "Resource has no rdfs:label annotation", s.value, determineEntityType(g, s), {
          local_name: localName(s.value),
        }),
      ),

  "missing-comment": ({ g, uriSubjects }) =>
    uriSubjects
      .filter((s) => g.objects(s, RDFS_COMMENT).length === 0)
      .map((s) =>
        issue("info", "missing-comment", "Resource has no rdfs:comment description", s.value, determineEntityType(g, s), {
          local_name: localName(s.value),
          label: getLabel(g, s),
        }),
      ),

  "orphan-class": ({ g }) => {
    const out: LintResult[] = [];
    for (const cls of uniqueNamed(g.subjects(RDF_TYPE, OWL_CLASS))) {
      if (cls.value === OWL_THING) continue;
      const parents = g.objects(cls, RDFS_SUBCLASS_OF).filter((p) => isNamed(p) && p.value !== OWL_THING);
      const children = g.subjects(RDFS_SUBCLASS_OF, cls);
      if (!parents.length && !children.length) {
        out.push(
          issue("warning", "orphan-class", "Class has no parent classes and no children", cls.value, "class", {
            local_name: localName(cls.value),
            label: getLabel(g, cls),
          }),
        );
      }
    }
    return out;
  },

  "undefined-parent": ({ g, externalClasses }) => {
    const out: LintResult[] = [];
    const classes = uniqueNamed(g.subjects(RDF_TYPE, OWL_CLASS));
    const defined = new Set([...classes.map((c) => c.value), ...externalClasses]);
    defined.add(OWL_THING);
    for (const cls of classes) {
      for (const parent of g.objects(cls, RDFS_SUBCLASS_OF)) {
        if (!isNamed(parent) || defined.has(parent.value)) continue;
        out.push(
          issue("error", "undefined-parent", "References undefined parent class", cls.value, "class", {
            local_name: localName(cls.value),
            label: getLabel(g, cls),
            undefined_parent: parent.value,
            undefined_parent_local: localName(parent.value),
          }),
        );
      }
    }
    return out;
  },

  "circular-hierarchy": ({ g }) => {
    const out: LintResult[] = [];
    const subclassOf = new Map<string, string[]>();
    for (const cls of uniqueNamed(g.subjects(RDF_TYPE, OWL_CLASS))) {
      for (const parent of g.objects(cls, RDFS_SUBCLASS_OF)) {
        if (isNamed(parent) && parent.value !== OWL_THING) {
          if (!subclassOf.has(cls.value)) subclassOf.set(cls.value, []);
          subclassOf.get(cls.value)!.push(parent.value);
        }
      }
    }
    const findCycle = (start: string, current: string, visited: Set<string>, path: string[]): string[] | null => {
      if (visited.has(current)) return current === start ? path : null;
      visited.add(current);
      path.push(current);
      for (const parent of subclassOf.get(current) ?? []) {
        const cycle = findCycle(start, parent, visited, path);
        if (cycle) return cycle;
      }
      path.pop();
      return null;
    };
    const reported = new Set<string>();
    for (const cls of subclassOf.keys()) {
      const cycle = findCycle(cls, cls, new Set(), []);
      if (!cycle) continue;
      const key = [...new Set(cycle)].sort().join("\n");
      if (reported.has(key)) continue;
      reported.add(key);
      const labels = cycle.map((c) => getLabel(g, c) || localName(c));
      out.push(
        issue(
          "error",
          "circular-hierarchy",
          `Circular inheritance: ${labels.join(" → ")} → ${labels[0]}`,
          cycle[0],
          "class",
          { cycle_iris: cycle, cycle_labels: labels },
        ),
      );
    }
    return out;
  },

  "empty-label": ({ g, uriSubjects }) => {
    const out: LintResult[] = [];
    for (const s of uriSubjects) {
      for (const l of g.objects(s, RDFS_LABEL)) {
        if (isLiteral(l) && !l.value.trim()) {
          out.push(
            issue("warning", "empty-label", "Resource has an empty rdfs:label", s.value, determineEntityType(g, s), {
              local_name: localName(s.value),
            }),
          );
        }
      }
    }
    return out;
  },

  "duplicate-label": ({ g, uriSubjects }) => {
    const out: LintResult[] = [];
    const byLabel = new Map<string, string[]>();
    for (const s of uriSubjects) {
      for (const l of g.objects(s, RDFS_LABEL)) {
        if (!isLiteral(l)) continue;
        const key = l.value.trim().toLowerCase();
        if (!key) continue;
        if (!byLabel.has(key)) byLabel.set(key, []);
        if (!byLabel.get(key)!.includes(s.value)) byLabel.get(key)!.push(s.value);
      }
    }
    const reported = new Set<string>();
    for (const iris of byLabel.values()) {
      if (iris.length < 2) continue;
      for (const iri of iris) {
        if (reported.has(iri)) continue;
        reported.add(iri);
        const original = getLabel(g, iri);
        const others = iris.filter((c) => c !== iri);
        out.push(
          issue(
            "warning",
            "duplicate-label",
            `Label '${original}' is shared with ${others.length} other resource(s)`,
            iri,
            determineEntityType(g, iri),
            {
              local_name: localName(iri),
              label: original,
              duplicate_iris: others.slice(0, 5),
              total_duplicates: others.length,
            },
          ),
        );
      }
    }
    return out;
  },

  "undefined-prefix": ({ g, prefixes }) => {
    const out: LintResult[] = [];
    const namespaces = new Set([...DEFAULT_BOUND_NAMESPACES, ...Object.values(prefixes)].filter(Boolean));
    const checked = new Set<string>();
    for (const q of g.quads()) {
      for (const term of [q.subject, q.predicate, q.object] as Term[]) {
        if (!isNamed(term)) continue;
        const iri = term.value;
        if (checked.has(iri)) continue;
        checked.add(iri);
        let known = false;
        for (const ns of namespaces) {
          if (iri.startsWith(ns)) {
            known = true;
            break;
          }
        }
        if (!known && iri.includes(":") && !iri.startsWith("http")) {
          const prefix = iri.split(":")[0];
          out.push(
            issue("error", "undefined-prefix", `Prefix '${prefix}' is not defined`, iri, determineEntityType(g, term), {
              prefix,
              iri,
            }),
          );
        }
      }
    }
    return out;
  },

  "duplicate-triple": ({ g }) => {
    const out: LintResult[] = [];
    const bySubject = new Map<string, Map<string, { p: string; o: string; n: number }>>();
    for (const q of g.quads()) {
      if (!isNamed(q.subject)) continue;
      const o = termN3(q.object as Term);
      const key = `${q.predicate.value}\u0000${o}`;
      if (!bySubject.has(q.subject.value)) bySubject.set(q.subject.value, new Map());
      const m = bySubject.get(q.subject.value)!;
      const e = m.get(key) ?? { p: q.predicate.value, o, n: 0 };
      e.n++;
      m.set(key, e);
    }
    for (const [s, m] of bySubject) {
      for (const e of m.values()) {
        if (e.n > 1) {
          out.push(
            issue(
              "info",
              "duplicate-triple",
              `Duplicate triple: predicate-object pair appears ${e.n} times`,
              s,
              determineEntityType(g, s),
              { predicate: e.p, object: e.o, count: e.n },
            ),
          );
        }
      }
    }
    return out;
  },

  "domain-violation": ({ g }) => {
    const out: LintResult[] = [];
    const domains = new Map<string, Set<string>>();
    for (const t of [OWL_OBJECT_PROPERTY, OWL_DATATYPE_PROPERTY]) {
      for (const prop of uniqueNamed(g.subjects(RDF_TYPE, t))) {
        for (const d of g.objects(prop, RDFS_DOMAIN)) {
          if (!isNamed(d)) continue;
          if (!domains.has(prop.value)) domains.set(prop.value, new Set());
          domains.get(prop.value)!.add(d.value);
        }
      }
    }
    for (const q of g.quads()) {
      const ds = domains.get(q.predicate.value);
      if (!ds || !isNamed(q.subject)) continue;
      const types = new Set(g.typeIris(q.subject));
      let valid = false;
      for (const t of types) {
        if (ds.has(t)) {
          valid = true;
          break;
        }
        for (const sup of g.transitiveObjects(t, RDFS_SUBCLASS_OF)) {
          if (ds.has(sup)) {
            valid = true;
            break;
          }
        }
        if (valid) break;
      }
      if (!valid && types.size) {
        out.push(
          issue(
            "warning",
            "domain-violation",
            "Property used on subject not in declared domain",
            q.subject.value,
            determineEntityType(g, q.subject),
            { property: q.predicate.value, expected_domains: [...ds], actual_types: [...types] },
          ),
        );
      }
    }
    return out;
  },

  "range-violation": ({ g }) => {
    const out: LintResult[] = [];
    const ranges = new Map<string, Set<string>>();
    for (const prop of uniqueNamed(g.subjects(RDF_TYPE, OWL_OBJECT_PROPERTY))) {
      for (const r of g.objects(prop, RDFS_RANGE)) {
        if (!isNamed(r)) continue;
        if (!ranges.has(prop.value)) ranges.set(prop.value, new Set());
        ranges.get(prop.value)!.add(r.value);
      }
    }
    for (const q of g.quads()) {
      const rs = ranges.get(q.predicate.value);
      if (!rs || !isNamed(q.object)) continue;
      const types = new Set(g.typeIris(q.object as Term));
      let valid = false;
      for (const t of types) {
        if (rs.has(t)) {
          valid = true;
          break;
        }
        for (const sup of g.transitiveObjects(t, RDFS_SUBCLASS_OF)) {
          if (rs.has(sup)) {
            valid = true;
            break;
          }
        }
        if (valid) break;
      }
      if (!valid && types.size) {
        out.push(
          issue(
            "warning",
            "range-violation",
            "Property value not in declared range",
            q.subject.value,
            determineEntityType(g, q.subject as Term),
            {
              property: q.predicate.value,
              object: q.object.value,
              expected_ranges: [...rs],
              actual_types: [...types],
            },
          ),
        );
      }
    }
    return out;
  },

  "cardinality-violation": ({ g }) => {
    const out: LintResult[] = [];
    const toInt = (t: Term | undefined): number | null => {
      if (!t) return null;
      const n = Number(t.value);
      return Number.isInteger(n) ? n : null;
    };
    const lastInt = (r: Term, p: string): number | null => {
      let v: number | null = null;
      for (const o of g.objects(r, p)) {
        const n = toInt(o);
        if (n !== null) v = n;
      }
      return v;
    };
    for (const r of g.subjects(RDF_TYPE, OWL_RESTRICTION)) {
      const onProperty = g.objects(r, OWL_ON_PROPERTY)[0];
      if (!onProperty) continue;
      const max = lastInt(r, OWL_MAX_CARD);
      const min = lastInt(r, OWL_MIN_CARD);
      const exact = lastInt(r, OWL_CARD);
      for (const cls of g.subjects(RDFS_SUBCLASS_OF, r)) {
        if (!isNamed(cls)) continue;
        for (const inst of uniqueNamed(g.subjects(RDF_TYPE, cls))) {
          const count = g.objects(inst, onProperty.value).length;
          const prop = onProperty.value;
          if (exact !== null && count !== exact) {
            out.push(
              issue(
                "error",
                "cardinality-violation",
                `Cardinality violation: expected exactly ${exact}, found ${count}`,
                inst.value,
                "individual",
                { property: prop, expected: exact, actual: count, constraint_type: "exact" },
              ),
            );
          } else if (max !== null && count > max) {
            out.push(
              issue("error", "cardinality-violation", `Cardinality violation: max ${max}, found ${count}`, inst.value, "individual", {
                property: prop,
                max,
                actual: count,
                constraint_type: "max",
              }),
            );
          } else if (min !== null && count < min) {
            out.push(
              issue("error", "cardinality-violation", `Cardinality violation: min ${min}, found ${count}`, inst.value, "individual", {
                property: prop,
                min,
                actual: count,
                constraint_type: "min",
              }),
            );
          }
        }
      }
    }
    return out;
  },

  "disjoint-violation": ({ g }) => {
    const out: LintResult[] = [];
    const pairs = new Set<string>();
    const pairKey = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
    for (const s of g.subjects(RDF_TYPE, OWL_ALL_DISJOINT)) {
      for (const list of g.objects(s, OWL_MEMBERS)) {
        const classes = g.items(list);
        for (let i = 0; i < classes.length; i++)
          for (let j = i + 1; j < classes.length; j++)
            if (isNamed(classes[i]) && isNamed(classes[j])) pairs.add(pairKey(classes[i].value, classes[j].value));
      }
    }
    for (const q of g.quads().filter((q) => q.predicate.value === OWL_DISJOINT_WITH)) {
      if (isNamed(q.subject) && isNamed(q.object)) pairs.add(pairKey(q.subject.value, q.object.value));
    }
    if (!pairs.size) return out;
    for (const inst of uniqueNamed(g.subjects(RDF_TYPE, null))) {
      const types = g.typeIris(inst);
      outer: for (let i = 0; i < types.length; i++) {
        for (let j = i + 1; j < types.length; j++) {
          if (pairs.has(pairKey(types[i], types[j]))) {
            out.push(
              issue("error", "disjoint-violation", "Resource is typed with disjoint classes", inst.value, "individual", {
                class1: types[i],
                class2: types[j],
                all_types: types,
              }),
            );
            break outer;
          }
        }
      }
    }
    return out;
  },

  "inverse-property-inconsistency": ({ g }) => {
    const out: LintResult[] = [];
    const inverse = new Map<string, string>();
    for (const q of g.quads()) {
      if (q.predicate.value !== OWL_INVERSE_OF) continue;
      if (isNamed(q.subject) && isNamed(q.object)) {
        inverse.set(q.subject.value, q.object.value);
        inverse.set(q.object.value, q.subject.value);
      }
    }
    if (!inverse.size) return out;
    const reported = new Set<string>();
    for (const q of g.quads()) {
      if (!isNamed(q.subject) || !isNamed(q.object)) continue;
      const inv = inverse.get(q.predicate.value);
      if (!inv) continue;
      if (g.has(q.object as Term, inv, q.subject as Term)) continue;
      const key = `${q.subject.value}|${q.predicate.value}|${q.object.value}`;
      if (reported.has(key)) continue;
      reported.add(key);
      out.push(
        issue(
          "warning",
          "inverse-property-inconsistency",
          "Missing inverse property assertion",
          q.subject.value,
          determineEntityType(g, q.subject as Term),
          {
            property: q.predicate.value,
            object: q.object.value,
            inverse_property: inv,
            expected_triple: `${q.object.value} ${inv} ${q.subject.value}`,
          },
        ),
      );
    }
    return out;
  },

  "missing-type-declaration": ({ g, uriSubjects }) => {
    const out: LintResult[] = [];
    const skip = [
      NS.owl,
      NS.rdf,
      NS.rdfs,
      NS.xsd,
      NS.skos,
      "http://purl.org/dc/elements/1.1/",
      "http://purl.org/dc/terms/",
      "http://www.w3.org/ns/prov#",
      "http://www.w3.org/2006/time#",
      "http://xmlns.com/foaf/0.1/",
    ];
    let baseNs: string | null = null;
    const ont = g.subjects(RDF_TYPE, OWL_ONTOLOGY).find(isNamed);
    if (ont) {
      const stripped = ont.value.replace(/[/#]+$/, "");
      const candidates = [stripped + "#", stripped + "/"];
      baseNs = candidates.find((c) => uriSubjects.some((s) => s.value.startsWith(c))) ?? candidates[0];
    }
    if (!baseNs) {
      const counts = new Map<string, number>();
      for (const s of uriSubjects) {
        const iri = s.value;
        if (skip.some((p) => iri.startsWith(p))) continue;
        let ns: string | null = null;
        if (iri.includes("#")) ns = iri.slice(0, iri.lastIndexOf("#") + 1);
        else if (iri.includes("/")) ns = iri.slice(0, iri.lastIndexOf("/") + 1);
        if (ns) counts.set(ns, (counts.get(ns) ?? 0) + 1);
      }
      let best = 0;
      for (const [ns, n] of counts) {
        if (n > best) {
          best = n;
          baseNs = ns;
        }
      }
    }
    if (!baseNs) return out;
    for (const s of uriSubjects) {
      const iri = s.value;
      if (!iri.startsWith(baseNs)) continue;
      if (skip.some((p) => iri.startsWith(p))) continue;
      if (g.objects(s, RDF_TYPE).length === 0) {
        out.push(
          issue("warning", "missing-type-declaration", "Resource has no rdf:type declaration", iri, "other", {
            local_name: localName(iri),
          }),
        );
      }
    }
    return out;
  },
};

export function lintOntology(
  store: Store,
  opts: { enabledRules?: ReadonlySet<string> | null; prefixes?: Record<string, string> } = {},
): LintResult[] {
  const g = new Graph(store);
  const enabled = opts.enabledRules ?? ALL_RULE_IDS;
  const uriSubjects = uniqueNamed(store.getSubjects(null, null, null)).filter((s) => s.value !== OWL_THING && !isRule(store, s.value));
  let externalClasses: ReadonlySet<string> = new Set();
  try {
    externalClasses = resolverG.__ontobuildLintExternalClasses?.(store) ?? new Set();
  } catch {
    externalClasses = new Set();
  }
  const ctx: Ctx = { g, uriSubjects, prefixes: opts.prefixes ?? {}, externalClasses };
  const issues: LintResult[] = [];
  for (const rule of LINT_RULES) {
    if (!enabled.has(rule.rule_id)) continue;
    issues.push(...CHECKERS[rule.rule_id](ctx));
  }
  return issues;
}
