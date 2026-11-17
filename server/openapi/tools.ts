import { error, ref, type DocMap, type Schema } from "./types";

export const toolsSchemas: Record<string, Schema> = {
  OrphanItem: {
    type: "object",
    required: ["id", "category", "name", "file", "line", "reason"],
    properties: {
      id: { type: "string", examples: ["function:code/src/utils.ts#formatDate"] },
      category: { type: "string", enum: ["file", "component", "class", "function", "variable", "type", "test", "script"] },
      name: { type: "string", description: "Declaration, file or npm script name." },
      file: { type: "string", description: "Project-relative file the item is in." },
      line: { type: ["integer", "null"], description: "1-based line of a declaration or npm script." },
      reason: { type: "string", examples: ["Exported, but nothing imports it"] },
    },
  },
  ComponentTreeNode: {
    type: "object",
    required: ["id", "name", "kind", "file", "line", "exported", "source", "children"],
    properties: {
      id: { type: "string", description: "Stable id: `<file>#<name>` for components, `<file>#(module)` for modules.", examples: ["code/src/App.tsx#App"] },
      name: { type: "string", description: "Component name, or the file name for a module node.", examples: ["App"] },
      kind: {
        type: "string",
        enum: ["component", "module", "external", "unknown"],
        description:
          "`component`: declared in `code/`. `module`: JSX outside any component in a file (for example main.tsx). " +
          "`external`: imported from a package. `unknown`: a tag that doesn't resolve to a function or class component (a prop, or an alias of a library component).",
      },
      file: { type: ["string", "null"], description: "Project-relative file for components and modules." },
      line: { type: ["integer", "null"], description: "1-based line of the declaration." },
      exported: { type: "boolean" },
      source: { type: ["string", "null"], description: "Import specifier of an external component.", examples: ["react-router-dom"] },
      children: {
        type: "array",
        description: "Components this one renders, in the order they first appear.",
        items: {
          type: "object",
          required: ["id", "count", "line"],
          properties: {
            id: { type: "string" },
            count: { type: "integer", description: "Number of JSX elements of that component." },
            line: { type: "integer", description: "Line of the first one." },
          },
        },
      },
    },
  },
};


export const toolsDocs: DocMap = {
  "GET /projects/{id}/tools/orphans": {
    summary: "Orphaned code",
    description:
      "Finds files, components, classes, functions, variables and types that nothing uses, tests that import missing code, " +
      "and scripts nothing runs, in the project's `code/` folder. Entry points come from Next.js conventions, package.json, " +
      "index.html and config files; without any, files are reported only when nothing imports them.",
    responses: {
      "200": {
        description: "Orphans, ordered by category, file and line.",
        schema: {
          type: "object",
          required: ["items", "entry_points", "files_scanned", "parse_errors", "truncated"],
          properties: {
            items: { type: "array", items: ref("OrphanItem") },
            entry_points: { type: "array", items: { type: "string" }, description: "Files treated as entry points." },
            files_scanned: { type: "integer" },
            parse_errors: {
              type: "array",
              items: { type: "object", required: ["file", "message"], properties: { file: { type: "string" }, message: { type: "string" } } },
            },
            truncated: { type: "boolean", description: "True when `code/` had more files than are scanned." },
          },
        },
      },
      "404": error("Project not found."),
    },
  },
  "GET /projects/{id}/tools/component-tree": {
    summary: "React component tree",
    description:
      "Parses the `.tsx`, `.jsx`, `.ts` and `.js` files in the project's `code/` folder and returns which components render which. " +
      "Imports, barrel re-exports and tsconfig/jsconfig `paths` are followed; test and story files are skipped. " +
      "Returns an empty tree when there is no `code/` folder.",
    responses: {
      "200": {
        description: "Every component with its children, and the roots (components nothing else renders).",
        schema: {
          type: "object",
          required: ["nodes", "roots", "files_scanned", "parse_errors", "truncated"],
          properties: {
            nodes: { type: "array", items: ref("ComponentTreeNode") },
            roots: { type: "array", items: { type: "string" } },
            files_scanned: { type: "integer" },
            parse_errors: {
              type: "array",
              items: { type: "object", required: ["file", "message"], properties: { file: { type: "string" }, message: { type: "string" } } },
            },
            truncated: { type: "boolean", description: "True when `code/` had more source files than are scanned." },
          },
        },
      },
      "404": error("Project not found."),
    },
  },
};
