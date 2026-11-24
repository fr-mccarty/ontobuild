import { DataFactory, Store, type Quad, type Term } from "n3";
import SHACLValidator from "rdf-validate-shacl";
import { httpError } from "./http";
import { addImportToTurtle, directImports, getImportView, importsGeneration, isValidIri, termForm, type ImportView } from "./imports";
import {
  NS,
  OWL_ANNOTATION_PROPERTY,
  RDFS_COMMENT,
  RDFS_LABEL,
  RDFS_SUBCLASS_OF,
  RDF_TYPE,
  findOntologyIri,
  loadOntology,
  type LoadedOntology,
} from "./ontology";
import { parseTurtle, sameGraph, serializeTurtle } from "./rdf";
import { RULE_CLASS, RULE_NS, RULE_PREFIX, RULES_ONTOLOGY_IRI, isRule, isRulesOntologyIri } from "./rulesVocabulary";
import { findBlockSpan, literal, parseDeclarations } from "@/lib/ontology/turtleUtils";

const { namedNode, blankNode, literal: literalTerm, quad } = DataFactory;

const SH = "http://www.w3.org/ns/shacl#";
const RDF_FIRST = NS.rdf + "first";
const RDF_REST = NS.rdf + "rest";
const RDF_NIL = NS.rdf + "nil";
const XSD_INTEGER = NS.xsd + "integer";
const XSD_BOOLEAN = NS.xsd + "boolean";

const TERM = {
  appliesTo: RULE_NS + "appliesTo",
  property: RULE_NS + "property",
  minCount: RULE_NS + "minCount",
  maxCount: RULE_NS + "maxCount",
  valueClass: RULE_NS + "valueClass",
  valueDatatype: RULE_NS + "valueDatatype",
  allowedValues: RULE_NS + "allowedValues",
  pattern: RULE_NS + "pattern",
  minLength: RULE_NS + "minLength",
  maxLength: RULE_NS + "maxLength",
  closed: RULE_NS + "closed",
  severity: RULE_NS + "severity",
};

export const RULE_SEVERITIES = ["error", "warning", "info"] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

const SEVERITY_TERMS: Record<RuleSeverity, { rule: string; shacl: string }> = {
  error: { rule: RULE_NS + "Error", shacl: SH + "Violation" },
  warning: { rule: RULE_NS + "Warning", shacl: SH + "Warning" },
  info: { rule: RULE_NS + "Info", shacl: SH + "Info" },
};

export interface RuleValue {
  value: string;
  type: "iri" | "literal";
  datatype?: string | null;
}

export interface RuleFields {
  applies_to_iri: string;
  property_iri: string | null;
  min_count: number | null;
  max_count: number | null;
  value_class_iri: string | null;
  value_datatype_iri: string | null;
  allowed_values: RuleValue[] | null;
  pattern: string | null;
  min_length: number | null;
  max_length: number | null;
  closed: boolean;
  severity: RuleSeverity;
  label: string | null;
  message: string | null;
}

export interface Rule extends RuleFields {
  iri: string;
  read_only: boolean;
  imported_from: string | null;
}

export type RuleConstraint =
  | "min_count"
  | "max_count"
  | "value_class"
  | "value_datatype"
  | "allowed_values"
  | "pattern"
  | "min_length"
  | "max_length"
  | "closed";

export interface RuleViolation {
  rule_iri: string;
  applies_to_iri: string;
  focus_node: string;
  property_iri: string | null;
  value: string | null;
  constraint: RuleConstraint;
  severity: RuleSeverity;
  message: string;
}

export interface RuleCounts {
  error: number;
  warning: number;
  info: number;
  total: number;
}

export interface RuleValidation {
  commit_hash: string;
  file_path: string;
  rule_count: number;
  violations: RuleViolation[];
  counts: RuleCounts;
  duration_ms: number;
}

function localName(iri: string): string {
  const m = /[#/:]([^#/:]+)[#/]?$/.exec(iri);
  return m ? m[1] : iri;
}

function firstObject(store: Store, subject: string, predicate: string): Term | null {
  return store.getObjects(subject, predicate, null)[0] ?? null;
}

function namedObject(store: Store, subject: string, predicate: string): string | null {
  const t = store.getObjects(subject, predicate, null).find((o) => o.termType === "NamedNode");
  return t ? t.value : null;
}

function integerObject(store: Store, subject: string, predicate: string): number | null {
  const t = firstObject(store, subject, predicate);
  if (!t || t.termType !== "Literal") return null;
  const n = Number(t.value);
  return Number.isInteger(n) ? n : null;
}

function stringObject(store: Store, subject: string, predicate: string): string | null {
  const t = store.getObjects(subject, predicate, null).find((o) => o.termType === "Literal");
  return t ? t.value : null;
}

function listItems(store: Store, head: Term): Term[] {
  const items: Term[] = [];
  const seen = new Set<string>();
  let node: Term | null = head;
  while (node && node.value !== RDF_NIL && !seen.has(node.value)) {
    seen.add(node.value);
    const first = store.getObjects(node, RDF_FIRST, null)[0];
    if (first) items.push(first);
    node = node.termType === "BlankNode" ? store.getObjects(node, RDF_REST, null)[0] ?? null : null;
  }
  return items;
}

function toRuleValue(t: Term): RuleValue {
  if (t.termType === "NamedNode") return { value: t.value, type: "iri" };
  const datatype = t.termType === "Literal" ? (t as { datatype?: { value: string } }).datatype?.value : undefined;
  return datatype && datatype !== NS.xsd + "string" ? { value: t.value, type: "literal", datatype } : { value: t.value, type: "literal" };
}

function readSeverity(store: Store, iri: string): RuleSeverity {
  const o = namedObject(store, iri, TERM.severity);
  return RULE_SEVERITIES.find((s) => SEVERITY_TERMS[s].rule === o) ?? "error";
}

export function readRuleFields(store: Store, iri: string): RuleFields {
  const list = store.getObjects(iri, TERM.allowedValues, null)[0];
  return {
    applies_to_iri: namedObject(store, iri, TERM.appliesTo) ?? "",
    property_iri: namedObject(store, iri, TERM.property),
    min_count: integerObject(store, iri, TERM.minCount),
    max_count: integerObject(store, iri, TERM.maxCount),
    value_class_iri: namedObject(store, iri, TERM.valueClass),
    value_datatype_iri: namedObject(store, iri, TERM.valueDatatype),
    allowed_values: list ? listItems(store, list).map(toRuleValue) : null,
    pattern: stringObject(store, iri, TERM.pattern),
    min_length: integerObject(store, iri, TERM.minLength),
    max_length: integerObject(store, iri, TERM.maxLength),
    closed: store.getObjects(iri, TERM.closed, null).some((o) => ["true", "1"].includes(o.value)),
    severity: readSeverity(store, iri),
    label: stringObject(store, iri, RDFS_LABEL),
    message: stringObject(store, iri, RDFS_COMMENT),
  };
}

export function ruleIris(store: Store): string[] {
  return [
    ...new Set(store.getSubjects(RDF_TYPE, RULE_CLASS, null).filter((s) => s.termType === "NamedNode").map((s) => s.value)),
  ].sort();
}

export function readRules(view: ImportView, local: Store): Rule[] {
  return ruleIris(view.store)
    .map((iri) => {
      const own = isRule(local, iri);
      const from = own ? null : view.closure.resolved.find((r) => r.store && isRule(r.store, iri));
      return { iri, ...readRuleFields(view.store, iri), read_only: !own, imported_from: from ? from.ontologyIri : null };
    })
    .filter((r) => r.applies_to_iri);
}

export function superClassesOf(store: Store, iri: string): string[] {
  const out: string[] = [];
  const queue = [iri];
  const seen = new Set([iri]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const p of store.getObjects(current, RDFS_SUBCLASS_OF, null)) {
      if (p.termType !== "NamedNode" || seen.has(p.value)) continue;
      seen.add(p.value);
      out.push(p.value);
      queue.push(p.value);
    }
  }
  return out;
}

const ALWAYS_ALLOWED = [
  RDF_TYPE,
  RDFS_LABEL,
  RDFS_COMMENT,
  NS.rdfs + "seeAlso",
  NS.rdfs + "isDefinedBy",
  NS.owl + "deprecated",
];

const ANNOTATION_NAMESPACES = [NS.skos, NS.dc, NS.dcterms];

function annotationProperties(data: Store): string[] {
  const out = new Set(ALWAYS_ALLOWED);
  for (const s of data.getSubjects(RDF_TYPE, OWL_ANNOTATION_PROPERTY, null)) if (s.termType === "NamedNode") out.add(s.value);
  for (const p of data.getPredicates(null, null, null)) {
    if (ANNOTATION_NAMESPACES.some((ns) => p.value.startsWith(ns))) out.add(p.value);
  }
  return [...out].sort();
}

function valueTerm(v: RuleValue): Term {
  if (v.type === "iri") return namedNode(v.value);
  return v.datatype ? literalTerm(v.value, namedNode(v.datatype)) : literalTerm(v.value);
}

export interface DerivedShapes {
  quads: Quad[];
  origins: Map<string, Rule>;
}

export function deriveShapes(rules: Rule[], data: Store): DerivedShapes {
  const quads: Quad[] = [];
  const origins = new Map<string, Rule>();
  const add = (s: Term, p: string, o: Term) => quads.push(quad(s as never, namedNode(p), o as never));
  const integer = (n: number) => literalTerm(String(n), namedNode(XSD_INTEGER));
  const list = (items: Term[]): Term => {
    if (!items.length) return namedNode(RDF_NIL);
    const head = blankNode();
    add(head, RDF_FIRST, items[0]);
    add(head, RDF_REST, list(items.slice(1)));
    return head;
  };
  const byClass = new Map<string, Rule[]>();
  for (const rule of rules) byClass.set(rule.applies_to_iri, [...(byClass.get(rule.applies_to_iri) ?? []), rule]);
  const ignored = byClass.size ? annotationProperties(data).map((p) => namedNode(p)) : [];

  for (const [cls, classRules] of byClass) {
    const shape = blankNode();
    add(shape, RDF_TYPE, namedNode(SH + "NodeShape"));
    add(shape, SH + "targetClass", namedNode(cls));
    for (const rule of classRules) {
      if (!rule.property_iri) continue;
      const property = blankNode();
      add(shape, SH + "property", property);
      add(property, SH + "path", namedNode(rule.property_iri));
      if (rule.min_count !== null) add(property, SH + "minCount", integer(rule.min_count));
      if (rule.max_count !== null) add(property, SH + "maxCount", integer(rule.max_count));
      if (rule.value_class_iri) add(property, SH + "class", namedNode(rule.value_class_iri));
      if (rule.value_datatype_iri) add(property, SH + "datatype", namedNode(rule.value_datatype_iri));
      if (rule.allowed_values) add(property, SH + "in", list(rule.allowed_values.map(valueTerm)));
      if (rule.pattern !== null) add(property, SH + "pattern", literalTerm(rule.pattern));
      if (rule.min_length !== null) add(property, SH + "minLength", integer(rule.min_length));
      if (rule.max_length !== null) add(property, SH + "maxLength", integer(rule.max_length));
      add(property, SH + "severity", namedNode(SEVERITY_TERMS[rule.severity].shacl));
      if (rule.message) add(property, SH + "message", literalTerm(rule.message));
      add(property, NS.rdfs + "isDefinedBy", namedNode(rule.iri));
      origins.set(property.value, rule);
    }
    const closedRule = classRules.find((r) => r.closed);
    if (closedRule) {
      add(shape, SH + "closed", literalTerm("true", namedNode(XSD_BOOLEAN)));
      add(shape, SH + "ignoredProperties", list(ignored));
      add(shape, SH + "severity", namedNode(SEVERITY_TERMS[closedRule.severity].shacl));
      if (closedRule.message) add(shape, SH + "message", literalTerm(closedRule.message));
      add(shape, NS.rdfs + "isDefinedBy", namedNode(closedRule.iri));
      origins.set(shape.value, closedRule);
    }
  }
  return { quads, origins };
}

export async function shapesTurtle(shapes: DerivedShapes): Promise<string> {
  return serializeTurtle(shapes.quads, { sh: SH, [RULE_PREFIX]: RULE_NS });
}

const CONSTRAINTS: Record<string, RuleConstraint> = {
  MinCountConstraintComponent: "min_count",
  MaxCountConstraintComponent: "max_count",
  ClassConstraintComponent: "value_class",
  DatatypeConstraintComponent: "value_datatype",
  InConstraintComponent: "allowed_values",
  PatternConstraintComponent: "pattern",
  MinLengthConstraintComponent: "min_length",
  MaxLengthConstraintComponent: "max_length",
  ClosedConstraintComponent: "closed",
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function generatedMessage(rule: Rule, constraint: RuleConstraint, property: string | null, value: string | null): string {
  const p = property ? localName(property) : "the property";
  const v = value ?? "";
  switch (constraint) {
    case "min_count":
      return `Needs at least ${plural(rule.min_count ?? 0, "value")} for ${p}`;
    case "max_count":
      return `Has more than ${plural(rule.max_count ?? 0, "value")} for ${p}`;
    case "value_class":
      return `The ${p} value ${localName(v)} is not a ${localName(rule.value_class_iri ?? "")}`;
    case "value_datatype":
      return `The ${p} value "${v}" is not ${localName(rule.value_datatype_iri ?? "")}`;
    case "allowed_values":
      return `The ${p} value ${v} is not one of the allowed values`;
    case "pattern":
      return `The ${p} value "${v}" does not match ${rule.pattern}`;
    case "min_length":
      return `The ${p} value "${v}" is shorter than ${plural(rule.min_length ?? 0, "character")}`;
    case "max_length":
      return `The ${p} value "${v}" is longer than ${plural(rule.max_length ?? 0, "character")}`;
    case "closed":
      return `Uses ${p}, which no rule allows on ${localName(rule.applies_to_iri)}`;
  }
}

const SEVERITY_ORDER: Record<RuleSeverity, number> = { error: 0, warning: 1, info: 2 };

export function violationKey(v: RuleViolation): string {
  return [v.rule_iri, v.focus_node, v.property_iri ?? "", v.value ?? ""].join("\u0000");
}

export async function validateRules(rules: Rule[], data: Store): Promise<RuleViolation[]> {
  if (!rules.length) return [];
  const shapes = deriveShapes(rules, data);
  const validator = new SHACLValidator(new Store(shapes.quads) as never);
  const report = await validator.validate(data as never);
  const out = new Map<string, RuleViolation>();
  for (const r of report.results) {
    const rule = r.sourceShape ? shapes.origins.get(r.sourceShape.value) : undefined;
    const component = r.sourceConstraintComponent?.value.slice(SH.length) ?? "";
    const constraint = CONSTRAINTS[component];
    if (!rule || !constraint || !r.focusNode) continue;
    const property = r.path?.termType === "NamedNode" ? r.path.value : rule.property_iri;
    const value = r.value ? r.value.value : null;
    const violation: RuleViolation = {
      rule_iri: rule.iri,
      applies_to_iri: rule.applies_to_iri,
      focus_node: r.focusNode.value,
      property_iri: property,
      value,
      constraint,
      severity: rule.severity,
      message: rule.message ?? generatedMessage(rule, constraint, property, value),
    };
    out.set(`${violationKey(violation)}\u0000${constraint}`, violation);
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...out.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      cmp(a.focus_node, b.focus_node) ||
      cmp(a.rule_iri, b.rule_iri) ||
      cmp(a.value ?? "", b.value ?? ""),
  );
}

export function countViolations(violations: RuleViolation[]): RuleCounts {
  const counts = { error: 0, warning: 0, info: 0, total: violations.length };
  for (const v of violations) counts[v.severity]++;
  return counts;
}

export function hasRulesOrImports(store: Store): boolean {
  return ruleIris(store).length > 0 || directImports(store).length > 0;
}

const memoG = globalThis as typeof globalThis & { __ontobuildRuleValidations?: Map<string, RuleValidation> };
const memo: Map<string, RuleValidation> = (memoG.__ontobuildRuleValidations ??= new Map());

export async function rulesView(onto: LoadedOntology): Promise<{ view: ImportView; rules: Rule[] }> {
  const view = await getImportView(onto);
  return { view, rules: readRules(view, onto.store) };
}

export async function validateOntology(onto: LoadedOntology): Promise<RuleValidation> {
  const { view, rules } = await rulesView(onto);
  const key = `${onto.projectId}:${onto.commitHash}:${onto.filePath}:${importsGeneration()}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const start = performance.now();
  const violations = await validateRules(rules, view.store);
  const result: RuleValidation = {
    commit_hash: onto.commitHash,
    file_path: onto.filePath,
    rule_count: rules.length,
    violations,
    counts: countViolations(violations),
    duration_ms: Math.round((performance.now() - start) * 100) / 100,
  };
  memo.set(key, result);
  while (memo.size > 24) memo.delete(memo.keys().next().value!);
  return result;
}

export async function validateRef(projectId: string, ref: string): Promise<RuleValidation> {
  return validateOntology(await loadOntology(projectId, ref));
}

export async function violationsAddedBy(projectId: string, baseRef: string, headRef: string): Promise<RuleViolation[]> {
  const head = await validateRef(projectId, headRef);
  if (!head.violations.length) return [];
  const base = await validateRef(projectId, baseRef);
  const existing = new Set(base.violations.map(violationKey));
  return head.violations.filter((v) => !existing.has(violationKey(v)));
}

export interface RuleInput extends RuleFields {
  iri: string | null;
}

function fail(message: string): never {
  httpError(422, message);
}

function optionalIri(body: Record<string, unknown>, field: string): string | null {
  const v = body[field];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !isValidIri(v.trim())) fail(`Field '${field}' must be an absolute IRI`);
  return v.trim();
}

function optionalCount(body: Record<string, unknown>, field: string): number | null {
  const v = body[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(`Field '${field}' must be an integer >= 0`);
  return v;
}

function optionalText(body: Record<string, unknown>, field: string): string | null {
  const v = body[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`Field '${field}' must be a string`);
  return v.trim() ? v : null;
}

function allowedValues(body: Record<string, unknown>): RuleValue[] | null {
  const v = body.allowed_values;
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || !v.length) fail("Field 'allowed_values' must be a non-empty array");
  return v.map((item, i) => {
    const entry = item as Record<string, unknown>;
    if (!entry || typeof entry !== "object" || typeof entry.value !== "string")
      fail(`allowed_values[${i}] must be an object with a string 'value'`);
    if (entry.type !== "iri" && entry.type !== "literal") fail(`allowed_values[${i}].type must be 'iri' or 'literal'`);
    if (entry.type === "iri") {
      if (!isValidIri(entry.value)) fail(`allowed_values[${i}].value must be an absolute IRI`);
      return { value: entry.value, type: "iri" as const };
    }
    const datatype = optionalIri(entry, "datatype");
    return datatype ? { value: entry.value, type: "literal" as const, datatype } : { value: entry.value, type: "literal" as const };
  });
}

export function parseRuleInput(body: Record<string, unknown>): RuleInput {
  const applies = optionalIri(body, "applies_to_iri");
  if (!applies) fail("Field 'applies_to_iri' is required");
  const severity = body.severity === undefined || body.severity === null ? "error" : body.severity;
  if (typeof severity !== "string" || !(RULE_SEVERITIES as readonly string[]).includes(severity))
    fail(`Field 'severity' must be one of: ${RULE_SEVERITIES.join(", ")}`);
  if (body.closed !== undefined && body.closed !== null && typeof body.closed !== "boolean") fail("Field 'closed' must be a boolean");
  const pattern = body.pattern === undefined || body.pattern === null || body.pattern === "" ? null : body.pattern;
  if (pattern !== null) {
    if (typeof pattern !== "string") fail("Field 'pattern' must be a string");
    try {
      new RegExp(pattern, "u");
    } catch (e) {
      fail(`Field 'pattern' is not a valid regular expression: ${(e as Error).message}`);
    }
  }
  const input: RuleInput = {
    iri: optionalIri(body, "iri"),
    applies_to_iri: applies,
    property_iri: optionalIri(body, "property_iri"),
    min_count: optionalCount(body, "min_count"),
    max_count: optionalCount(body, "max_count"),
    value_class_iri: optionalIri(body, "value_class_iri"),
    value_datatype_iri: optionalIri(body, "value_datatype_iri"),
    allowed_values: allowedValues(body),
    pattern: pattern as string | null,
    min_length: optionalCount(body, "min_length"),
    max_length: optionalCount(body, "max_length"),
    closed: body.closed === true,
    severity: severity as RuleSeverity,
    label: optionalText(body, "label"),
    message: optionalText(body, "message"),
  };
  const constraints = [
    input.min_count,
    input.max_count,
    input.value_class_iri,
    input.value_datatype_iri,
    input.allowed_values,
    input.pattern,
    input.min_length,
    input.max_length,
  ].filter((c) => c !== null);
  if (!input.property_iri && !input.closed) fail("A rule needs 'property_iri' unless it is closed");
  if (input.property_iri && !constraints.length && !input.closed)
    fail("A rule needs at least one constraint: a count, value class, datatype, allowed values, pattern or length");
  if (!input.property_iri && constraints.length) fail("Constraints on values need 'property_iri'");
  if (input.min_count !== null && input.max_count !== null && input.min_count > input.max_count)
    fail("'min_count' must not be greater than 'max_count'");
  if (input.min_length !== null && input.max_length !== null && input.min_length > input.max_length)
    fail("'min_length' must not be greater than 'max_length'");
  return input;
}

function ruleBlock(iri: string, fields: RuleFields, prefixes: Record<string, string>): string {
  const t = (v: string) => termForm(v, prefixes);
  const lines: string[] = [];
  const add = (predicate: string, object: string) => lines.push(`${t(predicate)} ${object}`);
  if (fields.label) add(RDFS_LABEL, literal(fields.label));
  if (fields.message) add(RDFS_COMMENT, literal(fields.message));
  add(TERM.appliesTo, t(fields.applies_to_iri));
  if (fields.property_iri) add(TERM.property, t(fields.property_iri));
  if (fields.min_count !== null) add(TERM.minCount, String(fields.min_count));
  if (fields.max_count !== null) add(TERM.maxCount, String(fields.max_count));
  if (fields.value_class_iri) add(TERM.valueClass, t(fields.value_class_iri));
  if (fields.value_datatype_iri) add(TERM.valueDatatype, t(fields.value_datatype_iri));
  if (fields.allowed_values) {
    const items = fields.allowed_values.map((v) =>
      v.type === "iri" ? t(v.value) : v.datatype ? `${literal(v.value)}^^${t(v.datatype)}` : literal(v.value),
    );
    add(TERM.allowedValues, `( ${items.join(" ")} )`);
  }
  if (fields.pattern !== null) add(TERM.pattern, literal(fields.pattern));
  if (fields.min_length !== null) add(TERM.minLength, String(fields.min_length));
  if (fields.max_length !== null) add(TERM.maxLength, String(fields.max_length));
  if (fields.closed) add(TERM.closed, "true");
  if (fields.severity !== "error") add(TERM.severity, t(SEVERITY_TERMS[fields.severity].rule));
  return `${t(iri)} a ${t(RULE_CLASS)} ;\n    ${lines.join(" ;\n    ")} .\n`;
}

function ruleQuads(iri: string, fields: RuleFields): Quad[] {
  return parseTurtle(ruleBlock(iri, fields, {})).store.getQuads(null, null, null, null);
}

function withoutRule(store: Store, iri: string): Store {
  const out = new Store(store.getQuads(null, null, null, null));
  const drop = (subject: Term, seen: Set<string>) => {
    for (const q of out.getQuads(subject, null, null, null)) {
      out.removeQuad(q);
      if (q.object.termType === "BlankNode" && !seen.has(q.object.value)) {
        seen.add(q.object.value);
        drop(q.object, seen);
      }
    }
  };
  drop(namedNode(iri), new Set());
  return out;
}

function withRulePrefix(source: string): string {
  const { prefixes } = parseDeclarations(source);
  if (Object.values(prefixes).includes(RULE_NS) || prefixes[RULE_PREFIX] !== undefined) return source;
  const declaration = `@prefix ${RULE_PREFIX}: <${RULE_NS}> .`;
  const lines = source.split("\n");
  let last = -1;
  lines.forEach((l, i) => {
    if (/^\s*@prefix\b/i.test(l)) last = i;
  });
  if (last < 0) return `${declaration}\n${source}`;
  lines.splice(last + 1, 0, declaration);
  return lines.join("\n");
}

async function withRulesImport(source: string, fallbackOntologyIri: string): Promise<string> {
  const { store } = parseTurtle(source);
  if (directImports(store).some(isRulesOntologyIri)) return source;
  return addImportToTurtle(source, RULES_ONTOLOGY_IRI, fallbackOntologyIri);
}

async function settle(edited: string | null, expected: Store, prefixes: Record<string, string>): Promise<string> {
  if (edited !== null) {
    try {
      if (await sameGraph(parseTurtle(edited).store, expected)) return edited;
    } catch {
      return serializeTurtle(expected, prefixes);
    }
  }
  return serializeTurtle(expected, prefixes);
}

export function defaultRuleNamespace(onto: LoadedOntology): string {
  const declared = parseDeclarations(onto.content).prefixes[""];
  if (declared) return declared;
  const ontology = findOntologyIri(onto.store);
  return ontology ? (/[#/]$/.test(ontology) ? ontology : `${ontology}#`) : "http://example.org/ontology#";
}

export function newRuleIri(onto: LoadedOntology, view: Store, fields: RuleFields): string {
  const parts = [localName(fields.applies_to_iri), fields.property_iri ? localName(fields.property_iri) : "closed"];
  const base = defaultRuleNamespace(onto) + `rule-${parts.join("-").replace(/[^A-Za-z0-9_-]+/g, "")}`;
  let iri = base;
  for (let n = 2; view.countQuads(iri, null, null, null) > 0 || view.countQuads(null, null, iri, null) > 0; n++) iri = `${base}-${n}`;
  return iri;
}

export async function contentWithNewRule(onto: LoadedOntology, iri: string, fields: RuleFields, fallbackOntologyIri: string): Promise<string> {
  const prepared = await withRulesImport(withRulePrefix(onto.content), fallbackOntologyIri);
  const preparedStore = parseTurtle(prepared).store;
  const expected = new Store([...preparedStore.getQuads(null, null, null, null), ...ruleQuads(iri, fields)]);
  const { prefixes } = parseDeclarations(prepared);
  const base = prepared.endsWith("\n") ? prepared : `${prepared}\n`;
  return settle(`${base}\n${ruleBlock(iri, fields, prefixes)}`, expected, { ...onto.prefixes, [RULE_PREFIX]: RULE_NS });
}

export async function contentWithUpdatedRule(onto: LoadedOntology, iri: string, fields: RuleFields): Promise<string> {
  const remaining = withoutRule(onto.store, iri);
  const expected = new Store([...remaining.getQuads(null, null, null, null), ...ruleQuads(iri, fields)]);
  const { prefixes, base } = parseDeclarations(onto.content);
  const span = findBlockSpan(onto.content, iri, prefixes, base);
  const edited = span
    ? onto.content.slice(0, span.start) + ruleBlock(iri, fields, prefixes).trimEnd() + onto.content.slice(span.end)
    : null;
  return settle(edited, expected, onto.prefixes);
}

export async function contentWithoutRule(onto: LoadedOntology, iri: string): Promise<string> {
  const expected = withoutRule(onto.store, iri);
  const { prefixes, base } = parseDeclarations(onto.content);
  const span = findBlockSpan(onto.content, iri, prefixes, base);
  let edited: string | null = null;
  if (span) {
    const before = onto.content.slice(0, span.start).replace(/\s*$/, "");
    const after = onto.content.slice(span.end).replace(/^\s*/, "");
    edited = after ? `${before}\n\n${after}` : `${before}\n`;
  }
  return settle(edited, expected, onto.prefixes);
}

export function classAndAncestors(store: Store, cls: string): Set<string> {
  return new Set([cls, ...superClassesOf(store, cls)]);
}
