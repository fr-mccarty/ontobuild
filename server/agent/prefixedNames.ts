/**
 * Lets the agent pass prefixed names (`:Pizza`, `ex:Pizza`, `owl:FunctionalProperty`)
 * wherever a tool expects an IRI. They are expanded with the prefixes declared in the
 * branch's Turtle file, falling back to well-known vocabularies (owl, rdfs, xsd...).
 * Full IRIs pass through unchanged, and only IRI-valued fields are touched: labels,
 * comments, annotation values and free text are never rewritten.
 */
import type { PrefixMap } from "@/lib/ontology/turtleUtils";

/** Field names whose string values (or string-array items) are IRIs. */
export function isIriField(key: string): boolean {
  return (
    key === "iri" ||
    key.endsWith("_iri") ||
    key.endsWith("_iris") ||
    key === "inverse_of" ||
    key === "characteristics" ||
    key === "datatype"
  );
}

/** URI schemes that look like `prefix:local` but are already full IRIs. */
const URI_SCHEMES = new Set(["http", "https", "urn", "mailto", "tag", "file", "ftp", "data", "did", "doi", "info", "uuid"]);

const PREFIXED_NAME = /^([A-Za-z][\w.-]*)?:([^\s<>"{}|^`\\]*)$/;

type Classified = { kind: "full" } | { kind: "prefixed"; prefix: string; local: string };

function classify(value: string): Classified {
  const v = value.trim();
  if (v.startsWith("<") && v.endsWith(">")) return { kind: "full" };
  const m = v.match(PREFIXED_NAME);
  if (!m) return { kind: "full" };
  const prefix = m[1] ?? "";
  if (URI_SCHEMES.has(prefix.toLowerCase()) || m[2].startsWith("//")) return { kind: "full" };
  return { kind: "prefixed", prefix, local: m[2] };
}

/** True when some IRI field holds a prefixed name or `<...>`, so the caller knows to load the file's prefixes. */
export function hasPrefixedIris(input: unknown): boolean {
  let found = false;
  walk(input, (v) => {
    const t = v.trim();
    if (classify(t).kind === "prefixed" || (t.startsWith("<") && t.endsWith(">"))) found = true;
    return v;
  });
  return found;
}

/**
 * Returns a copy of `input` with prefixed names in IRI fields expanded. A prefix that
 * is neither declared nor well known is reported in `errors` rather than guessed.
 */
export function expandPrefixedIris<T>(
  input: T,
  prefixes: PrefixMap,
  fallback: PrefixMap = {},
): { input: T; errors: string[] } {
  const errors: string[] = [];
  const out = walk(input, (value, path) => {
    const t = value.trim();
    if (t.startsWith("<") && t.endsWith(">")) return t.slice(1, -1);
    const c = classify(t);
    if (c.kind === "full") return value;
    const ns = prefixes[c.prefix] ?? fallback[c.prefix];
    if (ns === undefined) {
      errors.push(
        `${path}: unknown prefix "${c.prefix}:" in "${t}". Use a prefix declared in the ontology file or a full IRI.`,
      );
      return value;
    }
    return ns + c.local;
  });
  return { input: out as T, errors };
}

function walk(value: unknown, fn: (s: string, path: string) => string, path = "", iriContext = false): unknown {
  if (typeof value === "string") return iriContext ? fn(value, path) : value;
  if (Array.isArray(value)) return value.map((v, i) => walk(v, fn, `${path}[${i}]`, iriContext));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, walk(v, fn, path ? `${path}.${k}` : k, isIriField(k))]),
    );
  }
  return value;
}
