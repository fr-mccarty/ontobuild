import { error, ref, type DocMap, type QueryParamDoc, type Schema } from "./types";

export const importsSchemas: Record<string, Schema> = {
  ImportStatus: {
    type: "object",
    description: "One ontology in the transitive closure of a project's `owl:imports`.",
    required: ["iri", "source", "status", "class_count", "direct", "imported_by", "label"],
    properties: {
      iri: { type: "string", description: "The imported ontology IRI, as written in `owl:imports`." },
      source: {
        type: "string",
        enum: ["project", "remote"],
        description:
          "`project`: another OntoBuild project whose ontology IRI matches, read from its default branch. `remote`: fetched over http(s) and cached.",
      },
      project_id: { type: "string", description: "Set when `source` is `project`." },
      project_name: { type: "string", description: "Set when `source` is `project`." },
      status: {
        type: "string",
        enum: ["ok", "error", "cycle"],
        description: "`cycle` marks an import of the importing ontology itself (directly or through other imports).",
      },
      error: { type: "string", description: "Why the import could not be resolved (status `error` or `cycle`)." },
      class_count: { type: "integer", description: "Number of classes the imported ontology declares." },
      direct: { type: "boolean", description: "True when the project's own ontology imports it; false when it comes in through another import." },
      imported_by: {
        type: "array",
        items: { type: "string" },
        description: "IRIs of the ontologies in the closure that import it (the project's own ontology IRI for direct imports).",
      },
      label: { type: ["string", "null"], description: "Project name or the ontology's title/label." },
      fetched_at: {
        type: ["string", "null"],
        format: "date-time",
        description: "For remote imports: when the cached copy was fetched (null if it could not be fetched).",
      },
    },
  },
  ImportsResponse: {
    type: "object",
    required: ["direct", "closure"],
    properties: {
      direct: {
        type: "array",
        items: { type: "string" },
        description: "IRIs in the ontology header's `owl:imports`, in source order.",
      },
      closure: {
        type: "array",
        items: ref("ImportStatus"),
        description: "Every ontology reached through imports (breadth-first, depth limit 10), with its resolution status.",
      },
    },
  },
  ImportCandidate: {
    type: "object",
    required: ["project_id", "name", "ontology_iri", "description"],
    properties: {
      project_id: { type: "string" },
      name: { type: "string" },
      ontology_iri: { type: "string", description: "The IRI to import: the owl:Ontology IRI on the project's default branch." },
      description: { type: ["string", "null"] },
    },
  },
};

const branchQuery: QueryParamDoc = {
  name: "branch",
  description: "Branch whose ontology to read or edit. Defaults to the repository's default branch.",
  schema: { type: "string" },
};

const importsResponse = (description: string) => ({ description, schema: ref("ImportsResponse") });

export const importsDocs: DocMap = {
  "GET /projects/{id}/imports": {
    summary: "List ontology imports",
    description:
      "Returns the ontology's direct `owl:imports` and their transitive closure. Each IRI resolves to another OntoBuild project with that ontology IRI, " +
      "or else to the document fetched from the IRI (cached on disk; see the refresh operation).",
    query: [branchQuery],
    responses: {
      "200": importsResponse("Direct imports and the resolved closure."),
      "404": error("Project, branch or ontology file not found."),
      "422": error("The ontology could not be parsed."),
    },
  },
  "POST /projects/{id}/imports": {
    summary: "Add an ontology import",
    description:
      "Adds `owl:imports <iri>` to the ontology header (creating an `owl:Ontology` header if there is none) and commits the change. " +
      "An IRI that no OntoBuild project has as its ontology IRI must be http(s) so that it can be fetched.",
    query: [branchQuery],
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["iri"],
        properties: {
          iri: { type: "string", description: "Ontology IRI to import." },
          commit_message: { type: "string", maxLength: 500, description: "Defaults to a generated message." },
        },
      },
    },
    responses: {
      "200": importsResponse("The import was added; the updated imports."),
      "400": error("The ontology would import itself, or the IRI is neither a local project's ontology IRI nor an http(s) URL."),
      "404": error("Project, branch or ontology file not found."),
      "409": error("The ontology already imports this IRI."),
      "422": error("`iri` is missing or not an absolute IRI, `commit_message` is invalid, or the ontology could not be parsed."),
    },
  },
  "DELETE /projects/{id}/imports": {
    summary: "Remove an ontology import",
    description: "Removes the `owl:imports <iri>` triple from the ontology and commits the change.",
    query: [
      branchQuery,
      { name: "iri", description: "The imported IRI to remove.", required: true, schema: { type: "string" } },
      { name: "commit_message", description: "Defaults to a generated message.", schema: { type: "string", maxLength: 500 } },
    ],
    responses: {
      "200": importsResponse("The import was removed; the updated imports."),
      "404": error("Project, branch or ontology file not found, or the ontology does not import this IRI."),
      "422": error("`iri` is missing, `commit_message` is too long, or the ontology could not be parsed."),
    },
  },
  "POST /projects/{id}/imports/refresh": {
    summary: "Refresh remote imports",
    description: "Fetches every remote import in the closure again, replacing the cached copies, and returns the updated imports.",
    query: [branchQuery],
    responses: {
      "200": importsResponse("The imports after re-fetching."),
      "404": error("Project, branch or ontology file not found."),
      "422": error("The ontology could not be parsed."),
    },
  },
  "GET /import-candidates": {
    summary: "Search projects to import",
    description:
      "Lists OntoBuild projects that have an ontology IRI, matching `q` against the project name and ontology IRI (case-insensitive). At most 50 results.",
    query: [{ name: "q", description: "Search text. Empty lists every candidate.", schema: { type: "string", maxLength: 200 } }],
    responses: {
      "200": { description: "Matching projects.", schema: { type: "array", items: ref("ImportCandidate") } },
      "422": error("`q` is longer than 200 characters."),
    },
  },
};
