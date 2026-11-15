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

export function toTurtle(iri: string, rev: Map<string, string>): string {
  for (const [ns, alias] of rev) {
    if (iri.startsWith(ns)) {
      const local = iri.slice(ns.length);
      if (local && /^[A-Za-z_][\w-]*$/.test(local)) {
        return alias === "" ? `:${local}` : `${alias}:${local}`;
      }
    }
  }
  return `<${iri}>`;
}

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

export function scanToBlockEnd(lines: string[], start: number): number {
  let depth = 0;
  let inStr = false;
  let longStr = false;
  let strCh = "";

  for (let j = start; j < lines.length; j++) {
    const line = lines[j];

    for (let k = 0; k < line.length; k++) {
      const c = line[k];

      if (longStr) {
        if (line.slice(k, k + 3) === strCh.repeat(3)) {
          longStr = false;
          k += 2;
        }
        continue;
      }

      if (inStr) {
        if (c === "\\") {
          k++;
          continue;
        }
        if (c === strCh) inStr = false;
        continue;
      }

      if (c === "#") break;

      if (
        line.slice(k, k + 3) === '"""' ||
        line.slice(k, k + 3) === "'''"
      ) {
        strCh = c;
        longStr = true;
        k += 2;
        continue;
      }

      if (c === '"' || c === "'") {
        strCh = c;
        inStr = true;
        continue;
      }

      if (c === "[" || c === "(") depth++;
      if (c === "]" || c === ")") depth--;

      if (c === "." && depth === 0) {
        const next = k + 1 < line.length ? line[k + 1] : "";
        if (!next || /\s/.test(next)) {
          return j;
        }
      }
    }
  }

  return lines.length - 1;
}

export function findBlock(
  lines: string[],
  iri: string,
  prefixes: PrefixMap,
  base?: string,
): BlockRange | null {
  const forms = iriTurtleForms(iri, prefixes, base);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("@") ||
      /^(PREFIX|BASE)\s/i.test(trimmed)
    ) {
      continue;
    }

    const isSubject = forms.some((f) => {
      if (!trimmed.startsWith(f)) return false;
      const after = trimmed[f.length];
      return !after || after === " " || after === "\t";
    });

    if (isSubject) {
      const prevLine = i > 0 ? lines[i - 1].trim() : "";
      const isContinuation =
        prevLine.endsWith(";") || prevLine.endsWith(",");

      if (!isContinuation) {
        return { startLine: i, endLine: scanToBlockEnd(lines, i) };
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("@") ||
      /^(PREFIX|BASE)\s/i.test(trimmed)
    ) {
      continue;
    }

    if (trimmed.includes(iri)) {
      const prevLine = i > 0 ? lines[i - 1].trim() : "";
      const isContinuation =
        prevLine.endsWith(";") || prevLine.endsWith(",");

      if (!isContinuation) {
        return { startLine: i, endLine: scanToBlockEnd(lines, i) };
      }
    }
  }

  const localName = iri.includes("#")
    ? iri.split("#").pop()
    : iri.split("/").pop();

  if (localName) {
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (
        !trimmed ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("@") ||
        /^(PREFIX|BASE)\s/i.test(trimmed)
      ) {
        continue;
      }

      const localNamePattern = new RegExp(
        `^(\\w*:)?${escapeRegex(localName)}(\\s|$)`,
      );
      if (localNamePattern.test(trimmed)) {
        const prevLine = i > 0 ? lines[i - 1].trim() : "";
        const isContinuation =
          prevLine.endsWith(";") || prevLine.endsWith(",");

        if (!isContinuation) {
          return { startLine: i, endLine: scanToBlockEnd(lines, i) };
        }
      }
    }
  }

  return null;
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

export function literal(value: string, lang: string): string {
  const escaped = esc(value);
  return lang ? `"${escaped}"@${lang}` : `"${escaped}"`;
}

export function isIriValue(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("urn:")
  );
}
