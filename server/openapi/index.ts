import type { DocMap, OperationDoc, Schema } from "./types";
import { agentDocs, agentSchemas } from "./agent";
import { userDocs, userSchemas } from "./users";
import { lintDocs, lintSchemas } from "./lint";
import { qualityDocs, qualitySchemas } from "./quality";
import { normalizationDocs, normalizationSchemas } from "./normalization";
import { pullRequestDocs, pullRequestSchemas } from "./pullRequests";
import { projectDocs, projectSchemas } from "./projects";
import { ontologyDocs, ontologySchemas } from "./ontology";
import { analyticsDocs, analyticsSchemas } from "./analytics";
import { workspaceDocs, workspaceSchemas } from "./workspace";
import { importsDocs, importsSchemas } from "./imports";
import { githubDocs, githubSchemas } from "./github";
import { toolsDocs, toolsSchemas } from "./tools";

export const API_PREFIX = "/api/v1";

export const operationDocs: DocMap = {
  ...userDocs,
  ...lintDocs,
  ...qualityDocs,
  ...normalizationDocs,
  ...pullRequestDocs,
  ...projectDocs,
  ...ontologyDocs,
  ...analyticsDocs,
  ...agentDocs,
  ...workspaceDocs,
  ...importsDocs,
  ...githubDocs,
  ...toolsDocs,
};

const sharedSchemas: Record<string, Schema> = {
  Error: {
    type: "object",
    required: ["detail"],
    properties: { detail: { description: "Human-readable message, or structured detail for some validation errors." } },
  },
};

export const schemaSources: Record<string, Schema>[] = [
  sharedSchemas,
  userSchemas,
  lintSchemas,
  qualitySchemas,
  normalizationSchemas,
  pullRequestSchemas,
  projectSchemas,
  ontologySchemas,
  analyticsSchemas,
  agentSchemas,
  workspaceSchemas,
  importsSchemas,
  githubSchemas,
  toolsSchemas,
];

export const componentSchemas: Record<string, Schema> = Object.assign({}, ...schemaSources);

const sharedPathParams: Record<string, string> = {
  id: "Project id.",
  iri: "Full entity IRI, URL-encoded.",
  prNumber: "Pull request number within the project.",
  name: "Branch name, URL-encoded.",
  runId: "Run id.",
  jobId: "Background job id.",
  issueId: "Issue id.",
  commentId: "Comment id.",
};

/** Tag order in the sidebar, and a one-line description for each group. */
export const tags: { name: string; description: string }[] = [
  { name: "Projects", description: "Create, import and manage projects, their Turtle source and which file is the ontology." },
  { name: "Ontology", description: "Browse the class tree, read entities and search the ontology." },
  { name: "Branches", description: "Git branches of a project's repository." },
  { name: "Revisions", description: "Commit history, file contents at a revision and diffs." },
  { name: "Pull Requests", description: "Local pull requests between branches, with reviews and comments." },
  { name: "Lint", description: "Rule-based health checks of an ontology." },
  { name: "Quality", description: "Consistency checks and duplicate detection." },
  { name: "Normalization", description: "Canonical Turtle formatting of a project's source." },
  { name: "Analytics", description: "Change activity, contributors and entity history." },
  { name: "Agent", description: "Settings for, and chat with, the AI editing agent." },
  { name: "Users", description: "The local user and their preferences." },
  { name: "Health", description: "Server status." },
  { name: "Files", description: "Read, write and download files in a project's folder." },
  { name: "Terminals", description: "Shell and run-file terminal sessions in a project's folder." },
  { name: "Dev Server", description: "Configure, start and stop a project's dev server." },
  { name: "Tools", description: "Meta tools that analyze the code in a project's `code/` folder." },
  { name: "Imports", description: "Other ontologies a project imports (owl:imports), resolved from local projects or the web." },
  { name: "GitHub", description: "Link a project to a GitHub repository and push and pull." },
];

/** "/api/v1/projects/:id/lint/runs/:runId" → "/projects/{id}/lint/runs/{runId}" */
export function toDocPath(honoPath: string): { path: string; params: string[] } {
  const params: string[] = [];
  const path = honoPath
    .replace(API_PREFIX, "")
    .replace(/:([A-Za-z_]+)(\{[^}]*\})?/g, (_m, name: string) => {
      params.push(name);
      return `{${name}}`;
    });
  return { path: path || "/", params };
}

/** Group by resource: /projects/{id}/lint/... → "Lint", /agent/... → "Agent". */
export function tagFor(path: string): string {
  const segs = path.split("/").filter((s) => s && !s.startsWith("{"));
  const seg = segs[0] === "projects" && segs.length > 1 ? segs[1] : segs[0] || "general";
  const aliases: Record<string, string> = {
    "pr-settings": "pull-requests",
    entities: "ontology",
    "branch-preference": "branches",
    import: "projects",
    clone: "projects",
    source: "projects",
    "ontology-files": "projects",
    "ontology-file": "projects",
    "import-candidates": "imports",
  };
  const name = aliases[seg] ?? seg;
  if (name === "github") return "GitHub";
  return name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function operationObject(method: string, path: string, params: string[], doc: OperationDoc | undefined) {
  const parameters = [
    ...params.map((name) => ({
      name,
      in: "path",
      required: true,
      description: doc?.pathParams?.[name] ?? sharedPathParams[name],
      schema: { type: "string" },
    })),
    ...(doc?.query ?? []).map((q) => ({ in: "query", ...q })),
  ];
  const responses = Object.fromEntries(
    Object.entries(doc?.responses ?? { "200": { description: "Successful response" } }).map(([status, r]) => [
      status,
      r.schema ? { description: r.description, content: { [r.contentType ?? "application/json"]: { schema: r.schema } } } : { description: r.description },
    ]),
  );
  return {
    tags: [tagFor(path)],
    operationId: `${method.toLowerCase()}${path.replace(/[{}]/g, "").replace(/[/-](\w)/g, (_m, c: string) => c.toUpperCase())}`,
    summary: doc?.summary ?? `${method} ${path}`,
    ...(doc?.description ? { description: doc.description } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(doc?.body
      ? {
          requestBody: {
            required: doc.body.required ?? false,
            ...(doc.body.description ? { description: doc.body.description } : {}),
            content: { [doc.body.contentType ?? "application/json"]: { schema: doc.body.schema } },
          },
        }
      : {}),
    responses,
  };
}

export function buildOpenApiSpec(routes: { method: string; path: string }[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    if (r.method === "ALL" || r.path.endsWith("/openapi.json")) continue;
    const { path, params } = toDocPath(r.path);
    const doc = operationDocs[`${r.method} ${path}`];
    (paths[`${API_PREFIX}${path}`] ??= {})[r.method.toLowerCase()] = operationObject(r.method, path, params, doc);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "OntoBuilder API",
      version: "1.0.0",
      description:
        "The HTTP API behind the OntoBuilder app. It runs locally with no authentication.\n\n" +
        "Errors return a JSON body of the form `{ \"detail\": \"...\" }`. Entity IRIs and branch names in paths must be URL-encoded. " +
        "Most project routes accept a `branch` query parameter and default to the repository's default branch.",
    },
    tags,
    paths,
    components: { schemas: componentSchemas },
  };
}
