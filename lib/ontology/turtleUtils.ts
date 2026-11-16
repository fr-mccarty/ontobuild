export interface PrefixMap {
  [alias: string]: string;
}

export interface ParsedDeclarations {
  prefixes: PrefixMap;
  base?: string;
}

export interface BlockRange {
  startLine: number;
  endLine: number;
}

export function parseDeclarations(source: string): ParsedDeclarations {
  const prefixes: PrefixMap = {};
  let base: string | undefined;

  for (const line of source.split("\n")) {
    const pm = line.match(/@?prefix\s+(\w*):\s*<([^>]+)>/i);
    if (pm) prefixes[pm[1]] = pm[2];

    const bm = line.match(/@?base\s+<([^>]+)>/i);
    if (bm) base = bm[1];
  }

  return { prefixes, base };
}

export function reverseMap(prefixes: PrefixMap): Map<string, string> {
  const rev = new Map<string, string>();
  for (const [alias, ns] of Object.entries(prefixes)) {
    const existing = rev.get(ns);
    if (!existing || alias.length < existing.length) {
      rev.set(ns, alias);
    }
  }
  return rev;
}

/**
 * Writes an IRI as a prefixed name when a declared prefix covers it and the rest is a
 * safe Turtle local name; otherwise as a full `<...>` IRI. The longest matching
 * namespace wins, so `ex:` and a more specific `exs:` resolve predictably.
 */
export function toTurtle(iri: string, rev: Map<string, string>): string {
  let best: { ns: string; alias: string } | undefined;
  for (const [ns, alias] of rev) {
    if (!ns || !iri.startsWith(ns) || (best && best.ns.length >= ns.length)) continue;
    if (SAFE_LOCAL_NAME.test(iri.slice(ns.length))) best = { ns, alias };
  }
  return best ? `${best.alias}:${iri.slice(best.ns.length)}` : `<${iri}>`;
}

/** A conservative subset of Turtle's PN_LOCAL: no escapes, dots or colons needed. */
const SAFE_LOCAL_NAME = /^[A-Za-z_][\w-]*$/;

export function iriTurtleForms(
  iri: string,
  prefixes: PrefixMap,
  base?: string,
): string[] {
  const forms = [`<${iri}>`];

  for (const [alias, ns] of Object.entries(prefixes)) {
    if (iri.startsWith(ns)) {
      const local = iri.slice(ns.length);
      if (local && /^[A-Za-z_][\w-]*$/.test(local)) {
        forms.push(alias === "" ? `:${local}` : `${alias}:${local}`);
      }
    }
  }

  if (base && iri.startsWith(base)) {
    const relative = iri.slice(base.length);
    if (relative) {
      forms.push(`<${relative}>`);
    }
  }

  return forms;
}

export type TurtleTokenKind = "iri" | "string" | "name" | "punct";

export interface TurtleToken {
  kind: TurtleTokenKind;
  text: string;
  start: number;
  end: number;
}

export interface BlockSpan {
  /** Offset of the statement's subject. */
  start: number;
  /** Offset just past the statement-terminating `.` (or end of text when unterminated). */
  end: number;
}

const NAME_CHAR = /[A-Za-z0-9_\-:%\\\u00B7\u00C0-\uFFFF]/;
const DELIMITERS = new Set(["<", '"', "'", "#", ";", ",", "(", ")", "[", "]", "{", "}"]);

/**
 * True when the `.` at `i` sits inside a prefixed name or a number (e.g. `ex:a.b`, `1.5`)
 * rather than terminating a statement: Turtle only allows such a dot when more name or
 * digit characters follow it.
 */
export function isInternalDot(text: string, i: number): boolean {
  let k = i;
  while (text[k] === ".") k++;
  return k < text.length && NAME_CHAR.test(text[k]);
}

/**
 * Splits Turtle text into tokens, skipping whitespace and comments. IRIs (`<...>`), string
 * literals (short and long, with escapes), names (prefixed names, keywords, numbers, language
 * tags, `^^`) and punctuation are kept apart so that a `#`, `.` or `;` inside an IRI or a
 * string is never mistaken for syntax.
 */
export function* lexTurtle(text: string, from = 0): Generator<TurtleToken> {
  const n = text.length;
  let i = from;

  while (i < n) {
    const c = text[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    if (c === "#") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }

    if (c === "<") {
      let end = i + 1;
      while (end < n && text[end] !== ">" && text[end] !== "\n") end++;
      end = Math.min(end + 1, n);
      yield { kind: "iri", text: text.slice(i, end), start: i, end };
      i = end;
      continue;
    }

    if (c === '"' || c === "'") {
      let end: number;
      if (text[i + 1] === c && text[i + 2] === c) {
        end = i + 3;
        while (end < n) {
          if (text[end] === "\\") {
            end += 2;
            continue;
          }
          if (text[end] === c) {
            let run = end;
            while (run < n && text[run] === c) run++;
            if (run - end >= 3) {
              end = run;
              break;
            }
            end = run;
            continue;
          }
          end++;
        }
      } else {
        end = i + 1;
        while (end < n && text[end] !== "\n") {
          if (text[end] === "\\") {
            end += 2;
            continue;
          }
          if (text[end] === c) {
            end++;
            break;
          }
          end++;
        }
      }
      end = Math.min(end, n);
      yield { kind: "string", text: text.slice(i, end), start: i, end };
      i = end;
      continue;
    }

    if (c === "." && !/[0-9]/.test(text[i + 1] ?? "")) {
      yield { kind: "punct", text: ".", start: i, end: i + 1 };
      i++;
      continue;
    }

    if (DELIMITERS.has(c)) {
      yield { kind: "punct", text: c, start: i, end: i + 1 };
      i++;
      continue;
    }

    let end = i;
    while (end < n) {
      const ch = text[end];
      if (ch === "\\") {
        end += 2;
        continue;
      }
      if (ch === ".") {
        if (end === i || isInternalDot(text, end)) {
          end++;
          continue;
        }
        break;
      }
      if (/\s/.test(ch) || DELIMITERS.has(ch)) break;
      end++;
    }
    end = Math.min(end, n);
    yield { kind: "name", text: text.slice(i, end), start: i, end };
    i = end;
  }
}

interface TurtleStatement extends BlockSpan {
  subject: TurtleToken;
  terminated: boolean;
}

/**
 * Lists the top-level statements of a Turtle document with their exact character spans.
 * A statement ends at a `.` outside any blank-node `[...]` or collection `(...)`. SPARQL-style
 * `PREFIX`/`BASE` directives, which have no terminating `.`, are skipped.
 */
function* turtleStatements(text: string): Generator<TurtleStatement> {
  let current: TurtleToken | null = null;
  let depth = 0;
  let sparqlDirective = false;

  for (const tok of lexTurtle(text)) {
    if (sparqlDirective) {
      if (tok.kind === "iri") sparqlDirective = false;
      continue;
    }
    if (!current) {
      if (tok.kind === "name" && /^(PREFIX|BASE)$/i.test(tok.text)) {
        sparqlDirective = true;
        continue;
      }
      current = tok;
      depth = 0;
    }
    if (tok.kind !== "punct") continue;
    if (tok.text === "[" || tok.text === "(") depth++;
    else if (tok.text === "]" || tok.text === ")") depth--;
    else if (tok.text === "." && depth <= 0) {
      yield { start: current.start, end: tok.end, subject: current, terminated: true };
      current = null;
    }
  }

  if (current) yield { start: current.start, end: text.length, subject: current, terminated: false };
}

function lineOf(text: string, offset: number): number {
  let line = 0;
  for (let k = 0; k < offset && k < text.length; k++) {
    if (text[k] === "\n") line++;
  }
  return line;
}

/** Index of the line holding the `.` that ends the statement starting on line `start`. */
export function scanToBlockEnd(lines: string[], start: number): number {
  const text = lines.slice(start).join("\n");
  const stmt = turtleStatements(text).next().value;
  if (!stmt?.terminated) return lines.length - 1;
  return start + lineOf(text, stmt.end - 1);
}

/**
 * Finds the statement whose subject is `iri` and returns its exact character span in
 * `source`. Only subjects are matched, so an IRI used as an object elsewhere never selects
 * another entity's block. A subject written with a prefix that is not declared is matched by
 * its local name as a last resort.
 */
export function findBlockSpan(
  source: string,
  iri: string,
  prefixes: PrefixMap,
  base?: string,
): BlockSpan | null {
  const forms = new Set(iriTurtleForms(iri, prefixes, base));
  const localName = iri.includes("#") ? iri.split("#").pop() : iri.split("/").pop();
  let fallback: BlockSpan | null = null;

  for (const stmt of turtleStatements(source)) {
    if (forms.has(stmt.subject.text)) return { start: stmt.start, end: stmt.end };
    if (fallback || !localName || stmt.subject.kind !== "name") continue;
    const m = stmt.subject.text.match(/^(?:(\w*):)?(.*)$/);
    if (m && m[2] === localName && (m[1] === undefined || prefixes[m[1]] === undefined)) {
      fallback = { start: stmt.start, end: stmt.end };
    }
  }

  return fallback;
}

/** Line-based view of {@link findBlockSpan}. */
export function findBlock(
  lines: string[],
  iri: string,
  prefixes: PrefixMap,
  base?: string,
): BlockRange | null {
  const text = lines.join("\n");
  const span = findBlockSpan(text, iri, prefixes, base);
  if (!span) return null;
  return { startLine: lineOf(text, span.start), endLine: lineOf(text, Math.max(span.start, span.end - 1)) };
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

export function literal(value: string): string {
  return `"${esc(value)}"`;
}

export function isIriValue(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("urn:")
  );
}
