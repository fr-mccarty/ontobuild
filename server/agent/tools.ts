import type { Store } from "n3";
import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import { ApiError } from "../http";
import {
  OWL_CLASS,
  RDFS_CLASS,
  entityType,
  findOntologyIri,
  hasType,
  loadOntology,
  propertyKind,
} from "../ontology";
import { validateJson, type JsonSchema } from "./validate";
import { generateTurtleSnippet } from "@/lib/ontology/turtleSnippetGenerator";
import { updateClassInTurtle, type TurtleClassUpdateData } from "@/lib/ontology/turtleClassUpdater";
import { updatePropertyInTurtle, type TurtlePropertyUpdateData } from "@/lib/ontology/turtlePropertyUpdater";
import { updateIndividualInTurtle, type TurtleIndividualUpdateData } from "@/lib/ontology/turtleIndividualUpdater";
import {
  extractIndividualDetail,
  extractPropertyDetail,
  type PropertyAssertion,
  type PropertyType,
} from "@/lib/ontology/entityDetailExtractors";
import { findBlock, literal, parseDeclarations } from "@/lib/ontology/turtleUtils";
import { labelToLocalName, uuidToBase62, type EntityType } from "@/lib/ontology/iriGeneration";
import { commonPrefixes } from "@/lib/editor/languages/turtle";
import type { AnnotationUpdate, LocalizedString } from "@/lib/api/client";

export interface ToolContext {
  projectId: string;
  branch: string;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface ToolRunResult {
  result: unknown;
  summary: string;
  mutated: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolRunResult>;
}

export interface ToolExecution {
  input: Record<string, unknown> | null;
  content: string;
  is_error: boolean;
  summary: string;
  mutated: boolean;
}

export class ToolError extends Error {}

type Query = Record<string, string | number | boolean | undefined | null>;

interface CallOptions {
  query?: Query;
  body?: unknown;
  branch?: boolean;
}

function detailOf(data: unknown, text: string, status: number): string {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail: unknown }).detail;
    return typeof d === "string" ? d : JSON.stringify(d);
  }
  return text.trim() || `HTTP ${status}`;
}

async function call<T = unknown>(
  ctx: ToolContext,
  method: string,
  path: string,
  opts: CallOptions = {},
): Promise<{ status: number; data: T }> {
  const params = new URLSearchParams();
  if (opts.branch !== false) params.set("branch", ctx.branch);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  const init: RequestInit = { method, signal: ctx.signal };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await ctx.request(`/api/v1${path}${qs ? `?${qs}` : ""}`, init);
  const text = res.status === 204 ? "" : await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new ToolError(`${detailOf(data, text, res.status)} (HTTP ${res.status})`);
  return { status: res.status, data: data as T };
}

function projectPath(ctx: ToolContext, rest = ""): string {
  return `/projects/${encodeURIComponent(ctx.projectId)}${rest}`;
}

function enc(iri: string): string {
  return encodeURIComponent(iri);
}

function localName(iri: string): string {
  const i = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
  return i >= 0 && i < iri.length - 1 ? iri.slice(i + 1) : iri;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ToolError("Aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new ToolError("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function poll<T>(ctx: ToolContext, what: string, check: () => Promise<T | undefined>): Promise<T> {
  const interval = ctx.pollIntervalMs ?? 500;
  const deadline = Date.now() + (ctx.pollTimeoutMs ?? 120_000);
  for (;;) {
    const v = await check();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new ToolError(`Timed out waiting for ${what}`);
    await sleep(interval, ctx.signal);
  }
}

function snakeKey(k: string): string {
  return k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function snakeify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeify);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [snakeKey(k), snakeify(v)]));
  }
  return value;
}

const PREFIX_NS: Record<string, string> = Object.fromEntries(commonPrefixes.map((p) => [p.prefix, p.namespace]));

function ensurePrefixes(source: string): string {
  const declared = parseDeclarations(source).prefixes;
  const missing: string[] = [];
  for (const p of ["rdf", "rdfs", "owl", "xsd", "skos"]) {
    if (declared[p] !== undefined) continue;
    const used = new RegExp(`(^|[\\s,;(\\[^])${p}:[A-Za-z_]`, "m");
    if (used.test(source)) missing.push(`@prefix ${p}: <${PREFIX_NS[p]}> .`);
  }
  return missing.length ? `${missing.join("\n")}\n${source}` : source;
}

function detectNamespace(source: string, store: Store): { namespace: string; prefix?: string } {
  const external = new Set(commonPrefixes.map((p) => p.namespace));
  const internal: string[] = [];
  const prefixMap = new Map<string, string>();
  for (const line of source.split("\n")) {
    const baseMatch = line.match(/@base\s+<([^>]+)>/i);
    if (baseMatch) internal.push(baseMatch[1]);
    const pm = line.match(/@?prefix\s+(\w*):\s*<([^>]+)>/i);
    if (pm) {
      prefixMap.set(pm[1], pm[2]);
      if (!external.has(pm[2])) internal.push(pm[2]);
    }
  }
  let namespace = prefixMap.get("") ?? internal[0];
  if (!namespace) {
    const ont = findOntologyIri(store);
    namespace = ont ? (/[#/]$/.test(ont) ? ont : `${ont}#`) : "http://example.org/ont#";
  }
  let prefix: string | undefined;
  for (const [p, ns] of prefixMap) {
    if (ns === namespace && p !== "") {
      prefix = p;
      break;
    }
  }
  return { namespace, prefix };
}

function iriInUse(store: Store, iri: string): boolean {
  return store.countQuads(iri, null, null, null) > 0 || store.countQuads(null, null, iri, null) > 0;
}

function turtleBlock(source: string, iri: string): string | null {
  const { prefixes, base } = parseDeclarations(source);
  const lines = source.split("\n");
  const block = findBlock(lines, iri, prefixes, base);
  return block ? lines.slice(block.startLine, block.endLine + 1).join("\n") : null;
}

async function loadBranch(ctx: ToolContext) {
  return loadOntology(ctx.projectId, ctx.branch);
}

async function saveSource(ctx: ToolContext, content: string, message: string) {
  const { data } = await call<{ commit_hash: string; branch: string }>(ctx, "PUT", projectPath(ctx, "/source"), {
    body: { content: ensurePrefixes(content), commit_message: message.slice(0, 500) },
  });
  return data;
}

function str(description: string, extra: Partial<JsonSchema> = {}): JsonSchema {
  return { type: "string", description, ...extra };
}

function strArray(description: string): JsonSchema {
  return { type: "array", description, items: { type: "string" } };
}

const LOCALIZED: JsonSchema = {
  type: "object",
  properties: {
    value: str("Text value"),
    lang: str("Language tag such as 'en'. Use an empty string for no language tag. Defaults to 'en'."),
  },
  required: ["value"],
};

function localizedArray(description: string): JsonSchema {
  return { type: "array", description, items: LOCALIZED };
}

const ANNOTATIONS: JsonSchema = {
  type: "array",
  description:
    "Full replacement list of extra annotations (e.g. skos:definition, dcterms:creator). Each entry has the annotation property IRI and its values. Values that are IRIs use an empty lang.",
  items: {
    type: "object",
    properties: {
      property_iri: str("Full IRI of the annotation property"),
      values: localizedArray("Annotation values"),
    },
    required: ["property_iri", "values"],
  },
};

const COMMIT_MESSAGE = str("Git commit message for this change. Optional; a sensible default is used.");

function toLocalized(v: unknown): LocalizedString[] {
  return (v as { value: string; lang?: string }[]).map((x) => ({ value: x.value, lang: x.lang ?? "en" }));
}

function toAnnotations(v: unknown): AnnotationUpdate[] {
  return (v as { property_iri: string; values: { value: string; lang?: string }[] }[]).map((a) => ({
    property_iri: a.property_iri,
    values: a.values.map((x) => ({ value: x.value, lang: x.lang ?? (/^(https?:|urn:)/.test(x.value) ? "" : "en") })),
  }));
}

function toAssertions(v: unknown): PropertyAssertion[] {
  return (v as Record<string, string | undefined>[]).map((a) => ({
    propertyIri: a.property_iri!,
    targetIri: a.target_iri,
    value: a.value,
    lang: a.lang,
    datatype: a.datatype,
  }));
}

function changedFields(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((k) => k !== "iri" && k !== "commit_message");
}

function firstLabel(labels: LocalizedString[], iri: string): string {
  return labels.find((l) => l.value.trim())?.value ?? localName(iri);
}

const ENTITY_TYPES: Record<string, { snippet: EntityType; label: string }> = {
  class: { snippet: "class", label: "class" },
  object_property: { snippet: "objectProperty", label: "object property" },
  data_property: { snippet: "dataProperty", label: "data property" },
  annotation_property: { snippet: "annotationProperty", label: "annotation property" },
  individual: { snippet: "individual", label: "individual" },
};

interface ClassDetailResponse {
  iri: string;
  labels: LocalizedString[];
  comments: LocalizedString[];
  deprecated: boolean;
  parent_iris: string[];
  equivalent_iris: string[];
  disjoint_iris: string[];
  annotations: { property_iri: string; values: LocalizedString[] }[];
}

const s = (input: Record<string, unknown>, key: string) => input[key] as string;
const opt = <T>(input: Record<string, unknown>, key: string): T | undefined => input[key] as T | undefined;

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "get_project",
    description: "Get the current project's metadata: name, description, ontology IRI and label preferences.",
    parameters: { type: "object", properties: {} },
    async run(_input, ctx) {
      const { data } = await call<Record<string, unknown>>(ctx, "GET", projectPath(ctx), { branch: false });
      const result = {
        id: data.id,
        name: data.name,
        description: data.description,
        ontology_iri: data.ontology_iri,
        label_preferences: data.label_preferences,
        created_at: data.created_at,
        updated_at: data.updated_at,
        branch: ctx.branch,
      };
      return { result, summary: `Loaded project ${String(data.name)}`, mutated: false };
    },
  },
  {
    name: "search_entities",
    description:
      "Search classes, properties and individuals by label, local name or IRI substring. Use query '*' to list every entity. Returns up to 50 matches for a text query.",
    parameters: {
      type: "object",
      properties: {
        query: str("Search text, or '*' to list all entities", { minLength: 1 }),
        entity_types: {
          type: "array",
          description: "Restrict to these entity kinds",
          items: { type: "string", enum: ["class", "property", "individual"] },
        },
      },
      required: ["query"],
    },
    async run(input, ctx) {
      const types = opt<string[]>(input, "entity_types");
      const { data } = await call<{ results: unknown[]; total: number }>(ctx, "GET", projectPath(ctx, "/ontology/search"), {
        query: { q: s(input, "query"), entity_types: types?.length ? types.join(",") : undefined },
      });
      return { result: data, summary: `Found ${data.total} entit${data.total === 1 ? "y" : "ies"}`, mutated: false };
    },
  },
  {
    name: "get_class_tree",
    description:
      "List root classes of the class hierarchy, or the direct subclasses of parent_iri. Each node has iri, label, child_count and deprecated.",
    parameters: {
      type: "object",
      properties: { parent_iri: str("IRI of the class whose direct subclasses to list. Omit for root classes.") },
    },
    async run(input, ctx) {
      const parent = opt<string>(input, "parent_iri");
      const path = parent ? `/ontology/tree/${enc(parent)}/children` : "/ontology/tree";
      const { data } = await call<{ nodes: unknown[]; total_classes: number }>(ctx, "GET", projectPath(ctx, path));
      const summary = parent
        ? `Listed ${data.nodes.length} subclasses of ${localName(parent)}`
        : `Listed ${data.nodes.length} root classes`;
      return { result: data, summary, mutated: false };
    },
  },
  {
    name: "get_entity",
    description:
      "Read one entity (class, property or individual) by IRI. Returns its type, structured detail (labels, comments, parents, domains, ranges, types, annotations...) and its raw Turtle block. Always call this before updating an entity.",
    parameters: { type: "object", properties: { iri: str("Full IRI of the entity") }, required: ["iri"] },
    async run(input, ctx) {
      const iri = s(input, "iri");
      const onto = await loadBranch(ctx);
      const store = onto.store;
      const kind = entityType(store, iri);
      if (!kind && store.countQuads(iri, null, null, null) === 0) throw new ToolError(`Entity not found: ${iri}`);
      let detail: unknown = null;
      let property_kind: string | null = null;
      if (kind === "class" && (hasType(store, iri, OWL_CLASS) || hasType(store, iri, RDFS_CLASS))) {
        detail = (await call(ctx, "GET", projectPath(ctx, `/ontology/classes/${enc(iri)}`))).data;
      } else if (kind === "property") {
        property_kind = propertyKind(store, iri);
        detail = snakeify(extractPropertyDetail(onto.content, iri));
      } else {
        detail = snakeify(extractIndividualDetail(onto.content, iri));
      }
      const result = {
        iri,
        entity_type: kind ?? "unknown",
        property_kind,
        detail,
        turtle: turtleBlock(onto.content, iri),
      };
      return { result, summary: `Read ${kind ?? "entity"} ${localName(iri)}`, mutated: false };
    },
  },
  {
    name: "get_entity_references",
    description:
      "Find everything that references an entity (as parent, domain, range, type, restriction filler, annotation value...). Use before deleting or renaming.",
    parameters: { type: "object", properties: { iri: str("Full IRI of the entity") }, required: ["iri"] },
    async run(input, ctx) {
      const iri = s(input, "iri");
      const { data } = await call<{ total: number }>(ctx, "GET", projectPath(ctx, `/entities/${enc(iri)}/references`));
      return { result: data, summary: `Found ${data.total} references to ${localName(iri)}`, mutated: false };
    },
  },
  {
    name: "get_source",
    description: "Read the full Turtle source of the ontology on the current branch.",
    parameters: { type: "object", properties: {} },
    async run(_input, ctx) {
      const { data } = await call<{ content: string; commit_hash: string; filename: string; branch: string }>(
        ctx,
        "GET",
        projectPath(ctx, "/source"),
      );
      return {
        result: { branch: data.branch, commit_hash: data.commit_hash, filename: data.filename, content: data.content },
        summary: `Read ${data.content.split("\n").length} lines of Turtle`,
        mutated: false,
      };
    },
  },
  {
    name: "list_revisions",
    description: "List recent commits across all branches, newest first. Each commit lists the branches that point at it.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer", description: "Maximum commits (1-200, default 20)", minimum: 1, maximum: 200 } },
    },
    async run(input, ctx) {
      const { data } = await call<{ commits: Record<string, unknown>[]; refs: Record<string, string[]> }>(
        ctx,
        "GET",
        projectPath(ctx, "/revisions"),
        { query: { limit: opt<number>(input, "limit") ?? 20 }, branch: false },
      );
      const commits = data.commits.map((c) => ({
        hash: c.hash,
        short_hash: c.short_hash,
        message: c.message,
        author_name: c.author_name,
        timestamp: c.timestamp,
        is_merge: c.is_merge,
        merged_branch: c.merged_branch,
        branches: data.refs[String(c.hash)] ?? [],
      }));
      return { result: { commits }, summary: `Listed ${commits.length} commits`, mutated: false };
    },
  },
  {
    name: "get_diff",
    description: "Show the textual diff of the ontology between two commits or branches.",
    parameters: {
      type: "object",
      properties: {
        from_version: str("Commit hash or branch name to diff from"),
        to_version: str("Commit hash or branch name to diff to. Defaults to HEAD."),
      },
      required: ["from_version"],
    },
    async run(input, ctx) {
      const { data } = await call<{ files_changed: number }>(ctx, "GET", projectPath(ctx, "/revisions/diff"), {
        query: { from_version: s(input, "from_version"), to_version: opt<string>(input, "to_version") },
        branch: false,
      });
      return {
        result: data,
        summary: `Diff ${s(input, "from_version")}..${opt<string>(input, "to_version") ?? "HEAD"}: ${data.files_changed} file(s) changed`,
        mutated: false,
      };
    },
  },
  {
    name: "create_entity",
    description:
      "Create a class, object property, data property, annotation property or individual. The IRI is generated from the ontology's default namespace and the label when omitted. parent_iri is the superclass for a class, the superproperty for a property, or the class (rdf:type) for an individual.",
    parameters: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          enum: Object.keys(ENTITY_TYPES),
          description: "Kind of entity to create",
        },
        label: str("rdfs:label (English)", { minLength: 1 }),
        iri: str("Explicit full IRI. Omit to generate one."),
        parent_iri: str("Parent class/property IRI, or the type class for an individual"),
        comment: str("Optional rdfs:comment (English)"),
        commit_message: COMMIT_MESSAGE,
      },
      required: ["entity_type", "label"],
    },
    async run(input, ctx) {
      const kind = ENTITY_TYPES[s(input, "entity_type")];
      const label = s(input, "label").trim();
      const onto = await loadBranch(ctx);
      const { namespace, prefix } = detectNamespace(onto.content, onto.store);
      let iri = opt<string>(input, "iri")?.trim();
      if (iri) {
        if (onto.store.countQuads(iri, null, null, null) > 0) throw new ToolError(`An entity with IRI ${iri} already exists`);
      } else {
        const base = namespace + (labelToLocalName(label) || uuidToBase62());
        iri = base;
        for (let n = 2; iriInUse(onto.store, iri); n++) iri = `${base}${n}`;
      }
      let snippet = generateTurtleSnippet({
        iri,
        label,
        entityType: kind.snippet,
        parentIri: opt<string>(input, "parent_iri") || undefined,
        ontologyPrefix: prefix,
        ontologyNamespace: namespace,
      });
      const comment = opt<string>(input, "comment");
      if (comment?.trim()) snippet = snippet.replace(/ \.\n$/, ` ;\n    rdfs:comment ${literal(comment, "en")} .\n`);
      const base = onto.content.endsWith("\n") ? onto.content : `${onto.content}\n`;
      const message = opt<string>(input, "commit_message") || `Add ${kind.label} ${label}`;
      const saved = await saveSource(ctx, base + snippet, message);
      return {
        result: { iri, entity_type: s(input, "entity_type"), label, commit_hash: saved.commit_hash, branch: saved.branch },
        summary: `Created ${kind.label} ${label}`,
        mutated: true,
      };
    },
  },
  {
    name: "update_class",
    description:
      "Update a class. Partial update: only the fields you pass are replaced; every omitted field keeps its current value. List fields replace the whole list, so include existing values you want to keep.",
    parameters: {
      type: "object",
      properties: {
        iri: str("Full IRI of the class"),
        labels: localizedArray("rdfs:label values"),
        comments: localizedArray("rdfs:comment values"),
        parent_iris: strArray("rdfs:subClassOf parent class IRIs"),
        annotations: ANNOTATIONS,
        deprecated: { type: "boolean", description: "owl:deprecated flag" },
        equivalent_iris: strArray("owl:equivalentClass IRIs"),
        disjoint_iris: strArray("owl:disjointWith IRIs"),
        commit_message: COMMIT_MESSAGE,
      },
      required: ["iri"],
    },
    async run(input, ctx) {
      const iri = s(input, "iri");
      const { data: cur } = await call<ClassDetailResponse>(ctx, "GET", projectPath(ctx, `/ontology/classes/${enc(iri)}`));
      const data: TurtleClassUpdateData = {
        labels: input.labels !== undefined ? toLocalized(input.labels) : cur.labels,
        comments: input.comments !== undefined ? toLocalized(input.comments) : cur.comments,
        parent_iris: opt<string[]>(input, "parent_iris") ?? cur.parent_iris,
        annotations:
          input.annotations !== undefined
            ? toAnnotations(input.annotations)
            : cur.annotations.map((a) => ({ property_iri: a.property_iri, values: a.values })),
        deprecated: opt<boolean>(input, "deprecated") ?? cur.deprecated,
        equivalent_iris: opt<string[]>(input, "equivalent_iris") ?? cur.equivalent_iris,
        disjoint_iris: opt<string[]>(input, "disjoint_iris") ?? cur.disjoint_iris,
      };
      const onto = await loadBranch(ctx);
      const updated = updateClassInTurtle(onto.content, iri, data);
      const label = firstLabel(data.labels, iri);
      const saved = await saveSource(ctx, updated, opt<string>(input, "commit_message") || `Update class ${label}`);
      return {
        result: { iri, updated_fields: changedFields(input), commit_hash: saved.commit_hash },
        summary: `Updated class ${label}`,
        mutated: true,
      };
    },
  },
  {
    name: "update_property",
    description:
      "Update an object, data or annotation property. Partial update: only the fields you pass are replaced; omitted fields keep their current values. List fields replace the whole list.",
    parameters: {
      type: "object",
      properties: {
        iri: str("Full IRI of the property"),
        property_type: { type: "string", enum: ["object", "data", "annotation"], description: "Change the property kind" },
        labels: localizedArray("rdfs:label values"),
        comments: localizedArray("rdfs:comment values"),
        definitions: localizedArray("skos:definition values"),
        domain_iris: strArray("rdfs:domain class IRIs"),
        range_iris: strArray("rdfs:range class or datatype IRIs"),
        parent_iris: strArray("rdfs:subPropertyOf IRIs"),
        inverse_of: { type: ["string", "null"], description: "owl:inverseOf property IRI, or null to clear" },
        characteristics: strArray(
          "Characteristic type IRIs, e.g. http://www.w3.org/2002/07/owl#FunctionalProperty, #TransitiveProperty, #SymmetricProperty",
        ),
        annotations: ANNOTATIONS,
        deprecated: { type: "boolean", description: "owl:deprecated flag" },
        equivalent_iris: strArray("owl:equivalentProperty IRIs"),
        disjoint_iris: strArray("owl:propertyDisjointWith IRIs"),
        see_also_iris: strArray("rdfs:seeAlso IRIs"),
        is_defined_by_iris: strArray("rdfs:isDefinedBy IRIs"),
        commit_message: COMMIT_MESSAGE,
      },
      required: ["iri"],
    },
    async run(input, ctx) {
      const iri = s(input, "iri");
      const onto = await loadBranch(ctx);
      const cur = extractPropertyDetail(onto.content, iri);
      if (!cur) throw new ToolError(`Property not found in the Turtle source: ${iri}`);
      const pick = <T>(key: string, fallback: T): T => (input[key] !== undefined ? (input[key] as T) : fallback);
      const data: TurtlePropertyUpdateData = {
        propertyType: pick<PropertyType>("property_type", cur.propertyType),
        labels: input.labels !== undefined ? toLocalized(input.labels) : cur.labels,
        comments: input.comments !== undefined ? toLocalized(input.comments) : cur.comments,
        definitions: input.definitions !== undefined ? toLocalized(input.definitions) : cur.definitions,
        domainIris: pick("domain_iris", cur.domainIris),
        rangeIris: pick("range_iris", cur.rangeIris),
        parentIris: pick("parent_iris", cur.parentIris),
        inverseOf: pick<string | null>("inverse_of", cur.inverseOf),
        characteristics: pick("characteristics", cur.characteristics),
        annotations: input.annotations !== undefined ? toAnnotations(input.annotations) : cur.annotations,
        deprecated: pick("deprecated", cur.deprecated),
        equivalentIris: pick("equivalent_iris", cur.equivalentIris),
        disjointIris: pick("disjoint_iris", cur.disjointIris),
        seeAlsoIris: pick("see_also_iris", cur.seeAlsoIris),
        isDefinedByIris: pick("is_defined_by_iris", cur.isDefinedByIris),
      };
      const updated = updatePropertyInTurtle(onto.content, iri, data);
      const label = firstLabel(data.labels, iri);
      const saved = await saveSource(ctx, updated, opt<string>(input, "commit_message") || `Update property ${label}`);
      return {
        result: { iri, updated_fields: changedFields(input), commit_hash: saved.commit_hash },
        summary: `Updated property ${label}`,
        mutated: true,
      };
    },
  },
  {
    name: "update_individual",
    description:
      "Update a named individual. Partial update: only the fields you pass are replaced; omitted fields keep their current values. List fields replace the whole list.",
    parameters: {
      type: "object",
      properties: {
        iri: str("Full IRI of the individual"),
        labels: localizedArray("rdfs:label values"),
        comments: localizedArray("rdfs:comment values"),
        definitions: localizedArray("skos:definition values"),
        type_iris: strArray("rdf:type class IRIs (owl:NamedIndividual is added automatically)"),
        same_as_iris: strArray("owl:sameAs IRIs"),
        different_from_iris: strArray("owl:differentFrom IRIs"),
        object_property_assertions: {
          type: "array",
          description: "Object property assertions (property -> target individual)",
          items: {
            type: "object",
            properties: { property_iri: str("Object property IRI"), target_iri: str("Target individual IRI") },
            required: ["property_iri", "target_iri"],
          },
        },
        data_property_assertions: {
          type: "array",
          description: "Data property assertions (property -> literal)",
          items: {
            type: "object",
            properties: {
              property_iri: str("Data property IRI"),
              value: str("Literal value"),
              lang: str("Optional language tag"),
              datatype: str("Optional datatype IRI, e.g. http://www.w3.org/2001/XMLSchema#integer"),
            },
            required: ["property_iri", "value"],
          },
        },
        annotations: ANNOTATIONS,
        deprecated: { type: "boolean", description: "owl:deprecated flag" },
        see_also_iris: strArray("rdfs:seeAlso IRIs"),
        is_defined_by_iris: strArray("rdfs:isDefinedBy IRIs"),
        commit_message: COMMIT_MESSAGE,
      },
      required: ["iri"],
    },
    async run(input, ctx) {
      const iri = s(input, "iri");
      const onto = await loadBranch(ctx);
      const cur = extractIndividualDetail(onto.content, iri);
      if (!cur) throw new ToolError(`Individual not found in the Turtle source: ${iri}`);
      const pick = <T>(key: string, fallback: T): T => (input[key] !== undefined ? (input[key] as T) : fallback);
      const data: TurtleIndividualUpdateData = {
        labels: input.labels !== undefined ? toLocalized(input.labels) : cur.labels,
        comments: input.comments !== undefined ? toLocalized(input.comments) : cur.comments,
        definitions: input.definitions !== undefined ? toLocalized(input.definitions) : cur.definitions,
        typeIris: pick("type_iris", cur.typeIris),
        sameAsIris: pick("same_as_iris", cur.sameAsIris),
        differentFromIris: pick("different_from_iris", cur.differentFromIris),
        objectPropertyAssertions:
          input.object_property_assertions !== undefined
            ? toAssertions(input.object_property_assertions)
            : cur.objectPropertyAssertions,
        dataPropertyAssertions:
          input.data_property_assertions !== undefined
            ? toAssertions(input.data_property_assertions)
            : cur.dataPropertyAssertions,
        annotations: input.annotations !== undefined ? toAnnotations(input.annotations) : cur.annotations,
        deprecated: pick("deprecated", cur.deprecated),
        seeAlsoIris: pick("see_also_iris", cur.seeAlsoIris),
        isDefinedByIris: pick("is_defined_by_iris", cur.isDefinedByIris),
      };
      const updated = updateIndividualInTurtle(onto.content, iri, data);
      const label = firstLabel(data.labels, iri);
      const saved = await saveSource(ctx, updated, opt<string>(input, "commit_message") || `Update individual ${label}`);
      return {
        result: { iri, updated_fields: changedFields(input), commit_hash: saved.commit_hash },
        summary: `Updated individual ${label}`,
        mutated: true,
      };
    },
  },
  {
    name: "delete_entity",
    description:
      "Delete a class, property or individual: removes every triple about it, every triple pointing at it, and anonymous expressions that mention it. Check get_entity_references first.",
    parameters: {
      type: "object",
      properties: { iri: str("Full IRI of the entity"), commit_message: COMMIT_MESSAGE },
      required: ["iri"],
    },
    async run(input, ctx) {
      const iri = s(input, "iri");
      await call(ctx, "DELETE", projectPath(ctx, `/ontology/entities/${enc(iri)}`), {
        query: { commit_message: opt<string>(input, "commit_message") },
      });
      return { result: { iri, deleted: true }, summary: `Deleted ${localName(iri)}`, mutated: true };
    },
  },
  {
    name: "edit_source",
    description:
      "Replace one exact snippet of the Turtle source. old_text must occur exactly once; include enough surrounding text to make it unique. Prefer the entity tools; use this for constructs they cannot express (restrictions, prefixes, ontology header).",
    parameters: {
      type: "object",
      properties: {
        old_text: str("Exact existing text to replace", { minLength: 1 }),
        new_text: str("Replacement text"),
        commit_message: str("Git commit message", { minLength: 1 }),
      },
      required: ["old_text", "new_text", "commit_message"],
    },
    async run(input, ctx) {
      const { data } = await call<{ content: string }>(ctx, "GET", projectPath(ctx, "/source"));
      const oldText = s(input, "old_text");
      const count = data.content.split(oldText).length - 1;
      if (count === 0) throw new ToolError("old_text was not found in the source");
      if (count > 1) throw new ToolError(`old_text occurs ${count} times; include more context so it is unique`);
      const idx = data.content.indexOf(oldText);
      const next = data.content.slice(0, idx) + s(input, "new_text") + data.content.slice(idx + oldText.length);
      const saved = await saveSource(ctx, next, s(input, "commit_message"));
      return { result: { commit_hash: saved.commit_hash }, summary: "Edited the Turtle source", mutated: true };
    },
  },
  {
    name: "replace_source",
    description:
      "Replace the entire Turtle source. Last resort for large restructurings; the content must be complete, valid Turtle.",
    parameters: {
      type: "object",
      properties: {
        content: str("Complete new Turtle source"),
        commit_message: str("Git commit message", { minLength: 1 }),
      },
      required: ["content", "commit_message"],
    },
    async run(input, ctx) {
      const saved = await saveSource(ctx, s(input, "content"), s(input, "commit_message"));
      return { result: { commit_hash: saved.commit_hash }, summary: "Replaced the Turtle source", mutated: true };
    },
  },
  {
    name: "run_lint",
    description:
      "Run the ontology linter on the project's default branch and wait for the results. Returns counts and the open issues.",
    parameters: { type: "object", properties: {} },
    async run(_input, ctx) {
      try {
        await call(ctx, "POST", projectPath(ctx, "/lint/run"));
      } catch (e) {
        if (!(e instanceof ToolError && e.message.endsWith("(HTTP 409)"))) throw e;
      }
      const status = await poll(ctx, "the lint run", async () => {
        const { data } = await call<{
          last_run: { status: string; error_message: string | null } | null;
          error_count: number;
          warning_count: number;
          info_count: number;
          total_issues: number;
        }>(ctx, "GET", projectPath(ctx, "/lint/status"));
        return data.last_run && !["pending", "running"].includes(data.last_run.status) ? data : undefined;
      });
      if (status.last_run?.status === "failed") throw new ToolError(`Lint run failed: ${status.last_run.error_message}`);
      const { data: issues } = await call<{ items: Record<string, unknown>[]; total: number }>(
        ctx,
        "GET",
        projectPath(ctx, "/lint/issues"),
        { query: { limit: 500 } },
      );
      const result = {
        error_count: status.error_count,
        warning_count: status.warning_count,
        info_count: status.info_count,
        total_issues: status.total_issues,
        issues: issues.items.map(lintIssue),
      };
      return {
        result,
        summary: `Lint found ${status.total_issues} issues (${status.error_count} errors, ${status.warning_count} warnings, ${status.info_count} info)`,
        mutated: false,
      };
    },
  },
  {
    name: "get_lint_issues",
    description: "List open issues from the most recent completed lint run.",
    parameters: {
      type: "object",
      properties: {
        issue_type: { type: "string", enum: ["error", "warning", "info"], description: "Filter by severity" },
        limit: { type: "integer", minimum: 1, maximum: 500, description: "Maximum issues (default 100)" },
      },
    },
    async run(input, ctx) {
      const { data } = await call<{ items: Record<string, unknown>[]; total: number }>(
        ctx,
        "GET",
        projectPath(ctx, "/lint/issues"),
        { query: { issue_type: opt<string>(input, "issue_type"), limit: opt<number>(input, "limit") } },
      );
      return {
        result: { total: data.total, issues: data.items.map(lintIssue) },
        summary: `Found ${data.total} lint issues`,
        mutated: false,
      };
    },
  },
  {
    name: "get_lint_config",
    description: "Get the project's lint configuration: preset level or custom enabled rules, plus the effective rules.",
    parameters: { type: "object", properties: {} },
    async run(_input, ctx) {
      const { data } = await call(ctx, "GET", projectPath(ctx, "/lint/config"));
      return { result: data, summary: "Read lint configuration", mutated: false };
    },
  },
  {
    name: "update_lint_config",
    description:
      "Change the lint configuration. Pass either lint_level (preset 1-5) or enabled_rules (custom list of rule ids), not both.",
    parameters: {
      type: "object",
      properties: {
        lint_level: { type: "integer", minimum: 1, maximum: 5, description: "Preset level 1-5" },
        enabled_rules: strArray("Rule ids to enable (see list_lint_rules)"),
      },
    },
    async run(input, ctx) {
      const body: Record<string, unknown> = {};
      if (input.lint_level !== undefined) body.lint_level = input.lint_level;
      if (input.enabled_rules !== undefined) body.enabled_rules = input.enabled_rules;
      const { data } = await call(ctx, "PUT", projectPath(ctx, "/lint/config"), { body });
      return { result: data, summary: "Updated lint configuration", mutated: true };
    },
  },
  {
    name: "list_lint_rules",
    description: "List every available lint rule with id, name, description, severity and scope.",
    parameters: { type: "object", properties: {} },
    async run(_input, ctx) {
      const { data } = await call<{ rules: unknown[] }>(ctx, "GET", "/projects/lint/rules", { branch: false });
      return { result: data, summary: `Listed ${data.rules.length} lint rules`, mutated: false };
    },
  },
  {
    name: "run_consistency_check",
    description:
      "Run the structural consistency check (cycles, orphan references, domain/range problems...) on the current branch and wait for the results.",
    parameters: { type: "object", properties: {} },
    async run(_input, ctx) {
      const result = await runJob(ctx, "/quality/check", "/quality/jobs", {});
      const issues = (result as { issues?: unknown[] }).issues;
      return {
        result,
        summary: `Consistency check found ${Array.isArray(issues) ? issues.length : 0} issues`,
        mutated: false,
      };
    },
  },
  {
    name: "find_duplicates",
    description: "Find likely duplicate entities by label similarity on the current branch and wait for the results.",
    parameters: {
      type: "object",
      properties: {
        threshold: { type: "number", minimum: 0.5, maximum: 1, description: "Similarity threshold 0.5-1.0 (default 0.85)" },
      },
    },
    async run(input, ctx) {
      const result = await runJob(ctx, "/quality/duplicates", "/quality/duplicates/jobs", {
        threshold: opt<number>(input, "threshold"),
      });
      const clusters = (result as { clusters?: unknown[] }).clusters;
      return {
        result,
        summary: `Found ${Array.isArray(clusters) ? clusters.length : 0} duplicate clusters`,
        mutated: false,
      };
    },
  },
  {
    name: "get_normalization_status",
    description: "Check whether the Turtle source differs from its canonical normalized form.",
    parameters: { type: "object", properties: {} },
    async run(_input, ctx) {
      const { data } = await call<{ needs_normalization: boolean | null }>(
        ctx,
        "GET",
        projectPath(ctx, "/normalization/status"),
      );
      const summary =
        data.needs_normalization === null
          ? "Normalization status unknown"
          : data.needs_normalization
            ? "Source needs normalization"
            : "Source is already normalized";
      return { result: data, summary, mutated: false };
    },
  },
  {
    name: "normalize",
    description:
      "Normalize the Turtle source into canonical form (sorted triples, standard formatting). With dry_run true nothing is committed and only the report is returned.",
    parameters: {
      type: "object",
      properties: { dry_run: { type: "boolean", description: "Preview only, without committing" } },
      required: ["dry_run"],
    },
    async run(input, ctx) {
      const dryRun = input.dry_run === true;
      const { data } = await call<Record<string, unknown>>(ctx, "POST", projectPath(ctx, "/normalization"), {
        body: { dry_run: dryRun },
      });
      const rest = { ...data };
      delete rest.original_content;
      delete rest.normalized_content;
      const committed = !dryRun && !!data.commit_hash;
      const changed = dryRun
        ? typeof data.original_content === "string" && typeof data.normalized_content === "string"
          ? data.original_content !== data.normalized_content
          : null
        : committed;
      const outcome =
        changed === false
          ? "No changes: the source is already in canonical form, so nothing was reordered or reformatted. The report notes are generic and do not apply."
          : dryRun
            ? "Preview only: normalizing would change the source. Nothing was committed."
            : "The source was rewritten into canonical form and committed.";
      return {
        result: { outcome, changed, ...rest },
        summary: dryRun
          ? changed === false
            ? "Previewed normalization: no changes needed"
            : "Previewed normalization"
          : committed
            ? "Normalized the source"
            : "Source was already normalized",
        mutated: committed,
      };
    },
  },
  {
    name: "update_project",
    description: "Rename the project or change its description. Also syncs the ontology title/description on the default branch.",
    parameters: {
      type: "object",
      properties: {
        name: str("New project name", { minLength: 1 }),
        description: str("New project description"),
      },
    },
    async run(input, ctx) {
      const body: Record<string, unknown> = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.description !== undefined) body.description = input.description;
      if (!Object.keys(body).length) throw new ToolError("Pass name and/or description");
      const { data } = await call<Record<string, unknown>>(ctx, "PATCH", projectPath(ctx), { body, branch: false });
      return {
        result: { id: data.id, name: data.name, description: data.description },
        summary: `Updated project ${String(data.name)}`,
        mutated: true,
      };
    },
  },
  {
    name: "list_branches",
    description: "List the project's git branches with their latest commit and ahead/behind counts versus the default branch.",
    parameters: { type: "object", properties: {} },
    async run(_input, ctx) {
      const { data } = await call<{ items: Record<string, unknown>[]; default_branch: string }>(
        ctx,
        "GET",
        projectPath(ctx, "/branches"),
        { branch: false },
      );
      const branches = data.items.map((b) => ({
        name: b.name,
        is_default: b.is_default,
        commit_hash: b.commit_hash,
        commit_message: b.commit_message,
        commit_date: b.commit_date,
        commits_ahead: b.commits_ahead,
        commits_behind: b.commits_behind,
        has_open_pr: b.has_open_pr,
      }));
      return {
        result: { default_branch: data.default_branch, current_branch: ctx.branch, branches },
        summary: `Listed ${branches.length} branches`,
        mutated: false,
      };
    },
  },
  {
    name: "create_branch",
    description: "Create a new git branch. It does not switch to it; call switch_branch to edit it.",
    parameters: {
      type: "object",
      properties: {
        name: str("New branch name", { minLength: 1 }),
        from_branch: str("Branch or commit to start from. Defaults to the current branch."),
      },
      required: ["name"],
    },
    async run(input, ctx) {
      const { data } = await call<Record<string, unknown>>(ctx, "POST", projectPath(ctx, "/branches"), {
        body: { name: s(input, "name"), from_branch: opt<string>(input, "from_branch") || ctx.branch },
        branch: false,
      });
      return {
        result: { name: data.name, commit_hash: data.commit_hash },
        summary: `Created branch ${String(data.name)}`,
        mutated: true,
      };
    },
  },
  {
    name: "switch_branch",
    description:
      "Switch which branch the following tool calls read and edit, for the rest of this reply. The next user message starts again on the branch open in the editor, which this does not change.",
    parameters: {
      type: "object",
      properties: { name: str("Existing branch name", { minLength: 1 }) },
      required: ["name"],
    },
    async run(input, ctx) {
      const name = s(input, "name");
      const { data } = await call<{ items: { name: string }[] }>(ctx, "GET", projectPath(ctx, "/branches"), {
        branch: false,
      });
      if (!data.items.some((b) => b.name === name)) throw new ToolError(`Branch "${name}" does not exist`);
      const previous = ctx.branch;
      ctx.branch = name;
      return {
        result: { previous_branch: previous, current_branch: name },
        summary: `Switched to branch ${name}`,
        mutated: false,
      };
    },
  },
  {
    name: "list_pull_requests",
    description: "List pull requests, newest first.",
    parameters: {
      type: "object",
      properties: { status: { type: "string", enum: ["open", "closed", "merged"], description: "Filter by status" } },
    },
    async run(input, ctx) {
      const { data } = await call<{ items: Record<string, unknown>[]; total: number }>(
        ctx,
        "GET",
        projectPath(ctx, "/pull-requests"),
        { query: { status: opt<string>(input, "status"), limit: 100 }, branch: false },
      );
      const prs = data.items.map(prSummary);
      return { result: { total: data.total, pull_requests: prs }, summary: `Listed ${prs.length} pull requests`, mutated: false };
    },
  },
  {
    name: "get_pull_request",
    description: "Get one pull request with its description, status, mergeability and comments.",
    parameters: {
      type: "object",
      properties: { number: { type: "integer", minimum: 1, description: "Pull request number" } },
      required: ["number"],
    },
    async run(input, ctx) {
      const n = input.number as number;
      const { data } = await call<Record<string, unknown>>(ctx, "GET", projectPath(ctx, `/pull-requests/${n}`), {
        branch: false,
      });
      const { data: comments } = await call<unknown>(ctx, "GET", projectPath(ctx, `/pull-requests/${n}/comments`), {
        branch: false,
      });
      return {
        result: { ...prSummary(data), description: data.description, comments },
        summary: `Read pull request #${n}`,
        mutated: false,
      };
    },
  },
  {
    name: "create_pull_request",
    description: "Open a pull request to merge source_branch into target_branch (defaults to the project's default branch).",
    parameters: {
      type: "object",
      properties: {
        title: str("Title", { minLength: 1 }),
        description: str("Markdown description of the changes"),
        source_branch: str("Branch with the changes", { minLength: 1 }),
        target_branch: str("Branch to merge into"),
      },
      required: ["title", "source_branch"],
    },
    async run(input, ctx) {
      let target = opt<string>(input, "target_branch");
      if (!target) {
        const { data } = await call<{ default_branch: string }>(ctx, "GET", projectPath(ctx, "/branches"), { branch: false });
        target = data.default_branch;
      }
      const { data } = await call<Record<string, unknown>>(ctx, "POST", projectPath(ctx, "/pull-requests"), {
        body: {
          title: s(input, "title"),
          description: opt<string>(input, "description"),
          source_branch: s(input, "source_branch"),
          target_branch: target,
        },
        branch: false,
      });
      return { result: prSummary(data), summary: `Opened pull request #${String(data.pr_number)}`, mutated: true };
    },
  },
  {
    name: "merge_pull_request",
    description: "Merge an open pull request.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "integer", minimum: 1, description: "Pull request number" },
        merge_message: str("Merge commit message"),
        delete_source_branch: { type: "boolean", description: "Delete the source branch after merging" },
      },
      required: ["number"],
    },
    async run(input, ctx) {
      const n = input.number as number;
      const { data } = await call(ctx, "POST", projectPath(ctx, `/pull-requests/${n}/merge`), {
        body: { merge_message: opt<string>(input, "merge_message"), delete_source_branch: input.delete_source_branch === true },
        branch: false,
      });
      return { result: data, summary: `Merged pull request #${n}`, mutated: true };
    },
  },
  {
    name: "close_pull_request",
    description: "Close an open pull request without merging.",
    parameters: {
      type: "object",
      properties: { number: { type: "integer", minimum: 1, description: "Pull request number" } },
      required: ["number"],
    },
    async run(input, ctx) {
      const n = input.number as number;
      const { data } = await call<Record<string, unknown>>(ctx, "POST", projectPath(ctx, `/pull-requests/${n}/close`), {
        branch: false,
      });
      return { result: prSummary(data), summary: `Closed pull request #${n}`, mutated: true };
    },
  },
  {
    name: "comment_on_pull_request",
    description: "Add a comment to a pull request.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "integer", minimum: 1, description: "Pull request number" },
        body: str("Comment text (Markdown)", { minLength: 1 }),
      },
      required: ["number", "body"],
    },
    async run(input, ctx) {
      const n = input.number as number;
      const { data } = await call<Record<string, unknown>>(ctx, "POST", projectPath(ctx, `/pull-requests/${n}/comments`), {
        body: { body: s(input, "body") },
        branch: false,
      });
      return { result: { id: data.id, created_at: data.created_at }, summary: `Commented on pull request #${n}`, mutated: true };
    },
  },
];

function lintIssue(i: Record<string, unknown>) {
  return {
    id: i.id,
    issue_type: i.issue_type,
    rule_id: i.rule_id,
    message: i.message,
    subject_iri: i.subject_iri,
    subject_type: i.subject_type,
    details: i.details,
  };
}

function prSummary(p: Record<string, unknown>) {
  return {
    number: p.pr_number,
    title: p.title,
    status: p.status,
    source_branch: p.source_branch,
    target_branch: p.target_branch,
    created_at: p.created_at,
    merged_at: p.merged_at,
    can_merge: p.can_merge,
    commits_ahead: p.commits_ahead,
    comment_count: p.comment_count,
  };
}

async function runJob(ctx: ToolContext, startPath: string, jobsPath: string, query: Query): Promise<unknown> {
  const { data } = await call<{ job_id: string }>(ctx, "POST", projectPath(ctx, startPath), { query });
  return poll(ctx, "the job", async () => {
    const res = await call(ctx, "GET", projectPath(ctx, `${jobsPath}/${encodeURIComponent(data.job_id)}`));
    return res.status === 202 ? undefined : res.data;
  });
}

const TOOL_MAP = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function openAiTools(): ChatCompletionFunctionTool[] {
  return AGENT_TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
  }));
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
  if (e instanceof Error) return e.message;
  return String(e);
}

function failure(input: Record<string, unknown> | null, message: string): ToolExecution {
  return { input, content: JSON.stringify({ error: message }), is_error: true, summary: oneLine(message), mutated: false };
}

export function parseToolArguments(raw: string): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw.trim()) return { ok: true, input: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return { ok: false, error: "Tool arguments must be a JSON object" };
    return { ok: true, input: parsed as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: `Invalid JSON arguments: ${(e as Error).message}` };
  }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolExecution> {
  const tool = TOOL_MAP.get(name);
  if (!tool) return failure(input, `Unknown tool: ${name}`);
  const errors = validateJson(tool.parameters, input);
  if (errors.length) return failure(input, `Invalid input for ${name}: ${errors.join("; ")}`);
  try {
    const out = await tool.run(input, ctx);
    return {
      input,
      content: JSON.stringify(out.result ?? null),
      is_error: false,
      summary: oneLine(out.summary),
      mutated: out.mutated,
    };
  } catch (e) {
    return failure(input, errorMessage(e));
  }
}
