import { RDF_FILE_EXTENSIONS } from "@/lib/ontology/rdfFormats";
import { error, ref, type DocMap, type Schema } from "./types";

export const projectSchemas: Record<string, Schema> = {
  ProjectNormalizationReport: {
    type: "object",
    description: "What changed when an imported file was normalized to Turtle.",
    required: [
      "original_format",
      "original_filename",
      "original_size_bytes",
      "normalized_size_bytes",
      "triple_count",
      "prefixes_before",
      "prefixes_after",
      "prefixes_removed",
      "prefixes_added",
      "format_converted",
      "notes",
    ],
    properties: {
      original_format: { type: "string", examples: ["RDF/XML"] },
      original_filename: { type: "string", examples: ["pizza.owl"] },
      original_size_bytes: { type: "integer" },
      normalized_size_bytes: { type: "integer" },
      triple_count: { type: "integer" },
      prefixes_before: { type: "array", items: { type: "string" } },
      prefixes_after: { type: "array", items: { type: "string" } },
      prefixes_removed: { type: "array", items: { type: "string" } },
      prefixes_added: { type: "array", items: { type: "string" } },
      format_converted: { type: "boolean", description: "True when the source was not already Turtle." },
      notes: {
        type: "array",
        items: { type: "string" },
        description: "Human-readable notes, for example format conversion or language tags removed from literals.",
      },
    },
  },
  Project: {
    type: "object",
    required: [
      "id",
      "name",
      "description",
      "is_public",
      "created_at",
      "updated_at",
      "source_file_path",
      "git_ontology_path",
      "folder",
      "ontology_iri",
      "label_preferences",
      "normalization_report",
    ],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      is_public: { type: "boolean" },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: ["string", "null"], format: "date-time" },
      source_file_path: { type: ["string", "null"], examples: ["projects/abc123/ontology.ttl"] },
      git_ontology_path: {
        type: ["string", "null"],
        description: "Path of the ontology file inside the project's repository.",
        examples: ["ontology.ttl"],
      },
      folder: {
        type: ["string", "null"],
        description:
          "Name of the project's folder under the data directory's projects/ folder. It holds the git working tree: the ontology file and a code/ folder. Chosen from the project name when the project is created and kept when it is renamed.",
        examples: ["pizza-ontology"],
      },
      ontology_iri: { type: ["string", "null"], format: "uri" },
      label_preferences: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "Ordered label property IRIs or CURIEs used to pick display labels.",
      },
      normalization_report: {
        oneOf: [ref("ProjectNormalizationReport"), { type: "null" }],
        description: "Set for imported projects.",
      },
    },
  },
  ProjectRevision: {
    type: "object",
    required: [
      "hash",
      "short_hash",
      "message",
      "author_name",
      "author_email",
      "timestamp",
      "is_merge",
      "merged_branch",
      "parent_hashes",
    ],
    properties: {
      hash: { type: "string" },
      short_hash: { type: "string", description: "First 8 characters of the hash." },
      message: { type: "string", description: "Full commit message." },
      author_name: { type: "string" },
      author_email: { type: "string" },
      timestamp: { type: "string", format: "date-time" },
      is_merge: { type: "boolean" },
      merged_branch: {
        type: ["string", "null"],
        description: "For merge commits, the branch that was merged, from the message or the pull request that made it.",
      },
      parent_hashes: { type: "array", items: { type: "string" } },
    },
  },
  ProjectFileChange: {
    type: "object",
    required: ["path", "change_type", "old_path", "additions", "deletions", "patch"],
    properties: {
      path: { type: "string" },
      change_type: {
        type: "string",
        description: "Git status letter: `A` added, `M` modified, `D` deleted, `R` renamed, `C` copied, and so on.",
        examples: ["M"],
      },
      old_path: { type: ["string", "null"], description: "Previous path, for renames only." },
      additions: { type: "integer" },
      deletions: { type: "integer" },
      patch: { type: ["string", "null"], description: "Unified diff for this file." },
    },
  },
  ProjectBranch: {
    type: "object",
    required: [
      "name",
      "is_current",
      "is_default",
      "commit_hash",
      "commit_message",
      "commit_date",
      "commits_ahead",
      "commits_behind",
      "created_by_id",
      "created_by_name",
      "can_delete",
      "has_open_pr",
      "has_delete_permission",
    ],
    properties: {
      name: { type: "string" },
      is_current: { type: "boolean", description: "True for the branch the repository's HEAD points to." },
      is_default: { type: "boolean" },
      commit_hash: { type: ["string", "null"] },
      commit_message: { type: ["string", "null"], description: "Subject line of the tip commit." },
      commit_date: { type: ["string", "null"], format: "date-time" },
      commits_ahead: { type: "integer", description: "Commits on this branch that are not on the default branch." },
      commits_behind: { type: "integer", description: "Commits on the default branch that are not on this branch." },
      created_by_id: { type: ["string", "null"] },
      created_by_name: { type: ["string", "null"] },
      can_delete: { type: "boolean", description: "False for the default branch and branches with an open pull request." },
      has_open_pr: { type: "boolean" },
      has_delete_permission: { type: "boolean" },
    },
  },
};

const branchQuery = {
  name: "branch",
  description: "Branch to use. Defaults to the project's default branch.",
  schema: { type: "string" },
};

const projectFields = {
  name: { type: "string", minLength: 1, maxLength: 255 },
  description: { type: ["string", "null"], maxLength: 5000 },
  is_public: { type: "boolean" },
};

export const projectDocs: DocMap = {
  "GET /projects": {
    summary: "List projects",
    description: "Lists projects, newest first.",
    query: [
      { name: "skip", description: "Number of projects to skip.", schema: { type: "integer", minimum: 0, default: 0 } },
      { name: "limit", description: "Maximum number of projects to return.", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
      {
        name: "search",
        description: "Case-insensitive substring match on name or description.",
        schema: { type: "string", maxLength: 200 },
      },
    ],
    responses: {
      "200": {
        description: "A page of projects.",
        schema: {
          type: "object",
          required: ["items", "total", "unfiltered_total", "skip", "limit"],
          properties: {
            items: { type: "array", items: ref("Project") },
            total: { type: "integer", description: "Number of projects matching the search." },
            unfiltered_total: { type: "integer", description: "Number of projects ignoring the search." },
            skip: { type: "integer" },
            limit: { type: "integer" },
          },
        },
      },
      "422": error("A query parameter is invalid."),
    },
  },
  "POST /projects": {
    summary: "Create a project",
    description:
      "Creates a project with a new Git repository and a starter Turtle file declaring an `owl:Ontology` with the given title and description. " +
      "The ontology IRI is derived from the name, e.g. `http://example.org/ontologies/my-ontology`.",
    body: {
      required: true,
      schema: { type: "object", required: ["name"], properties: projectFields },
    },
    responses: {
      "201": { description: "The new project.", schema: ref("Project") },
      "422": error("The name is missing or too long, or the description is too long."),
    },
  },
  "POST /projects/import": {
    summary: "Import a project",
    description:
      "Creates a project from an uploaded RDF file. The file is parsed, converted to Turtle, normalized, and stripped of language tags " +
      "(literals are stored as plain strings). The project name and description default to the ontology's title and description, then to the file name. " +
      `Supported extensions: ${RDF_FILE_EXTENSIONS.map((e) => `\`${e}\``).join(", ")}.`,
    body: {
      required: true,
      contentType: "multipart/form-data",
      schema: {
        type: "object",
        required: ["file"],
        properties: {
          file: { type: "string", format: "binary", description: "RDF file, at most 50 MB." },
          is_public: { type: "string", enum: ["true", "false"], description: "Defaults to false. The UI does not use it." },
          name: { type: "string", description: "Overrides the project name." },
          description: { type: "string", description: "Overrides the project description." },
        },
      },
    },
    responses: {
      "201": {
        description: "The new project, with its normalization report.",
        schema: {
          allOf: [
            ref("Project"),
            { type: "object", required: ["file_path"], properties: { file_path: { type: ["string", "null"], description: "Same as `source_file_path`." } } },
          ],
        },
      },
      "400": error("The file extension is not supported."),
      "413": error("The file is larger than 50 MB. Checked from `Content-Length` before the upload is read, when the header is present."),
      "422": error("The body is not multipart, a required field is missing, or the file could not be parsed."),
    },
  },
  "GET /projects/{id}": {
    summary: "Get a project",
    responses: {
      "200": { description: "The project.", schema: ref("Project") },
      "404": error("Project not found."),
    },
  },
  "PATCH /projects/{id}": {
    summary: "Update a project",
    description:
      "Updates any subset of the fields; omitted fields are left unchanged. `name` is trimmed and must not be blank; " +
      "`name`, `is_public` and `label_preferences` ignore `null`, while `description: null` (or `\"\"`) clears the description. " +
      "A changed name or new description is also written to the ontology's title and description on the default branch as a new commit " +
      "(clearing the description does not remove it from the ontology).",
    body: {
      required: true,
      schema: {
        type: "object",
        properties: {
          name: { type: ["string", "null"], minLength: 1, maxLength: 255, description: "Trimmed; must not be blank." },
          description: { type: ["string", "null"], maxLength: 5000, description: "null or an empty string clears it." },
          is_public: { type: ["boolean", "null"] },
          label_preferences: {
            type: ["array", "null"],
            items: { type: "string" },
            description: "Ordered label properties. Any `@lang` suffix is dropped and duplicates are removed.",
          },
        },
      },
    },
    responses: {
      "200": { description: "The updated project.", schema: ref("Project") },
      "404": error("Project not found."),
      "422": error("The name or description is invalid, or the body is not valid JSON."),
    },
  },
  "DELETE /projects/{id}": {
    summary: "Delete a project",
    description: "Deletes the project and its Git repository.",
    responses: {
      "204": { description: "The project was deleted." },
      "404": error("Project not found."),
    },
  },
  "GET /projects/{id}/source": {
    summary: "Get Turtle source",
    description:
      "Returns the ontology file at the tip of a branch. Send `Accept: text/turtle` to get the raw file instead of the JSON wrapper.",
    query: [branchQuery],
    responses: {
      "200": {
        description: "The Turtle source. With `Accept: text/turtle` the body is the raw file.",
        schema: {
          type: "object",
          required: ["project_id", "branch", "commit_hash", "filename", "content"],
          properties: {
            project_id: { type: "string" },
            branch: { type: "string" },
            commit_hash: { type: "string" },
            filename: { type: "string", examples: ["ontology.ttl"] },
            content: { type: "string", description: "Turtle source." },
          },
        },
      },
      "404": error("Project, repository, branch or ontology file not found."),
    },
  },
  "PUT /projects/{id}/source": {
    summary: "Save Turtle source",
    description:
      "Commits new Turtle source to a branch. Language tags are stripped from literals before saving, so literals are stored as plain strings.",
    query: [branchQuery],
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["content", "commit_message"],
        properties: {
          content: { type: "string", description: "Full Turtle source." },
          commit_message: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
    responses: {
      "200": {
        description: "The commit that was made.",
        schema: {
          type: "object",
          required: ["success", "commit_hash", "commit_message", "branch"],
          properties: {
            success: { type: "boolean", const: true },
            commit_hash: { type: "string" },
            commit_message: { type: "string" },
            branch: { type: "string" },
          },
        },
      },
      "400": error("The project has no ontology file."),
      "404": error("Project or repository not found."),
      "422": error("A field is missing or invalid, or the content is not valid Turtle."),
      "500": error("The commit failed for an unexpected reason."),
    },
  },
  "GET /projects/{id}/revisions": {
    summary: "List revisions",
    description:
      "Lists recent commits across all branches, newest first. A project without a repository has no history yet, so this returns an " +
      "empty list rather than 404 (like `GET /projects/{id}/branches`); routes that address one revision return 404 instead.",
    query: [
      { name: "limit", description: "Maximum number of commits.", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
    ],
    responses: {
      "200": {
        description: "Commit history.",
        schema: {
          type: "object",
          required: ["project_id", "commits", "total", "refs"],
          properties: {
            project_id: { type: "string" },
            commits: { type: "array", items: ref("ProjectRevision") },
            total: { type: "integer", description: "Number of commits returned." },
            refs: {
              type: "object",
              additionalProperties: { type: "array", items: { type: "string" } },
              description: "Branch names keyed by the commit hash they point to.",
            },
          },
        },
      },
      "404": error("Project not found."),
      "422": error("`limit` is out of range."),
    },
  },
  "GET /projects/{id}/revisions/file": {
    summary: "Get file at revision",
    query: [
      { name: "version", description: "Commit hash, branch or other Git ref.", schema: { type: "string" }, required: true },
      {
        name: "filename",
        description: "Path in the repository. `ontology.ttl` means the project's ontology file, whatever its actual path.",
        schema: { type: "string", default: "ontology.ttl" },
      },
    ],
    responses: {
      "200": {
        description: "The file content.",
        schema: {
          type: "object",
          required: ["project_id", "version", "filename", "content"],
          properties: {
            project_id: { type: "string" },
            version: { type: "string" },
            filename: { type: "string" },
            content: { type: "string" },
          },
        },
      },
      "404": error("Project, repository, revision or file not found."),
      "422": error("`version` is missing."),
    },
  },
  "GET /projects/{id}/revisions/diff": {
    summary: "Diff two revisions",
    query: [
      { name: "from_version", description: "Base commit hash or ref.", schema: { type: "string" }, required: true },
      { name: "to_version", description: "Target commit hash or ref.", schema: { type: "string", default: "HEAD" } },
    ],
    responses: {
      "200": {
        description: "Per-file changes between the two revisions.",
        schema: {
          type: "object",
          required: ["project_id", "from_version", "to_version", "files_changed", "total_additions", "total_deletions", "changes"],
          properties: {
            project_id: { type: "string" },
            from_version: { type: "string" },
            to_version: { type: "string" },
            files_changed: { type: "integer" },
            total_additions: { type: "integer", description: "Lines added across all files." },
            total_deletions: { type: "integer", description: "Lines deleted across all files." },
            changes: { type: "array", items: ref("ProjectFileChange") },
          },
        },
      },
      "400": error("A revision could not be resolved or the diff failed."),
      "404": error("Project or repository not found."),
      "422": error("`from_version` is missing."),
    },
  },
  "GET /projects/{id}/branches": {
    summary: "List branches",
    description:
      "A project without a repository returns an empty `items` list with the default branch name, so the branch selector " +
      "still renders; it is not a 404.",
    responses: {
      "200": {
        description: "The project's branches.",
        schema: {
          type: "object",
          required: ["items", "current_branch", "default_branch", "preferred_branch"],
          properties: {
            items: { type: "array", items: ref("ProjectBranch") },
            current_branch: { type: "string", description: "Same as `default_branch`." },
            default_branch: { type: "string" },
            preferred_branch: {
              type: ["string", "null"],
              description: "Branch the editor opens by default, set with `PUT /projects/{id}/branch-preference`.",
            },
          },
        },
      },
      "404": error("Project not found."),
    },
  },
  "POST /projects/{id}/branches": {
    summary: "Create a branch",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 255, description: "Must be a valid Git branch name." },
          from_branch: { type: ["string", "null"], description: "Branch or commit to start from. Defaults to `HEAD`." },
        },
      },
    },
    responses: {
      "201": { description: "The new branch.", schema: ref("ProjectBranch") },
      "400": error("The name is invalid, the branch already exists, or `from_branch` could not be resolved."),
      "404": error("Project or repository not found."),
      "422": error("The name is missing or too long."),
    },
  },
  "DELETE /projects/{id}/branches/{name}": {
    summary: "Delete a branch",
    description:
      "Deletes a branch. Without `force`, a branch with commits not on the default branch is refused. Clears the project's preferred branch if it was this one.",
    query: [
      {
        name: "force",
        description: "Delete even if the branch has unmerged commits.",
        schema: { type: "boolean", default: false },
      },
    ],
    responses: {
      "204": { description: "The branch was deleted." },
      "400": error("The branch is the default branch or has unmerged commits."),
      "404": error("Project, repository or branch not found."),
      "409": error("The branch has an open pull request."),
    },
  },
  "PUT /projects/{id}/branch-preference": {
    summary: "Set preferred branch",
    description: "Sets the branch the editor opens by default.",
    query: [{ name: "branch", description: "Branch name.", schema: { type: "string" }, required: true }],
    responses: {
      "204": { description: "The preference was saved." },
      "404": error("Project or branch not found."),
      "422": error("`branch` is missing."),
    },
  },
};
