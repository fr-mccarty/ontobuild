import {
  parseDeclarations,
  findBlock,
  type PrefixMap,
} from "@/lib/ontology/turtleUtils";

export type ParsedObject =
  | { type: "iri"; value: string }
  | { type: "literal"; value: string; lang?: string; datatype?: string }
  | { type: "boolean"; value: boolean };

export interface ParsedTriple {
  predicate: string;
  object: ParsedObject;
}

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

function resolveIri(token: string, prefixes: PrefixMap, base?: string): string {
  if (token.startsWith("<") && token.endsWith(">")) {
    const inner = token.slice(1, -1);
    if (base && !inner.includes("://") && !inner.startsWith("urn:")) {
      return base + inner;
    }
    return inner;
  }

  const colonIdx = token.indexOf(":");
  if (colonIdx >= 0) {
    const prefix = token.slice(0, colonIdx);
    const local = token.slice(colonIdx + 1);
    const ns = prefixes[prefix];
    if (ns !== undefined) {
      return ns + local;
    }
  }

  return token;
}

function parseLiteral(raw: string): ParsedObject {
  if (raw === "true" || raw === "false") {
    return { type: "boolean", value: raw === "true" };
  }

  if (!raw.startsWith('"') && !raw.startsWith("'")) {
    return { type: "literal", value: raw };
  }

  const isLong = raw.startsWith('"""') || raw.startsWith("'''");
  const quoteChar = raw[0];
  const quoteLen = isLong ? 3 : 1;
  const quoteStr = isLong ? quoteChar.repeat(3) : quoteChar;

  let i = quoteLen;
  let value = "";
  while (i < raw.length) {
    if (raw[i] === "\\") {
      const next = raw[i + 1];
      switch (next) {
        case "n": value += "\n"; break;
        case "r": value += "\r"; break;
        case "t": value += "\t"; break;
        case "\\": value += "\\"; break;
        case '"': value += '"'; break;
        case "'": value += "'"; break;
        default: value += next || ""; break;
      }
      i += 2;
      continue;
    }

    if (raw.slice(i, i + quoteLen) === quoteStr) {
      i += quoteLen;
      break;
    }

    value += raw[i];
    i++;
  }

  const suffix = raw.slice(i);
  if (suffix.startsWith("@")) {
    return { type: "literal", value, lang: suffix.slice(1) };
  }
  if (suffix.startsWith("^^")) {
    const dtToken = suffix.slice(2);
    return { type: "literal", value, datatype: dtToken };
  }

  return { type: "literal", value };
}

function tokenizeBlock(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (/\s/.test(c)) { i++; continue; }

    if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    if (c === ";") { tokens.push(";"); i++; continue; }
    if (c === ",") { tokens.push(","); i++; continue; }
    if (c === ".") {
      tokens.push(".");
      i++;
      continue;
    }

    if (c === "<") {
      let end = i + 1;
      while (end < text.length && text[end] !== ">") end++;
      tokens.push(text.slice(i, end + 1));
      i = end + 1;
      continue;
    }

    if (c === '"' || c === "'") {
      const isLong = text.slice(i, i + 3) === c.repeat(3);
      const quoteLen = isLong ? 3 : 1;
      const quoteStr = isLong ? c.repeat(3) : c;
      let end = i + quoteLen;

      while (end < text.length) {
        if (text[end] === "\\") { end += 2; continue; }
        if (text.slice(end, end + quoteLen) === quoteStr) {
          end += quoteLen;
          break;
        }
        end++;
      }

      if (end < text.length && text[end] === "@") {
        end++;
        while (end < text.length && /[a-zA-Z0-9-]/.test(text[end])) end++;
      } else if (text.slice(end, end + 2) === "^^") {
        end += 2;
        if (end < text.length && text[end] === "<") {
          while (end < text.length && text[end] !== ">") end++;
          end++;
        } else {
          while (end < text.length && /[A-Za-z0-9_:.-]/.test(text[end])) end++;
        }
      }

      tokens.push(text.slice(i, end));
      i = end;
      continue;
    }

    if (c === "[") {
      let depth = 1;
      let end = i + 1;
      while (end < text.length && depth > 0) {
        if (text[end] === "[") depth++;
        if (text[end] === "]") depth--;
        end++;
      }
      tokens.push(text.slice(i, end));
      i = end;
      continue;
    }

    if (c === "(") {
      let depth = 1;
      let end = i + 1;
      while (end < text.length && depth > 0) {
        if (text[end] === "(") depth++;
        if (text[end] === ")") depth--;
        end++;
      }
      tokens.push(text.slice(i, end));
      i = end;
      continue;
    }

    let end = i;
    while (end < text.length && !/[\s;,.#"'<[\](]/.test(text[end])) end++;
    if (end > i) {
      tokens.push(text.slice(i, end));
      i = end;
    } else {
      i++;
    }
  }

  return tokens;
}

export function parseBlockTriples(
  source: string,
  entityIri: string,
): ParsedTriple[] | null {
  const { prefixes, base } = parseDeclarations(source);
  const lines = source.split("\n");

  const block = findBlock(lines, entityIri, prefixes, base);
  if (!block) return null;

  const blockLines = lines.slice(block.startLine, block.endLine + 1);
  const blockText = blockLines.join("\n");

  const tokens = tokenizeBlock(blockText);
  if (tokens.length === 0) return null;

  let startIdx = 0;
  if (tokens[startIdx] !== ";" && tokens[startIdx] !== "," && tokens[startIdx] !== ".") {
    startIdx = 1;
  }

  const triples: ParsedTriple[] = [];
  let currentPredicate: string | null = null;
  let expectPredicate = true;

  for (let ti = startIdx; ti < tokens.length; ti++) {
    const tok = tokens[ti];

    if (tok === ".") break;

    if (tok === ";") {
      expectPredicate = true;
      continue;
    }

    if (tok === ",") {
      expectPredicate = false;
      continue;
    }

    if (expectPredicate) {
      if (tok === "a") {
        currentPredicate = RDF_TYPE;
      } else {
        currentPredicate = resolveIri(tok, prefixes, base);
      }
      expectPredicate = false;
    } else if (currentPredicate) {
      let obj: ParsedObject;

      if (tok === "true" || tok === "false") {
        obj = { type: "boolean", value: tok === "true" };
      } else if (tok.startsWith('"') || tok.startsWith("'")) {
        obj = parseLiteral(tok);
        if (obj.type === "literal" && obj.datatype) {
          obj = { ...obj, datatype: resolveIri(obj.datatype, prefixes, base) };
        }
      } else if (tok.startsWith("<") || tok.includes(":")) {
        obj = { type: "iri", value: resolveIri(tok, prefixes, base) };
      } else {
        obj = { type: "literal", value: tok };
      }

      triples.push({ predicate: currentPredicate, object: obj });
    }
  }

  return triples;
}
