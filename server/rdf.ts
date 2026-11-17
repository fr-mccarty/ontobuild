import { DataFactory, Parser, Store, Writer, type Quad, type Term } from "n3";
import { Readable } from "node:stream";
import { RDF_EXTENSION_FORMATS, RDF_FILE_EXTENSIONS, type RdfFormat } from "@/lib/ontology/rdfFormats";

export type { RdfFormat };

export { DataFactory, Store };
export type { Quad, Term };

export const NS = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  skos: "http://www.w3.org/2004/02/skos/core#",
  dc: "http://purl.org/dc/elements/1.1/",
  dcterms: "http://purl.org/dc/terms/",
  foaf: "http://xmlns.com/foaf/0.1/",
  vann: "http://purl.org/vocab/vann/",
} as const;

export const WELL_KNOWN_PREFIXES: Record<string, string> = { ...NS };

export const FORMAT_NAMES: Record<RdfFormat, string> = {
  turtle: "Turtle",
  n3: "Notation3",
  ntriples: "N-Triples",
  nquads: "N-Quads",
  trig: "TriG",
  rdfxml: "RDF/XML",
  jsonld: "JSON-LD",
};

export const SUPPORTED_EXTENSIONS = RDF_FILE_EXTENSIONS;

export class RdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RdfParseError";
  }
}

export function extensionOf(filename: string): string {
  const m = /\.[^./\\]+$/.exec(filename);
  return m ? m[0].toLowerCase() : "";
}

export function formatFromFilename(filename: string): RdfFormat | null {
  return RDF_EXTENSION_FORMATS[extensionOf(filename)] ?? null;
}

export interface ParsedRdf {
  store: Store;
  prefixes: Record<string, string>;
  quads: Quad[];
}

function n3Format(format: RdfFormat): string {
  return { turtle: "Turtle", n3: "N3", ntriples: "N-Triples", nquads: "N-Quads", trig: "TriG" }[
    format as "turtle"
  ];
}

export function parseTurtle(content: string, opts: { baseIRI?: string; format?: RdfFormat } = {}): ParsedRdf {
  const prefixes: Record<string, string> = {};
  let quads: Quad[];
  try {
    const parser = new Parser({ baseIRI: opts.baseIRI, format: n3Format(opts.format ?? "turtle") });
    quads = parser.parse(content, null, (prefix, iri) => {
      prefixes[prefix] = iri.value;
    });
  } catch (e) {
    throw new RdfParseError((e as Error).message);
  }
  return { store: new Store(quads), prefixes, quads };
}

export async function parseRdf(
  content: string,
  format: RdfFormat,
  opts: { baseIRI?: string } = {},
): Promise<ParsedRdf> {
  if (format === "rdfxml") return parseRdfXml(content, opts.baseIRI);
  if (format === "jsonld") return parseJsonLd(content, opts.baseIRI);
  return parseTurtle(content, { baseIRI: opts.baseIRI, format });
}

async function parseRdfXml(content: string, baseIRI?: string): Promise<ParsedRdf> {
  const { RdfXmlParser } = await import("rdfxml-streaming-parser");
  const quads: Quad[] = [];
  await new Promise<void>((resolve, reject) => {
    const parser = new RdfXmlParser({ baseIRI: baseIRI ?? "http://example.org/base#" });
    parser.on("data", (q: Quad) => quads.push(q));
    parser.on("error", (e: Error) => reject(new RdfParseError(e.message)));
    parser.on("end", () => resolve());
    Readable.from([content]).pipe(parser);
  });
  const prefixes: Record<string, string> = {};
  for (const m of content.matchAll(/xmlns:([A-Za-z_][\w.-]*)\s*=\s*["']([^"']+)["']/g)) {
    prefixes[m[1]] = m[2];
  }
  const store = new Store();
  for (const q of quads) store.addQuad(toN3(q.subject), toN3(q.predicate), toN3(q.object));
  return { store, prefixes, quads: store.getQuads(null, null, null, null) };
}

async function parseJsonLd(content: string, baseIRI?: string): Promise<ParsedRdf> {
  const jsonld = (await import("jsonld")).default;
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch (e) {
    throw new RdfParseError(`Invalid JSON: ${(e as Error).message}`);
  }
  let nquads: string;
  try {
    nquads = (await jsonld.toRDF(doc as never, { format: "application/n-quads", base: baseIRI })) as unknown as string;
  } catch (e) {
    throw new RdfParseError((e as Error).message);
  }
  const parsed = parseTurtle(nquads, { format: "nquads" });
  const ctx = (doc as { "@context"?: unknown })?.["@context"];
  if (ctx && typeof ctx === "object" && !Array.isArray(ctx)) {
    for (const [k, v] of Object.entries(ctx as Record<string, unknown>)) {
      if (typeof v === "string" && /[#/]$/.test(v) && !k.startsWith("@")) parsed.prefixes[k] = v;
    }
  }
  const store = new Store();
  for (const q of parsed.quads) store.addQuad(q.subject, q.predicate, q.object);
  return { store, prefixes: parsed.prefixes, quads: store.getQuads(null, null, null, null) };
}

function toN3(t: Term): never {
  const { namedNode, blankNode, literal } = DataFactory;
  if (t.termType === "NamedNode") return namedNode(t.value) as never;
  if (t.termType === "BlankNode") return blankNode(t.value) as never;
  if (t.termType === "Literal") {
    const l = t as unknown as { value: string; language: string; datatype: Term };
    return literal(l.value, l.language || namedNode(l.datatype.value)) as never;
  }
  return t as never;
}

const RDF_TYPE = NS.rdf + "type";
const RDF_FIRST = NS.rdf + "first";
const RDF_REST = NS.rdf + "rest";
const RDF_NIL = NS.rdf + "nil";
const OWL_ONTOLOGY = NS.owl + "Ontology";
const XSD_STRING = NS.xsd + "string";

export function findOntologyIri(store: Store): string | null {
  for (const q of store.getQuads(null, RDF_TYPE, OWL_ONTOLOGY, null)) {
    if (q.subject.termType === "NamedNode") return q.subject.value;
  }
  return null;
}

export async function serializeTurtle(
  input: Store | Quad[],
  prefixes: Record<string, string> = {},
): Promise<string> {
  const store = input instanceof Store ? input : new Store(input);
  const quads = store.getQuads(null, null, null, null);

  const nsToPrefix = new Map<string, string>();
  const taken = new Set<string>();
  for (const [p, ns] of Object.entries(WELL_KNOWN_PREFIXES)) {
    nsToPrefix.set(ns, p);
    taken.add(p);
  }
  for (const [p, ns] of Object.entries(prefixes)) {
    if (!ns || nsToPrefix.has(ns) || taken.has(p)) continue;
    nsToPrefix.set(ns, p);
    taken.add(p);
  }
  const nsList = [...nsToPrefix.keys()].sort((a, b) => b.length - a.length);
  const usedPrefixes = new Map<string, string>();
  const LOCAL_RE = /^(?:[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?)?$/;

  const bnodeLabels = new Map<string, string>();
  const bnodeLabel = (v: string) => {
    if (!bnodeLabels.has(v)) bnodeLabels.set(v, `b${bnodeLabels.size}`);
    return `_:${bnodeLabels.get(v)}`;
  };

  const iri = (v: string): string => {
    for (const ns of nsList) {
      if (v.startsWith(ns)) {
        const local = v.slice(ns.length);
        if (LOCAL_RE.test(local)) {
          const p = nsToPrefix.get(ns)!;
          usedPrefixes.set(p, ns);
          return `${p}:${local}`;
        }
      }
    }
    return `<${v.replace(/[\x00-\x20<>"{}|^`\\]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))}>`;
  };

  const str = (v: string): string => {
    if (v.includes("\n")) {
      return '"""' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r") + '"""';
    }
    return (
      '"' +
      v.replace(/[\\"\n\r\t]/g, (c) => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t" })[c]!) +
      '"'
    );
  };

  const literal = (t: Term): string => {
    const l = t as unknown as { value: string; language: string; datatype: Term };
    const dt = l.language ? XSD_STRING : (l.datatype?.value ?? XSD_STRING);
    if (dt === XSD_STRING || dt === NS.rdf + "langString") return str(l.value);
    if (dt === NS.xsd + "integer" && /^[+-]?\d+$/.test(l.value)) return l.value;
    if (dt === NS.xsd + "boolean" && /^(true|false)$/.test(l.value)) return l.value;
    if (dt === NS.xsd + "decimal" && /^[+-]?\d*\.\d+$/.test(l.value)) return l.value;
    return `${str(l.value)}^^${iri(dt)}`;
  };

  const bySubject = new Map<string, Quad[]>();
  const objectRefs = new Map<string, number>();
  for (const q of quads) {
    const key = termKey(q.subject);
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key)!.push(q);
    if (q.object.termType === "BlankNode") objectRefs.set(q.object.value, (objectRefs.get(q.object.value) ?? 0) + 1);
  }
  const inlineable = (b: string) => objectRefs.get(b) === 1;
  const emitted = new Set<string>();

  const listItems = (b: string): Term[] | null => {
    const items: Term[] = [];
    let cur = b;
    const seen = new Set<string>();
    for (;;) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      const qs = bySubject.get("_:" + cur) ?? [];
      if (qs.length !== 2) return null;
      const first = qs.find((q) => q.predicate.value === RDF_FIRST);
      const rest = qs.find((q) => q.predicate.value === RDF_REST);
      if (!first || !rest) return null;
      if (cur !== b && !inlineable(cur)) return null;
      items.push(first.object);
      if (rest.object.termType === "NamedNode" && rest.object.value === RDF_NIL) break;
      if (rest.object.termType !== "BlankNode") return null;
      cur = rest.object.value;
    }
    return items;
  };

  const pad = (n: number) => "    ".repeat(n);

  const object = (o: Term, indent: number): string => {
    if (o.termType === "Literal") return literal(o);
    if (o.termType === "NamedNode") return iri(o.value);
    if (o.termType !== "BlankNode") return iri(o.value);
    const key = "_:" + o.value;
    if (!inlineable(o.value) || emitted.has(key) || indent > 60) return bnodeLabel(o.value);
    const items = listItems(o.value);
    if (items) {
      let cur: string | null = o.value;
      while (cur) {
        emitted.add("_:" + cur);
        const rest: Quad | undefined = (bySubject.get("_:" + cur) ?? []).find((q) => q.predicate.value === RDF_REST);
        cur = rest && rest.object.termType === "BlankNode" ? rest.object.value : null;
      }
      return `(${items.map((i) => object(i, indent)).join(" ")})`;
    }
    emitted.add(key);
    const qs = bySubject.get(key) ?? [];
    if (!qs.length) return "[]";
    return `[\n${predicateBlock(qs, indent + 1)}\n${pad(indent)}]`;
  };

  const predicateBlock = (qs: Quad[], indent: number): string => {
    const lines: string[] = [];
    let curPred: string | null = null;
    let objs: string[] = [];
    const flush = () => {
      if (curPred !== null) lines.push(`${pad(indent)}${curPred} ${objs.join(", ")}`);
    };
    for (const q of sortPreds(qs)) {
      const pred = q.predicate.value === RDF_TYPE ? "a" : iri(q.predicate.value);
      if (pred !== curPred) {
        flush();
        curPred = pred;
        objs = [];
      }
      objs.push(object(q.object, indent));
    }
    flush();
    return lines.join(" ;\n");
  };

  const subjectBlock = (key: string): string => {
    const qs = bySubject.get(key)!;
    const subj = key.startsWith("_:") ? bnodeLabel(key.slice(2)) : iri(key);
    return `${subj} ${predicateBlock(qs, 1).trimStart()} .`;
  };

  const ontologyIri = findOntologyIri(store);
  const subjects = [...bySubject.keys()].sort((a, b) => {
    const ra = subjectRank(a, ontologyIri);
    const rb = subjectRank(b, ontologyIri);
    return ra !== rb ? ra - rb : a < b ? -1 : a > b ? 1 : 0;
  });

  const blocks: string[] = [];
  for (const key of subjects) {
    if (emitted.has(key)) continue;
    if (key.startsWith("_:") && inlineable(key.slice(2))) continue;
    emitted.add(key);
    blocks.push(subjectBlock(key));
  }
  for (const key of subjects) {
    if (emitted.has(key)) continue;
    emitted.add(key);
    blocks.push(subjectBlock(key));
  }

  const header = [...usedPrefixes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([p, ns]) => `@prefix ${p}: <${ns}> .`)
    .join("\n");
  return (header ? header + "\n\n" : "") + blocks.join("\n\n") + "\n";
}

function termKey(t: Term): string {
  return t.termType === "BlankNode" ? "_:" + t.value : t.value;
}

function subjectRank(key: string, ontologyIri: string | null): number {
  if (ontologyIri && key === ontologyIri) return 0;
  if (key.startsWith("_:")) return 2;
  return 1;
}

function sortPreds(qs: Quad[]): Quad[] {
  return [...qs].sort((a, b) => {
    const at = a.predicate.value === RDF_TYPE ? 0 : 1;
    const bt = b.predicate.value === RDF_TYPE ? 0 : 1;
    if (at !== bt) return at - bt;
    if (a.predicate.value !== b.predicate.value) return a.predicate.value < b.predicate.value ? -1 : 1;
    const ao = objectSortKey(a.object);
    const bo = objectSortKey(b.object);
    return ao < bo ? -1 : ao > bo ? 1 : 0;
  });
}

function objectSortKey(t: Term): string {
  if (t.termType === "Literal") return `2${t.value}`;
  return (t.termType === "NamedNode" ? "0" : "1") + t.value;
}

export function stripLanguageTags(store: Store): number {
  let count = 0;
  for (const q of store.getQuads(null, null, null, null)) {
    if (q.object.termType !== "Literal" || !(q.object as unknown as { language: string }).language) continue;
    store.removeQuad(q);
    store.addQuad(q.subject, q.predicate, DataFactory.literal(q.object.value), q.graph);
    count++;
  }
  return count;
}

export async function stripLanguageTagsFromTurtle(content: string): Promise<{ content: string; removed: number }> {
  if (!/["']@[A-Za-z]/.test(content)) return { content, removed: 0 };
  const parsed = parseTurtle(content);
  const removed = stripLanguageTags(parsed.store);
  if (!removed) return { content, removed: 0 };
  return { content: await serializeTurtle(parsed.store, parsed.prefixes), removed };
}

export async function normalizeToTurtle(
  content: string,
  filename: string,
): Promise<{
  turtle: string;
  store: Store;
  format: RdfFormat;
  prefixesBefore: string[];
  prefixesAfter: string[];
  languageTagsRemoved: number;
}> {
  const format = formatFromFilename(filename);
  if (!format) {
    throw new RdfParseError(
      `Unsupported file format: ${extensionOf(filename)}. Supported formats: ${SUPPORTED_EXTENSIONS.join(", ")}`,
    );
  }
  const parsed = await parseRdf(content, format);
  const languageTagsRemoved = stripLanguageTags(parsed.store);
  const turtle = await serializeTurtle(parsed.store, parsed.prefixes);
  const after = parseTurtle(turtle).prefixes;
  return {
    turtle,
    store: parsed.store,
    format,
    prefixesBefore: Object.keys(parsed.prefixes).filter(Boolean).sort(),
    prefixesAfter: Object.keys(after).filter(Boolean).sort(),
    languageTagsRemoved,
  };
}

function hasBlankNode(q: Quad): boolean {
  return q.subject.termType === "BlankNode" || q.object.termType === "BlankNode" || q.graph.termType === "BlankNode";
}

/**
 * Whether two graphs hold the same triples: RDF graph isomorphism, so blank nodes match by
 * structure rather than by label. Triples without blank nodes are compared directly; the rest
 * are put in canonical form (URDNA2015, through jsonld) and compared.
 */
export async function sameGraph(a: Store, b: Store): Promise<boolean> {
  if (a.size !== b.size) return false;
  const writer = new Writer({ format: "N-Quads" });
  const split = (s: Store) => {
    const ground: string[] = [];
    const blank: Quad[] = [];
    for (const q of s.getQuads(null, null, null, null)) {
      if (hasBlankNode(q)) blank.push(q);
      else ground.push(writer.quadToString(q.subject, q.predicate, q.object, q.graph));
    }
    return { ground: ground.sort(), blank };
  };
  const x = split(a);
  const y = split(b);
  if (x.blank.length !== y.blank.length) return false;
  for (let i = 0; i < x.ground.length; i++) if (x.ground[i] !== y.ground[i]) return false;
  if (!x.blank.length) return true;
  const jsonld = (await import("jsonld")).default;
  const canonical = (quads: Quad[]) =>
    jsonld.canonize(writer.quadsToString(quads) as never, {
      algorithm: "URDNA2015",
      inputFormat: "application/n-quads",
      format: "application/n-quads",
    });
  return (await canonical(x.blank)) === (await canonical(y.blank));
}

/** What changed when a file was normalized to Turtle (stored as `projects.normalization_report`). */
export interface ImportNormalizationReport {
  original_format: string;
  original_filename: string;
  original_size_bytes: number;
  normalized_size_bytes: number;
  triple_count: number;
  prefixes_before: string[];
  prefixes_after: string[];
  prefixes_removed: string[];
  prefixes_added: string[];
  format_converted: boolean;
  notes: string[];
}

/** Describes a normalizeToTurtle result, for imports (uploaded files and files cloned from a repository). */
export function importNormalizationReport(
  original: string,
  filename: string,
  normalized: Awaited<ReturnType<typeof normalizeToTurtle>>,
): ImportNormalizationReport {
  const format = normalized.format;
  const before = new Set(normalized.prefixesBefore);
  const after = new Set(normalized.prefixesAfter);
  const removed = normalized.prefixesBefore.filter((p) => !after.has(p));
  const added = normalized.prefixesAfter.filter((p) => !before.has(p));
  const originalSize = Buffer.byteLength(original);
  const normalizedSize = Buffer.byteLength(normalized.turtle);
  const notes: string[] = [];
  if (format !== "turtle") notes.push(`Converted from ${FORMAT_NAMES[format]} to Turtle format`);
  if (removed.length) notes.push(`Removed ${removed.length} unused prefix(es): ${removed.join(", ")}`);
  if (added.length) notes.push(`Added ${added.length} prefix(es): ${added.join(", ")}`);
  if (normalized.languageTagsRemoved > 0) notes.push(`Removed language tags from ${normalized.languageTagsRemoved} literal(s)`);
  const diff = normalizedSize - originalSize;
  if (diff < 0) notes.push(`File size reduced by ${Math.abs(diff).toLocaleString("en-US")} bytes`);
  else if (diff > 0) notes.push(`File size increased by ${diff.toLocaleString("en-US")} bytes`);
  notes.push("Triples reordered into canonical sequence");
  notes.push("Whitespace and formatting standardized");
  return {
    original_format: FORMAT_NAMES[format],
    original_filename: filename,
    original_size_bytes: originalSize,
    normalized_size_bytes: normalizedSize,
    triple_count: normalized.store.size,
    prefixes_before: normalized.prefixesBefore,
    prefixes_after: normalized.prefixesAfter,
    prefixes_removed: removed,
    prefixes_added: added,
    format_converted: format !== "turtle",
    notes,
  };
}

const TITLE_PROPS = [NS.dc + "title", NS.dcterms + "title", NS.rdfs + "label"];
const DESC_PROPS = [NS.dc + "description", NS.dcterms + "description", NS.rdfs + "comment"];

function firstOntologyLiteral(store: Store, props: string[]): string | null {
  const ontologies = store.getSubjects(RDF_TYPE, OWL_ONTOLOGY, null).filter((s) => s.termType === "NamedNode");
  for (const s of ontologies) {
    for (const p of props) {
      for (const o of store.getObjects(s, p, null)) if (o.value) return o.value;
    }
  }
  return null;
}

/** The ontology's IRI (when it is an http(s) or urn IRI), title and description, for a new project. */
export function ontologyMetadata(store: Store): { iri: string | null; title: string | null; description: string | null } {
  const iri = findOntologyIri(store);
  return {
    iri: iri && /^(https?:\/\/|urn:)\S+$/.test(iri) ? iri : null,
    title: firstOntologyLiteral(store, TITLE_PROPS),
    description: firstOntologyLiteral(store, DESC_PROPS),
  };
}
