import path from "node:path";
import ts from "typescript";
import {
  Resolver,
  containsJsx,
  hasModifier,
  isCapitalized,
  lazyImport,
  loadCodebase,
  parseConfig,
  pascalFromFile,
  scriptKind,
  unwrapComponentExpression,
  type ConfigScope,
  type ImportBinding,
  type SourceFile,
} from "./codebase";

export { isSourceFile, MAX_SOURCE_FILES, type SourceFile } from "./codebase";

/**
 * Component tree of the React code in a project's `code/` folder, read statically from
 * the source (the project's dev server doesn't need to be running).
 *
 * Every .tsx/.jsx/.ts/.js file is parsed with the TypeScript compiler. A component is a
 * capitalized function, arrow function or class that contains JSX (also when wrapped in
 * memo/forwardRef or similar). Each JSX tag a component renders is resolved through the
 * file's imports, barrel re-exports and tsconfig/jsconfig `paths` to another component
 * in `code/`; tags from packages become "external" nodes, and tags that resolve to no
 * function or class component (a prop, or an alias like `const Dialog = Primitive.Root`)
 * become "unknown" nodes. JSX outside any component (for example
 * `createRoot(...).render(<App />)` in main.tsx) belongs to a "module" node for its file.
 */

export type ComponentNodeKind = "component" | "module" | "external" | "unknown";

export interface ComponentChild {
  id: string;
  /** How many times the parent renders it. */
  count: number;
  /** Line of the first place the parent renders it. */
  line: number;
}

export interface ComponentNode {
  id: string;
  name: string;
  kind: ComponentNodeKind;
  /** Project-relative file ("code/src/App.tsx"); null for external and unknown nodes. */
  file: string | null;
  line: number | null;
  exported: boolean;
  /** Import specifier of an external component ("react-router-dom"). */
  source: string | null;
  children: ComponentChild[];
}

export interface ComponentTree {
  nodes: ComponentNode[];
  /** Components and modules no other component in `code/` renders, in file order. */
  roots: string[];
  files_scanned: number;
  parse_errors: { file: string; message: string }[];
  /** True when `code/` had more source files than are scanned. */
  truncated: boolean;
}

const FRAGMENTS = new Set(["Fragment", "React.Fragment"]);

// ── Per-file parse ───────────────────────────────────────────────────────

interface Render {
  tag: string;
  line: number;
}

interface LocalComponent {
  name: string;
  line: number;
  renders: Render[];
}

interface ParsedFile {
  path: string;
  imports: Map<string, ImportBinding>;
  components: Map<string, LocalComponent>;
  /** Exported name → local name. */
  exports: Map<string, string>;
  /** `export { a as b } from "x"` (from "a", as "b") and `export * from "x"` (from and as "*"). */
  reexports: { spec: string; from: string; as: string }[];
  moduleRenders: Render[];
}

export function parseSource(file: SourceFile): ParsedFile {
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, scriptKind(file.path));
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const parsed: ParsedFile = {
    path: file.path,
    imports: new Map(),
    components: new Map(),
    exports: new Map(),
    reexports: [],
    moduleRenders: [],
  };
  /** Nodes whose JSX belongs to a component, with that component's name. */
  const bodies: { node: ts.Node; name: string }[] = [];

  const addComponent = (name: string, node: ts.Node, at: ts.Node) => {
    if (parsed.components.has(name)) return;
    parsed.components.set(name, { name, line: lineOf(at), renders: [] });
    bodies.push({ node, name });
  };

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const spec = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (!clause) continue;
      if (clause.name) parsed.imports.set(clause.name.text, { spec, name: "default" });
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) parsed.imports.set(nb.name.text, { spec, name: "*" });
      else if (nb) for (const el of nb.elements) parsed.imports.set(el.name.text, { spec, name: (el.propertyName ?? el.name).text });
      continue;
    }

    if (ts.isExportDeclaration(stmt)) {
      const spec = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : null;
      const clause = stmt.exportClause;
      if (spec) {
        if (!clause) parsed.reexports.push({ spec, from: "*", as: "*" });
        else if (ts.isNamedExports(clause))
          for (const el of clause.elements) parsed.reexports.push({ spec, from: (el.propertyName ?? el.name).text, as: el.name.text });
      } else if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) parsed.exports.set(el.name.text, (el.propertyName ?? el.name).text);
      }
      continue;
    }

    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      let e = stmt.expression;
      while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
      if (ts.isIdentifier(e)) {
        parsed.exports.set("default", e.text);
      } else if (ts.isCallExpression(e) && e.arguments.length > 0 && ts.isIdentifier(e.arguments[0]) && !containsJsx(e)) {
        // export default memo(Foo)
        parsed.exports.set("default", (e.arguments[0] as ts.Identifier).text);
      } else {
        const fn = unwrapComponentExpression(e);
        if (fn && containsJsx(fn)) {
          const name = pascalFromFile(file.path);
          addComponent(name, fn, stmt);
          parsed.exports.set("default", name);
        }
      }
      continue;
    }

    const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);

    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
      const declared = stmt.name?.text;
      const name = declared ?? (isDefault ? pascalFromFile(file.path) : null);
      if (name && isCapitalized(name) && containsJsx(stmt)) addComponent(name, stmt, stmt);
      if (exported && name) parsed.exports.set(isDefault ? "default" : name, name);
      continue;
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        if (exported) parsed.exports.set(name, name);
        if (!decl.initializer || !isCapitalized(name)) continue;
        const lazy = lazyImport(decl.initializer);
        if (lazy) {
          parsed.imports.set(name, lazy);
          continue;
        }
        const fn = unwrapComponentExpression(decl.initializer);
        if (fn && containsJsx(fn)) addComponent(name, decl.initializer, decl);
      }
    }
  }

  // Assign every JSX tag to the component whose body contains it, else to the module.
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      const intrinsic = !tag.includes(".") && !isCapitalized(tag);
      if (!intrinsic && !FRAGMENTS.has(tag) && !tag.startsWith("this.") && !ts.isJsxNamespacedName(n.tagName)) {
        const pos = n.getStart(sf);
        const owner = bodies.find((b) => pos >= b.node.getStart(sf) && pos < b.node.end);
        const render = { tag, line: lineOf(n) };
        if (owner) parsed.components.get(owner.name)!.renders.push(render);
        else parsed.moduleRenders.push(render);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return parsed;
}

// ── Tree assembly ────────────────────────────────────────────────────────

const componentId = (file: string, name: string) => `${file}#${name}`;
const moduleId = (file: string) => `${file}#(module)`;

export function buildTreeFromSources(sources: SourceFile[], configFiles: SourceFile[] = []): Omit<ComponentTree, "truncated"> {
  const parsed = new Map<string, ParsedFile>();
  const parseErrors: { file: string; message: string }[] = [];
  for (const s of sources) {
    try {
      parsed.set(s.path, parseSource(s));
    } catch (e) {
      parseErrors.push({ file: s.path, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const configs = configFiles.map(parseConfig).filter((c): c is ConfigScope => c !== null);
  const resolver = new Resolver(new Set(sources.map((s) => s.path)), configs);

  const nodes = new Map<string, ComponentNode>();
  const exportedIds = new Set<string>();

  const resolveExport = (file: string, name: string, seen: Set<string>): string | null => {
    const key = `${file}:${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const f = parsed.get(file);
    if (!f) return null;
    const local = f.exports.get(name);
    if (local !== undefined) return resolveLocal(f, local, seen);
    for (const re of f.reexports) {
      if (re.as === name) {
        const target = resolver.resolve(file, re.spec);
        if (target) return resolveExport(target, re.from, seen);
      } else if (re.as === "*" && name !== "default") {
        const target = resolver.resolve(file, re.spec);
        const hit = target ? resolveExport(target, name, seen) : null;
        if (hit) return hit;
      }
    }
    return null;
  };

  const resolveLocal = (f: ParsedFile, local: string, seen: Set<string>): string | null => {
    if (f.components.has(local)) return componentId(f.path, local);
    const binding = f.imports.get(local);
    if (binding && binding.name !== "*") {
      const target = resolver.resolve(f.path, binding.spec);
      if (target) return resolveExport(target, binding.name, seen);
    }
    return null;
  };

  for (const f of parsed.values()) {
    for (const local of f.exports.values()) if (f.components.has(local)) exportedIds.add(componentId(f.path, local));
    for (const c of f.components.values()) {
      const id = componentId(f.path, c.name);
      nodes.set(id, { id, name: c.name, kind: "component", file: f.path, line: c.line, exported: false, source: null, children: [] });
    }
    if (f.moduleRenders.length > 0) {
      const id = moduleId(f.path);
      nodes.set(id, {
        id,
        name: path.posix.basename(f.path),
        kind: "module",
        file: f.path,
        line: f.moduleRenders[0].line,
        exported: false,
        source: null,
        children: [],
      });
    }
  }
  for (const id of exportedIds) {
    const n = nodes.get(id);
    if (n) n.exported = true;
  }

  /** Target node id for a tag rendered in file f (creating external/unknown nodes as needed). */
  const resolveTag = (f: ParsedFile, tag: string): string => {
    const dot = tag.indexOf(".");
    const head = dot >= 0 ? tag.slice(0, dot) : tag;
    const member = dot >= 0 ? tag.slice(dot + 1) : null;
    const binding = f.imports.get(head);

    let hit: string | null = null;
    if (member === null) hit = resolveLocal(f, head, new Set());
    else if (binding?.name === "*") {
      const target = resolver.resolve(f.path, binding.spec);
      if (target && !member.includes(".")) hit = resolveExport(target, member, new Set());
    }
    if (hit && nodes.has(hit)) return hit;

    const internalTarget = binding ? resolver.resolve(f.path, binding.spec) : null;
    if (binding && !internalTarget && !binding.spec.startsWith(".")) {
      const id = `external:${binding.spec}#${tag}`;
      if (!nodes.has(id))
        nodes.set(id, { id, name: tag, kind: "external", file: null, line: null, exported: false, source: binding.spec, children: [] });
      return id;
    }
    const id = `unknown:${f.path}#${tag}`;
    if (!nodes.has(id))
      nodes.set(id, { id, name: tag, kind: "unknown", file: null, line: null, exported: false, source: null, children: [] });
    return id;
  };

  const link = (parent: ComponentNode, f: ParsedFile, renders: Render[]) => {
    const byId = new Map<string, ComponentChild>();
    for (const r of renders) {
      const id = resolveTag(f, r.tag);
      const existing = byId.get(id);
      if (existing) existing.count += 1;
      else byId.set(id, { id, count: 1, line: r.line });
    }
    parent.children = [...byId.values()];
  };

  for (const f of parsed.values()) {
    for (const c of f.components.values()) link(nodes.get(componentId(f.path, c.name))!, f, c.renders);
    if (f.moduleRenders.length > 0) link(nodes.get(moduleId(f.path))!, f, f.moduleRenders);
  }

  // Roots: internal nodes nothing else renders, in file order; then one node from each
  // cycle that no root reaches, so every component shows up somewhere.
  const internal = [...nodes.values()].filter((n) => n.kind === "component" || n.kind === "module");
  const rendered = new Set<string>();
  for (const n of internal) for (const c of n.children) if (c.id !== n.id) rendered.add(c.id);
  const roots = internal.filter((n) => !rendered.has(n.id)).map((n) => n.id);
  const reached = new Set<string>();
  const reach = (id: string) => {
    if (reached.has(id)) return;
    reached.add(id);
    for (const c of nodes.get(id)?.children ?? []) reach(c.id);
  };
  roots.forEach(reach);
  for (const n of internal) {
    if (!reached.has(n.id)) {
      roots.push(n.id);
      reach(n.id);
    }
  }

  return { nodes: [...nodes.values()], roots, files_scanned: parsed.size, parse_errors: parseErrors };
}

// ── Project entry point ──────────────────────────────────────────────────

/** The component tree of a project's `code/` folder (empty when there is no such folder). */
export function buildComponentTree(projectId: string): ComponentTree {
  const code = loadCodebase(projectId);
  if (!code) return { nodes: [], roots: [], files_scanned: 0, parse_errors: [], truncated: false };
  return { ...buildTreeFromSources(code.sources, code.configs), truncated: code.truncated };
}
