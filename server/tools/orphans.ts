import path from "node:path";
import ts from "typescript";
import {
  Resolver,
  containsJsx,
  hasModifier,
  isCapitalized,
  isCodeFile,
  isFunctionLike,
  isStoryFile,
  isTestCase,
  isTestFile,
  loadCodebase,
  parseConfig,
  scriptKind,
  unwrapComponentExpression,
  type ConfigScope,
  type SourceFile,
} from "./codebase";

/**
 * Orphans in a project's `code/` folder: files, declarations, tests and scripts that
 * nothing uses. Read statically from the source with the TypeScript compiler.
 *
 * - Entry points are found from the framework's conventions (Next.js app/ and pages/
 *   files, middleware), package.json (main, module, bin, exports, scripts), index.html
 *   `<script src>`, tool config files, and files in scripts/ or bin/.
 * - A file is an orphan when no entry point reaches it through imports (static,
 *   dynamic, require, re-exports, `new URL(..., import.meta.url)`). Reached only from
 *   tests or stories, it is reported as "only used by tests".
 * - A top-level declaration (component, class, function, variable or type) in a used
 *   file is an orphan when nothing refers to it in its own file and no used file
 *   imports it. Declarations in orphan files aren't listed separately.
 * - A test is an orphan when it imports files or exports that no longer exist, or
 *   imports no project code at all (end-to-end tests excepted). A helper in a test
 *   folder is one when no test imports it and no config file or package.json names it.
 * - A script is an orphan when nothing mentions it (package.json, Makefiles, CI
 *   workflows, Dockerfiles, docs or other scripts); an npm script is one when it runs a
 *   file that doesn't exist.
 *
 * Without any entry point, every file counts as used and files are reported only when
 * nothing imports them.
 */

export type OrphanCategory = "file" | "component" | "class" | "function" | "variable" | "type" | "test" | "script";

export interface OrphanItem {
  id: string;
  category: OrphanCategory;
  /** Declaration, file or npm script name. */
  name: string;
  /** Project-relative file the item is in. */
  file: string;
  line: number | null;
  reason: string;
}

export interface OrphanReport {
  items: OrphanItem[];
  /** Files treated as entry points (project-relative). */
  entry_points: string[];
  files_scanned: number;
  parse_errors: { file: string; message: string }[];
  truncated: boolean;
}

export const CATEGORY_ORDER: OrphanCategory[] = ["file", "component", "class", "function", "variable", "type", "test", "script"];

type SymbolKind = "component" | "class" | "function" | "variable" | "type";

interface Decl {
  name: string;
  kind: SymbolKind;
  line: number;
}

interface ImportRef {
  spec: string;
  line: number;
  /** Imported names ("default", a name, or "*" with `ns`); empty for side-effect imports. */
  names: string[];
  /** Local name of `import * as ns`. */
  ns?: string;
  /** Dynamic import, require, `export * as`, `new URL(...)`: everything the module exports may be used. */
  whole?: boolean;
  /** vi.mock / jest.mock: only checked for existence. */
  mockOnly?: boolean;
}

interface FileFacts {
  path: string;
  /** Tests and stories: what they use doesn't count as use by the program. */
  devOnly: boolean;
  decls: Map<string, Decl>;
  /** Exported name → local name. */
  exports: Map<string, string>;
  /** Local name → where an import binding comes from. */
  bindings: Map<string, { spec: string; name: string }>;
  reexports: { spec: string; from: string; as: string }[];
  imports: ImportRef[];
  /** References to each name in this file, not counting declarations or export clauses. */
  refs: Map<string, number>;
  /** Members used through each namespace import; "all" when the namespace is used as a value. */
  nsMembers: Map<string, Set<string> | "all">;
}

const NEXT_APP_FILES = new Set([
  "page", "layout", "template", "loading", "error", "global-error", "not-found", "default", "route",
  "opengraph-image", "twitter-image", "icon", "apple-icon", "sitemap", "robots", "manifest", "forbidden", "unauthorized",
]);
const ROOT_ENTRY_RE = /^(src\/)?(middleware|instrumentation|instrumentation-client|proxy)\.[cm]?[jt]sx?$/;
const MAIN_ENTRY_RE = /^(src\/)?(main|index|app|server|cli)\.[cm]?[jt]sx?$/;
const CONFIG_FILE_RE = /(\.config\.[cm]?[jt]s$)|(^\.?(eslintrc|prettierrc|babelrc|stylelintrc|postcssrc)(\.[cm]?[jt]s)?$)|((^|[.-])setup(Tests)?\.[cm]?[jt]sx?$)/;
const STYLE_RE = /\.(css|scss|sass|less)$/;
const SCRIPT_EXT_RE = /\.(sh|bash|zsh|js|mjs|cjs|ts|mts|cts|py|rb|ps1)$/;
const SHELL_EXT_RE = /\.(sh|bash|zsh|ps1)$/;
const MENTION_NAME_RE =
  /(^|\/)(package\.json|Makefile|GNUmakefile|justfile|Procfile|Dockerfile[^/]*|docker-compose[^/]*|[^/]+\.(mk|ya?ml|toml|md|mdx|json|sh|bash|zsh|html|txt|cfg|ini))$/;
const SCRIPT_TOKEN_RE = /^(\.{1,2}\/)?[\w@.\-/]+\.(js|cjs|mjs|ts|mts|cts|sh|bash|py|rb)$/;
const E2E_RE = /(^|\/)(e2e|playwright|cypress)(\/|$)/;
const E2E_IMPORTS = new Set(["@playwright/test", "playwright", "cypress", "puppeteer", "webdriverio"]);

const posix = path.posix;

function inDir(rel: string, names: string[]): boolean {
  return rel.split("/").slice(0, -1).some((seg) => names.includes(seg));
}

// ── Per-file facts ───────────────────────────────────────────────────────

function symbolKind(name: string, node: ts.Node, initializer?: ts.Expression): SymbolKind {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) return "type";
  const isClass = ts.isClassDeclaration(node) || (initializer !== undefined && ts.isClassExpression(initializer));
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
    if (isCapitalized(name) && containsJsx(node)) return "component";
    return isClass ? "class" : "function";
  }
  if (initializer) {
    let init = initializer;
    while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
    const fn = unwrapComponentExpression(init);
    if (fn && isCapitalized(name) && containsJsx(fn)) return "component";
    if (isClass) return "class";
    if (isFunctionLike(init)) return "function";
  }
  return "variable";
}

/** Names bound by a declaration name (an identifier or a destructuring pattern). */
function boundNames(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  const out: ts.Identifier[] = [];
  for (const el of name.elements) if (!ts.isOmittedExpression(el)) out.push(...boundNames(el.name));
  return out;
}

/** Is this identifier a reference to a binding (not a declaration name, member name or export clause)? */
function isReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return false;
  if (ts.isShorthandPropertyAssignment(p)) return true;
  if ((p as { name?: ts.Node }).name === id) return false;
  if ((p as { propertyName?: ts.Node }).propertyName === id) return false;
  if (ts.isQualifiedName(p) && p.right === id) return false;
  if (ts.isImportClause(p) || ts.isImportSpecifier(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) return false;
  // `export default Foo` and `export default memo(Foo)` only export it.
  if (ts.isExportAssignment(p)) return false;
  if (ts.isCallExpression(p) && p.parent && ts.isExportAssignment(p.parent)) return false;
  // `Foo.displayName = "Foo"` configures it rather than using it.
  if (ts.isPropertyAccessExpression(p) && p.expression === id) {
    const assign = p.parent;
    if (assign && ts.isBinaryExpression(assign) && assign.left === p && assign.operatorToken.kind === ts.SyntaxKind.EqualsToken) return false;
  }
  if (ts.isJsxClosingElement(p)) return false;
  return true;
}

export function parseFacts(file: SourceFile): FileFacts {
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, scriptKind(file.path));
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const facts: FileFacts = {
    path: file.path,
    devOnly: isTestFile(file.path) || isStoryFile(file.path),
    decls: new Map(),
    exports: new Map(),
    bindings: new Map(),
    reexports: [],
    imports: [],
    refs: new Map(),
    nsMembers: new Map(),
  };
  const addDecl = (id: ts.Identifier, node: ts.Node, initializer?: ts.Expression) => {
    if (!facts.decls.has(id.text)) facts.decls.set(id.text, { name: id.text, kind: symbolKind(id.text, node, initializer), line: lineOf(id) });
  };

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const ref: ImportRef = { spec, line: lineOf(stmt), names: [] };
      const clause = stmt.importClause;
      if (clause?.name) {
        ref.names.push("default");
        facts.bindings.set(clause.name.text, { spec, name: "default" });
      }
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) {
        ref.names.push("*");
        ref.ns = nb.name.text;
        facts.nsMembers.set(nb.name.text, new Set());
      } else if (nb) {
        for (const el of nb.elements) {
          const imported = (el.propertyName ?? el.name).text;
          ref.names.push(imported);
          facts.bindings.set(el.name.text, { spec, name: imported });
        }
      }
      facts.imports.push(ref);
      continue;
    }
    if (ts.isExportDeclaration(stmt)) {
      const spec = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : null;
      const clause = stmt.exportClause;
      if (spec) {
        if (!clause) facts.reexports.push({ spec, from: "*", as: "*" });
        else if (ts.isNamespaceExport(clause)) facts.imports.push({ spec, line: lineOf(stmt), names: [], whole: true });
        else for (const el of clause.elements) facts.reexports.push({ spec, from: (el.propertyName ?? el.name).text, as: el.name.text });
      } else if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) facts.exports.set(el.name.text, (el.propertyName ?? el.name).text);
      }
      continue;
    }
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      let e = stmt.expression;
      while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
      if (ts.isIdentifier(e)) facts.exports.set("default", e.text);
      else if (ts.isCallExpression(e) && e.arguments[0] && ts.isIdentifier(e.arguments[0])) facts.exports.set("default", e.arguments[0].text);
      continue;
    }
    if (hasModifier(stmt, ts.SyntaxKind.DeclareKeyword)) continue;
    const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
    if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      if (!stmt.name) continue; // an anonymous default export: covered by the file itself
      addDecl(stmt.name, stmt);
      if (exported) facts.exports.set(isDefault ? "default" : stmt.name.text, stmt.name.text);
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        for (const id of boundNames(decl.name)) {
          addDecl(id, decl, ts.isIdentifier(decl.name) ? decl.initializer : undefined);
          if (exported) facts.exports.set(id.text, id.text);
        }
      }
    }
  }

  const literalArg = (call: ts.CallExpression) => {
    const a = call.arguments[0];
    return a && ts.isStringLiteralLike(a) ? a.text : null;
  };
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) {
      if (isReference(n)) {
        facts.refs.set(n.text, (facts.refs.get(n.text) ?? 0) + 1);
        const members = facts.nsMembers.get(n.text);
        if (members && members !== "all") {
          const p = n.parent;
          if (ts.isPropertyAccessExpression(p) && p.expression === n) members.add(p.name.text);
          else if (ts.isQualifiedName(p) && p.left === n) members.add(p.right.text);
          else facts.nsMembers.set(n.text, "all");
        }
      }
      return;
    }
    if (ts.isCallExpression(n)) {
      const spec = literalArg(n);
      if (spec !== null) {
        const callee = n.expression;
        if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
          facts.imports.push({ spec, line: lineOf(n), names: [], whole: true });
        } else if (ts.isPropertyAccessExpression(callee) && /^(vi|jest)$/.test(callee.expression.getText(sf)) && /^(mock|doMock|requireActual|importActual)$/.test(callee.name.text)) {
          facts.imports.push({ spec, line: lineOf(n), names: [], mockOnly: true });
        }
      }
    }
    // new URL("./worker.ts", import.meta.url)
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "URL" && n.arguments?.length === 2) {
      const [a, b] = n.arguments;
      if (ts.isStringLiteralLike(a) && b.getText(sf) === "import.meta.url") facts.imports.push({ spec: a.text, line: lineOf(n), names: [], whole: true });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return facts;
}

// ── Analysis ─────────────────────────────────────────────────────────────

export interface OrphanInput {
  /** JavaScript/TypeScript files in code/, tests included. */
  sources: SourceFile[];
  configs?: SourceFile[];
  /** Every file path under code/ (sources, styles, scripts, package.json, docs...). */
  allFiles: string[];
  /** Reads a text file under code/ (package.json, index.html, docs...). */
  read: (rel: string) => string | null;
}

export function findOrphans(input: OrphanInput): Omit<OrphanReport, "truncated"> {
  const parseErrors: { file: string; message: string }[] = [];
  const facts = new Map<string, FileFacts>();
  for (const s of input.sources) {
    try {
      facts.set(s.path, parseFacts(s));
    } catch (e) {
      parseErrors.push({ file: s.path, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const allFiles = new Set(input.allFiles);
  const configs = (input.configs ?? []).map(parseConfig).filter((c): c is ConfigScope => c !== null);
  const resolver = new Resolver(allFiles, configs);
  const items: OrphanItem[] = [];

  // Package roots: directories with a package.json (code/ itself when there are none).
  const packageJsons = input.allFiles.filter((f) => posix.basename(f) === "package.json" && !f.includes("/node_modules/"));
  const pkgDirs = packageJsons.length > 0 ? packageJsons.map(posix.dirname) : ["code"];
  const pkgOf = (rel: string) =>
    pkgDirs.filter((d) => rel.startsWith(d + "/")).sort((a, b) => b.length - a.length)[0] ?? "code";
  const isScriptFile = (rel: string) => SCRIPT_EXT_RE.test(rel) && (inDir(rel.slice(pkgOf(rel).length + 1), ["scripts", "bin"]) || SHELL_EXT_RE.test(rel));

  // ── Entry points
  const entries = new Set<string>();
  const addEntry = (rel: string | null) => {
    if (rel && facts.has(rel)) entries.add(rel);
  };
  for (const f of facts.keys()) {
    const inPkg = f.slice(pkgOf(f).length + 1);
    const segs = inPkg.split("/");
    const base = posix.basename(f).replace(/\.[^.]+$/, "");
    if (segs.slice(0, -1).includes("app") && NEXT_APP_FILES.has(base)) addEntry(f);
    else if (/^(src\/)?pages\//.test(inPkg)) addEntry(f);
    else if (ROOT_ENTRY_RE.test(inPkg) || CONFIG_FILE_RE.test(posix.basename(f)) || isScriptFile(f)) addEntry(f);
  }
  const npmScripts: { pkg: string; name: string; command: string }[] = [];
  for (const pj of packageJsons) {
    const dir = posix.dirname(pj);
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(input.read(pj) ?? "{}");
    } catch {
      continue;
    }
    const fieldPaths: string[] = [];
    const collect = (v: unknown) => {
      if (typeof v === "string") fieldPaths.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(collect);
    };
    collect(json.main);
    collect(json.module);
    collect(json.browser);
    collect(json.bin);
    collect(json.exports);
    for (const p of fieldPaths) if (!p.includes("*")) addEntry(resolver.tryFile(posix.join(dir, p)));
    if (json.scripts && typeof json.scripts === "object") {
      for (const [name, command] of Object.entries(json.scripts as Record<string, unknown>)) {
        if (typeof command === "string") npmScripts.push({ pkg: pj, name, command });
      }
    }
  }
  const scriptTokens = (command: string) =>
    command
      .split(/[\s;&|()]+/)
      .map((t) => t.replace(/^["']|["']$/g, ""))
      .filter((t) => SCRIPT_TOKEN_RE.test(t) && !t.startsWith("-") && !t.includes("://"));
  for (const s of npmScripts) for (const t of scriptTokens(s.command)) addEntry(resolver.tryFile(posix.join(posix.dirname(s.pkg), t)));
  for (const html of input.allFiles.filter((f) => f.endsWith(".html"))) {
    const text = input.read(html) ?? "";
    for (const m of text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      const src = m[1];
      if (/^[a-z]+:\/\//i.test(src)) continue;
      addEntry(resolver.tryFile(src.startsWith("/") ? posix.join(posix.dirname(html), src) : posix.join(posix.dirname(html), src)));
    }
  }
  // Plain projects: main/index files at a package root or in its src/.
  if (![...entries].some((e) => !isScriptFile(e) && !CONFIG_FILE_RE.test(posix.basename(e)))) {
    for (const f of facts.keys()) if (MAIN_ENTRY_RE.test(f.slice(pkgOf(f).length + 1))) addEntry(f);
  }
  const programEntries = [...entries].filter((e) => !CONFIG_FILE_RE.test(posix.basename(e)) && !isScriptFile(e));
  const haveEntries = programEntries.length > 0;

  // ── Import graph and reachability
  const edges = new Map<string, Set<string>>();
  const importers = new Map<string, Set<string>>();
  for (const f of facts.values()) {
    const targets = new Set<string>();
    const specs = [...f.imports.filter((i) => !i.mockOnly).map((i) => i.spec), ...f.reexports.map((r) => r.spec)];
    for (const spec of specs) {
      const t = resolver.resolve(f.path, spec);
      if (t && t !== f.path) targets.add(t);
    }
    edges.set(f.path, targets);
    for (const t of targets) {
      if (!importers.has(t)) importers.set(t, new Set());
      importers.get(t)!.add(f.path);
    }
  }
  const reachFrom = (starts: Iterable<string>) => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const t of edges.get(f) ?? []) stack.push(t);
    }
    return seen;
  };
  const devFiles = [...facts.values()].filter((f) => f.devOnly).map((f) => f.path);
  const prodReach = haveEntries ? reachFrom(entries) : new Set([...facts.keys(), ...allFiles]);
  const devReach = reachFrom([...prodReach, ...devFiles].filter((f) => facts.has(f)));

  // ── Symbol use
  type Use = { prod: boolean; dev: boolean };
  const uses = new Map<string, Use>();
  const declKey = (file: string, name: string) => `${file}#${name}`;
  const markDecl = (file: string, local: string, dev: boolean) => {
    const key = declKey(file, local);
    const u = uses.get(key) ?? { prod: false, dev: false };
    if (dev) u.dev = true;
    else u.prod = true;
    uses.set(key, u);
  };
  const markExport = (file: string, name: string, dev: boolean, seen = new Set<string>()): boolean => {
    const key = `${file}:${name}:${dev}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const f = facts.get(file);
    if (!f) return false;
    const local = f.exports.get(name);
    if (local !== undefined) {
      if (f.decls.has(local)) markDecl(file, local, dev);
      const b = f.bindings.get(local);
      if (b) {
        const t = resolver.resolve(file, b.spec);
        if (t) markExport(t, b.name, dev, seen);
      }
      return true;
    }
    let found = false;
    for (const re of f.reexports) {
      const t = re.as === name || (re.as === "*" && name !== "default") ? resolver.resolve(file, re.spec) : null;
      if (!t) continue;
      if (re.as === name) return markExport(t, re.from, dev, seen) || true;
      found = markExport(t, name, dev, seen) || found;
    }
    return found;
  };
  const markAll = (file: string, dev: boolean, seen = new Set<string>()) => {
    if (seen.has(file)) return;
    seen.add(file);
    const f = facts.get(file);
    if (!f) return;
    for (const name of f.exports.keys()) markExport(file, name, dev);
    for (const re of f.reexports) {
      const t = resolver.resolve(file, re.spec);
      if (!t) continue;
      if (re.as === "*") markAll(t, dev, seen);
      else markExport(t, re.from, dev);
    }
  };
  for (const f of facts.values()) {
    const reachedBy = f.devOnly ? devReach.has(f.path) : prodReach.has(f.path);
    if (!reachedBy && !(f.devOnly && !haveEntries)) continue;
    for (const imp of f.imports) {
      if (imp.mockOnly) continue;
      const t = resolver.resolve(f.path, imp.spec);
      if (!t) continue;
      const dev = f.devOnly;
      if (imp.whole) markAll(t, dev);
      for (const name of imp.names) {
        if (name !== "*") markExport(t, name, dev);
        else {
          const members = imp.ns ? f.nsMembers.get(imp.ns) : "all";
          if (members === "all" || !members) markAll(t, dev);
          else for (const m of members) markExport(t, m, dev);
        }
      }
    }
  }
  for (const e of entries) markAll(e, false);

  // ── Files
  const fileItem = (file: string, reason: string) =>
    items.push({ id: `file:${file}`, category: "file", name: posix.basename(file), file, line: null, reason });
  const orphanFiles = new Set<string>();
  for (const f of facts.values()) {
    if (f.devOnly || entries.has(f.path) || isScriptFile(f.path) || CONFIG_FILE_RE.test(posix.basename(f.path))) continue;
    if (prodReach.has(f.path)) continue;
    const from = [...(importers.get(f.path) ?? [])];
    orphanFiles.add(f.path);
    if (devReach.has(f.path)) fileItem(f.path, "Only used by tests or stories");
    else if (from.length > 0) fileItem(f.path, `Only imported by files that are unused themselves (${posix.basename(from[0])}${from.length > 1 ? ` and ${from.length - 1} more` : ""})`);
    else fileItem(f.path, "Nothing imports it");
  }
  if (!haveEntries) {
    // Without entry points, report program files nothing in the program imports.
    for (const f of facts.values()) {
      if (f.devOnly || isScriptFile(f.path) || CONFIG_FILE_RE.test(posix.basename(f.path))) continue;
      const from = [...(importers.get(f.path) ?? [])].filter((p) => !facts.get(p)?.devOnly);
      if (from.length > 0) continue;
      orphanFiles.add(f.path);
      fileItem(f.path, (importers.get(f.path)?.size ?? 0) > 0 ? "Only used by tests or stories" : "Nothing imports it");
    }
  }
  // Stylesheets: imported from used code, @import-ed, or linked from HTML.
  const styleTexts = input.allFiles.filter((f) => STYLE_RE.test(f) || f.endsWith(".html")).map((f) => [f, input.read(f) ?? ""] as const);
  for (const style of input.allFiles.filter((f) => STYLE_RE.test(f))) {
    if ([...(importers.get(style) ?? [])].some((p) => prodReach.has(p) || (!haveEntries && !facts.get(p)?.devOnly))) continue;
    const base = posix.basename(style);
    if (styleTexts.some(([f, text]) => f !== style && text.includes(base))) continue;
    orphanFiles.add(style);
    fileItem(style, (importers.get(style)?.size ?? 0) > 0 ? "Only imported by unused files or tests" : "Nothing imports or links it");
  }

  // ── Declarations
  for (const f of facts.values()) {
    if (f.devOnly || orphanFiles.has(f.path) || (haveEntries && !prodReach.has(f.path))) continue;
    const exportedLocals = new Set(f.exports.values());
    for (const d of f.decls.values()) {
      if ((f.refs.get(d.name) ?? 0) > 0) continue;
      const u = uses.get(declKey(f.path, d.name));
      if (u?.prod) continue;
      const reason = u?.dev
        ? "Only used by tests or stories"
        : exportedLocals.has(d.name)
          ? "Exported, but nothing imports it"
          : "Declared, but never used";
      items.push({ id: `${d.kind}:${f.path}#${d.name}`, category: d.kind, name: d.name, file: f.path, line: d.line, reason });
    }
  }

  // ── Tests
  const exportExists = (file: string, name: string, seen = new Set<string>()): boolean => {
    if (seen.has(file)) return false;
    seen.add(file);
    const f = facts.get(file);
    if (!f) return true; // not a parsed module (CSS, JSON...): can't tell
    if (f.exports.has(name) || f.reexports.some((r) => r.as === name)) return true;
    return f.reexports.some((r) => {
      if (r.as !== "*" || name === "default") return false;
      const t = resolver.resolve(file, r.spec);
      return t ? exportExists(t, name, seen) : true; // `export *` from a package: assume it's there
    });
  };
  const configTexts = [...entries, ...packageJsons]
    .filter((f) => CONFIG_FILE_RE.test(posix.basename(f)) || posix.basename(f) === "package.json")
    .map((f) => input.read(f) ?? "");
  for (const f of facts.values()) {
    if (!isTestFile(f.path) || isTestCase(f.path) || f.path.split("/").includes("__mocks__")) continue;
    if ((importers.get(f.path)?.size ?? 0) > 0) continue;
    const base = posix.basename(f.path);
    const stem = base.replace(/\.[^.]+$/, "");
    if (configTexts.some((t) => t.includes(base) || t.includes(`/${stem}"`) || t.includes(`/${stem}'`))) continue;
    items.push({ id: `test:${f.path}`, category: "test", name: base, file: f.path, line: null, reason: "Test helper that no test imports" });
  }
  for (const f of facts.values()) {
    if (!isTestCase(f.path)) continue;
    const problems: string[] = [];
    let importsProject = false;
    let e2e = E2E_RE.test(f.path);
    for (const imp of f.imports) {
      if (E2E_IMPORTS.has(imp.spec)) e2e = true;
      const t = resolver.resolve(f.path, imp.spec);
      if (!t) {
        if (resolver.isLocalSpecifier(f.path, imp.spec)) problems.push(`imports ${imp.spec}, which doesn't exist`);
        continue;
      }
      importsProject = true;
      for (const name of imp.names) {
        if (name !== "*" && !exportExists(t, name)) problems.push(`imports ${name === "default" ? "a default export" : name} from ${imp.spec}, which no longer exports it`);
      }
    }
    if (problems.length === 0 && !importsProject && !e2e) problems.push("doesn't import any code from the project");
    if (problems.length > 0) {
      const first = problems[0].charAt(0).toUpperCase() + problems[0].slice(1);
      items.push({
        id: `test:${f.path}`,
        category: "test",
        name: posix.basename(f.path),
        file: f.path,
        line: null,
        reason: problems.length > 1 ? `${first} (and ${problems.length - 1} more problem${problems.length > 2 ? "s" : ""})` : first,
      });
    }
  }

  // ── Scripts
  for (const s of npmScripts) {
    const dir = posix.dirname(s.pkg);
    const missing = scriptTokens(s.command).find((t) => !allFiles.has(posix.normalize(posix.join(dir, t))));
    if (!missing) continue;
    const text = input.read(s.pkg) ?? "";
    const at = text.indexOf(JSON.stringify(s.name) + ":");
    items.push({
      id: `script:${s.pkg}#${s.name}`,
      category: "script",
      name: `npm run ${s.name}`,
      file: s.pkg,
      line: at >= 0 ? text.slice(0, at).split("\n").length : null,
      reason: `Runs ${missing}, which doesn't exist`,
    });
  }
  const mentionSources = input.allFiles.filter((f) => MENTION_NAME_RE.test(f) || isScriptFile(f) || posix.basename(posix.dirname(f)) === ".husky").slice(0, 2000);
  const mentionTexts = new Map<string, string>();
  const textOf = (f: string) => {
    if (!mentionTexts.has(f)) mentionTexts.set(f, input.read(f) ?? "");
    return mentionTexts.get(f)!;
  };
  for (const file of input.allFiles.filter(isScriptFile)) {
    if ([...(importers.get(file) ?? [])].some((p) => p !== file)) continue;
    const base = posix.basename(file);
    if (mentionSources.some((m) => m !== file && textOf(m).includes(base))) continue;
    items.push({
      id: `script:${file}`,
      category: "script",
      name: base,
      file,
      line: null,
      reason: "Nothing runs it: not mentioned in package.json, a Makefile, CI, docs or other scripts",
    });
  }

  const order = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
  items.sort((a, b) => order.get(a.category)! - order.get(b.category)! || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  return { items, entry_points: [...entries].sort(), files_scanned: facts.size, parse_errors: parseErrors };
}

/** Orphans in a project's `code/` folder (none when there is no such folder). */
export function buildOrphanReport(projectId: string): OrphanReport {
  const code = loadCodebase(projectId, isCodeFile);
  if (!code) return { items: [], entry_points: [], files_scanned: 0, parse_errors: [], truncated: false };
  const allFiles = code.entries.filter((e) => e.type === "file").map((e) => e.path);
  return { ...findOrphans({ sources: code.sources, configs: code.configs, allFiles, read: code.read }), truncated: code.truncated };
}
