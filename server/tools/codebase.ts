import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ApiError } from "../http";
import { CODE_DIR } from "../workspace";
import { MAX_TEXT_BYTES, listFiles, resolveProjectPath, type FileEntry } from "../workspaceFiles";

/**
 * Shared plumbing for the meta tools that analyze a project's `code/` folder: which
 * files are JavaScript/TypeScript sources, loading them, TypeScript AST helpers, and
 * resolving import specifiers (relative, tsconfig/jsconfig `paths` and `baseUrl`) to
 * files in `code/`.
 */

export interface SourceFile {
  /** Project-relative path, "/" separated. */
  path: string;
  content: string;
}

export const MAX_SOURCE_FILES = 3000;
export const SOURCE_EXTS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs", ".cts", ".cjs"];
export const RESOLVE_EXTS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs"];
export const CONFIG_NAMES = ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"];
const DECLARATION_RE = /\.d\.[cm]?ts$/;
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const STORY_FILE_RE = /\.stories\.[cm]?[jt]sx?$/;
const TEST_DIRS = new Set(["__tests__", "__mocks__"]);
const SKIP_DIRS = new Set(["coverage", "out", "public"]);

/** A JavaScript/TypeScript file that is part of the program (not a test, story or .d.ts). */
export function isSourceFile(rel: string): boolean {
  return isCodeFile(rel) && !isTestFile(rel) && !STORY_FILE_RE.test(rel);
}

/** Any JavaScript/TypeScript file outside build output, tests included. */
export function isCodeFile(rel: string): boolean {
  if (DECLARATION_RE.test(rel)) return false;
  if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) return false;
  return SOURCE_EXTS.some((ext) => rel.endsWith(ext));
}

/** A test suite (`*.test.*` / `*.spec.*`), as opposed to a helper in a test folder. */
export function isTestCase(rel: string): boolean {
  return TEST_FILE_RE.test(rel);
}

/** A test suite, or any file in a __tests__ or __mocks__ folder. */
export function isTestFile(rel: string): boolean {
  return TEST_FILE_RE.test(rel) || rel.split("/").some((seg) => TEST_DIRS.has(seg));
}

export function isStoryFile(rel: string): boolean {
  return STORY_FILE_RE.test(rel);
}

// ── TypeScript AST helpers ───────────────────────────────────────────────

export interface ImportBinding {
  spec: string;
  /** "default", "*" for a namespace import, or the imported name. */
  name: string;
}

export function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

export const isCapitalized = (name: string) => /^[A-Z]/.test(name);
export const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

export function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

export const isFunctionLike = (n: ts.Node): n is ts.ArrowFunction | ts.FunctionExpression =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n);

/** The function inside memo(...), forwardRef(...), memo(forwardRef(...)) and similar wrappers. */
export function unwrapComponentExpression(expr: ts.Expression): ts.Node | null {
  let e: ts.Expression = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  if (isFunctionLike(e) || ts.isClassExpression(e)) return e;
  if (ts.isCallExpression(e)) {
    for (const arg of e.arguments) {
      const inner = unwrapComponentExpression(arg);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * For `lazy(() => import("./X"))` (also React.lazy and next/dynamic): the module and export,
 * including `import("./X").then((m) => m.Name)`.
 */
export function lazyImport(expr: ts.Expression): ImportBinding | null {
  if (!ts.isCallExpression(expr)) return null;
  const callee = expr.expression.getText();
  if (!/^(React\.)?lazy$|^dynamic$/.test(callee)) return null;
  const fn = expr.arguments[0];
  if (!fn || !isFunctionLike(fn)) return null;
  let found: ImportBinding | null = null;
  const isImportCall = (n: ts.Node): n is ts.CallExpression =>
    ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword;
  const visit = (n: ts.Node) => {
    if (found) return;
    // import("./X").then((m) => m.Name)
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "then" && isImportCall(n.expression.expression)) {
      const arg = n.expression.expression.arguments[0];
      const cb = n.arguments[0];
      let body: ts.Node | undefined = cb && isFunctionLike(cb) ? cb.body : undefined;
      while (body && ts.isParenthesizedExpression(body)) body = body.expression;
      if (arg && ts.isStringLiteralLike(arg) && body && ts.isPropertyAccessExpression(body)) {
        found = { spec: arg.text, name: body.name.text };
        return;
      }
    }
    if (isImportCall(n)) {
      const arg = n.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) found = { spec: arg.text, name: "default" };
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(fn);
  return found;
}

export function pascalFromFile(file: string): string {
  const base = path.posix.basename(file).replace(/\.[^.]+$/, "");
  const name = base === "index" ? path.posix.basename(path.posix.dirname(file)) : base;
  const pascal = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return pascal && /^[A-Z]/.test(pascal) ? pascal : "Default";
}

// ── Module resolution ────────────────────────────────────────────────────

interface PathAlias {
  /** Directory the alias targets are relative to (project-relative). */
  baseDir: string;
  /** Pattern prefix and suffix around "*" ("@/" and "" for "@/*"); exact when no "*". */
  prefix: string;
  suffix: string;
  wildcard: boolean;
  targets: string[];
}

export interface ConfigScope {
  /** Project-relative directory the config file is in; it applies to files below it. */
  dir: string;
  aliases: PathAlias[];
  baseUrl: string | null;
}

export function parseConfig(file: SourceFile): ConfigScope | null {
  const { config, error } = ts.parseConfigFileTextToJson(file.path, file.content);
  if (error || !config || typeof config !== "object") return null;
  const opts = (config as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } }).compilerOptions ?? {};
  const dir = path.posix.dirname(file.path);
  const baseUrl = typeof opts.baseUrl === "string" ? path.posix.join(dir, opts.baseUrl) : null;
  const aliasBase = baseUrl ?? dir;
  const aliases: PathAlias[] = [];
  if (opts.paths && typeof opts.paths === "object") {
    for (const [pattern, targets] of Object.entries(opts.paths as Record<string, unknown>)) {
      if (!Array.isArray(targets)) continue;
      const star = pattern.indexOf("*");
      aliases.push({
        baseDir: aliasBase,
        prefix: star >= 0 ? pattern.slice(0, star) : pattern,
        suffix: star >= 0 ? pattern.slice(star + 1) : "",
        wildcard: star >= 0,
        targets: targets.filter((t): t is string => typeof t === "string"),
      });
    }
  }
  if (aliases.length === 0 && !baseUrl) return null;
  return { dir, aliases, baseUrl };
}

export class Resolver {
  private scopes: ConfigScope[];

  constructor(
    private files: Set<string>,
    configs: ConfigScope[],
  ) {
    // Deepest directory first, so the nearest config wins.
    this.scopes = [...configs].sort((a, b) => b.dir.length - a.dir.length);
  }

  /** A file in `code/` for a path without (or with a compiled) extension, or a directory index. */
  tryFile(base: string): string | null {
    const clean = path.posix.normalize(base);
    if (this.files.has(clean)) return clean;
    // ESM-style TypeScript imports name the compiled ".js" file.
    const stripped = clean.replace(/\.(js|jsx|mjs)$/, "");
    for (const ext of RESOLVE_EXTS) if (this.files.has(stripped + ext)) return stripped + ext;
    for (const ext of RESOLVE_EXTS) if (this.files.has(`${clean}/index${ext}`)) return `${clean}/index${ext}`;
    return null;
  }

  private scopesFor(fromFile: string): ConfigScope[] {
    return this.scopes.filter((s) => fromFile.startsWith(s.dir + "/"));
  }

  private aliasRest(a: PathAlias, spec: string): string | null {
    if (a.wildcard) {
      return spec.startsWith(a.prefix) && spec.endsWith(a.suffix) && spec.length >= a.prefix.length + a.suffix.length
        ? spec.slice(a.prefix.length, spec.length - a.suffix.length)
        : null;
    }
    return spec === a.prefix ? "" : null;
  }

  /** True for specifiers that should name a file in `code/`: relative paths and `paths` aliases. */
  isLocalSpecifier(fromFile: string, spec: string): boolean {
    if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") return true;
    return this.scopesFor(fromFile).some((scope) => scope.aliases.some((a) => this.aliasRest(a, spec) !== null));
  }

  resolve(fromFile: string, spec: string): string | null {
    if (spec.startsWith(".")) return this.tryFile(path.posix.join(path.posix.dirname(fromFile), spec));
    for (const scope of this.scopesFor(fromFile)) {
      for (const a of scope.aliases) {
        const rest = this.aliasRest(a, spec);
        if (rest === null) continue;
        for (const t of a.targets) {
          const hit = this.tryFile(path.posix.join(a.baseDir, t.replace("*", rest)));
          if (hit) return hit;
        }
      }
      if (scope.baseUrl) {
        const hit = this.tryFile(path.posix.join(scope.baseUrl, spec));
        if (hit) return hit;
      }
    }
    return null;
  }
}

// ── Loading code/ ────────────────────────────────────────────────────────

export interface Codebase {
  /** Every file under code/ (project-relative paths), from the workspace listing. */
  entries: FileEntry[];
  /** JavaScript/TypeScript files picked by `include`, with their text. */
  sources: SourceFile[];
  /** tsconfig.json / tsconfig.app.json / jsconfig.json files, with their text. */
  configs: SourceFile[];
  /** True when code/ had more files than are listed or scanned. */
  truncated: boolean;
  /** Reads another file under code/ as text (null when missing, binary or too large). */
  read: (rel: string) => string | null;
}

/** Loads `code/` (null when the project has no code/ folder). */
export function loadCodebase(projectId: string, include: (rel: string) => boolean = isSourceFile): Codebase | null {
  const { abs } = resolveProjectPath(projectId, CODE_DIR);
  if (!fs.existsSync(abs)) return null;
  let listed: ReturnType<typeof listFiles>;
  try {
    listed = listFiles(projectId, CODE_DIR);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
  const files = listed.entries.filter((e) => e.type === "file" && e.size <= MAX_TEXT_BYTES);
  const read = (rel: string): string | null => {
    try {
      const buf = fs.readFileSync(resolveProjectPath(projectId, rel).abs);
      return buf.length > MAX_TEXT_BYTES || buf.includes(0) ? null : buf.toString("utf8");
    } catch {
      return null;
    }
  };
  const load = (rel: string): SourceFile | null => {
    const content = read(rel);
    return content === null ? null : { path: rel, content };
  };
  const sourcePaths = files.filter((e) => include(e.path)).map((e) => e.path);
  const configPaths = files.filter((e) => CONFIG_NAMES.includes(path.posix.basename(e.path))).map((e) => e.path);
  return {
    entries: listed.entries,
    sources: sourcePaths.slice(0, MAX_SOURCE_FILES).map(load).filter((s): s is SourceFile => s !== null),
    configs: configPaths.map(load).filter((s): s is SourceFile => s !== null),
    truncated: listed.truncated || sourcePaths.length > MAX_SOURCE_FILES,
    read,
  };
}
