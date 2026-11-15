export interface IriPosition {
  line: number;
  col: number;
  len: number;
}

export type IriSuffixPattern = "uuid" | "numeric" | "named";

export type EntityType =
  | "class"
  | "objectProperty"
  | "dataProperty"
  | "annotationProperty"
  | "individual";

export interface IriPatternDetectionResult {
  pattern: IriSuffixPattern;
  confidence: number;
  nextNumeric?: number;
}

export interface GenerateIriOptions {
  baseNamespace: string;
  pattern: IriSuffixPattern;
  label?: string;
  nextNumeric?: number;
}

const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function uuidToBase62(uuid?: string): string {
  const id = uuid ?? crypto.randomUUID();
  const hex = id.replace(/-/g, "");

  let num = BigInt("0x" + hex);
  if (num === 0n) return "R0";

  const chars: string[] = [];
  const base = BigInt(62);
  while (num > 0n) {
    chars.push(BASE62_CHARS[Number(num % base)]);
    num = num / base;
  }

  return "R" + chars.reverse().join("");
}

export function labelToLocalName(label: string): string {
  return label
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

const UUID_RE = /^[A-Za-z][A-Za-z0-9]{19,}$/;

const NUMERIC_SUFFIX_RE = /[_-]?(\d+)$/;

export function detectIriPattern(localNames: string[]): IriPatternDetectionResult {
  if (localNames.length === 0) {
    return { pattern: "uuid", confidence: 0 };
  }

  let uuidCount = 0;
  let numericCount = 0;
  let maxNumeric = 0;

  for (const name of localNames) {
    if (UUID_RE.test(name)) {
      uuidCount++;
    }
    const numMatch = name.match(NUMERIC_SUFFIX_RE);
    if (numMatch) {
      numericCount++;
      const n = parseInt(numMatch[1], 10);
      if (n > maxNumeric) maxNumeric = n;
    }
  }

  const total = localNames.length;

  if (uuidCount / total > 0.5) {
    return { pattern: "uuid", confidence: uuidCount / total };
  }
  if (numericCount / total > 0.5) {
    return {
      pattern: "numeric",
      confidence: numericCount / total,
      nextNumeric: maxNumeric + 1,
    };
  }
  return { pattern: "named", confidence: 1 - (uuidCount + numericCount) / total };
}

export function detectPatternFromIriIndex(
  iriIndex: Map<string, IriPosition>,
  internalNamespaces: Set<string>,
): IriPatternDetectionResult {
  const localNames: string[] = [];

  for (const iri of iriIndex.keys()) {
    const isInternal = [...internalNamespaces].some((ns) => iri.startsWith(ns));
    if (!isInternal) continue;

    const hashIdx = iri.lastIndexOf("#");
    const slashIdx = iri.lastIndexOf("/");
    const sep = hashIdx > -1 ? hashIdx : slashIdx;
    if (sep > -1 && sep < iri.length - 1) {
      localNames.push(iri.slice(sep + 1));
    }
  }

  return detectIriPattern(localNames);
}

export function generateEntityIri(options: GenerateIriOptions): string {
  const { baseNamespace, pattern, label, nextNumeric } = options;

  switch (pattern) {
    case "uuid":
      return baseNamespace + uuidToBase62();
    case "numeric":
      return baseNamespace + String(nextNumeric ?? 1);
    case "named":
      return baseNamespace + (label ? labelToLocalName(label) : uuidToBase62());
    default:
      return baseNamespace + uuidToBase62();
  }
}
