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
  GitImportSummary: {
    type: "object",
    description: "How a repository was imported: the remote, the branch and which file became the ontology.",
    required: ["remote_url", "web_url", "branch", "ontology_path", "source_path", "converted", "selection", "candidates", "warnings"],
    properties: {
      remote_url: { type: "string", description: "The clone's `origin` remote.", examples: ["https://github.com/acme/pizza.git"] },
      web_url: { type: ["string", "null"], examples: ["https://github.com/acme/pizza"] },
      branch: { type: ["string", "null"], description: "The branch checked out in the project folder." },
      ontology_path: {
        type: ["string", "null"],
        description: "Repository-relative path of the Turtle file the project edits (also `git_ontology_path`), or null when no ontology was found.",
        examples: ["src/ontology/pizza.ttl"],
      },
      source_path: {
        type: ["string", "null"],
        description: "The file the ontology came from. Differs from `ontology_path` when it was converted to Turtle.",
      },
      converted: {
        type: "boolean",
        description: "True when a non-Turtle file was converted and committed (locally, not pushed) as a new Turtle file; the original is unchanged.",
      },
      selection: {
        type: "string",
        enum: ["requested", "automatic", "none"],
        description: "`requested` when `ontology_path` was given, `automatic` when discovered, `none` when there is no ontology.",
      },
      candidates: {
        type: "array",
        description: "RDF files found in the repository, best first.",
        items: {
          type: "object",
          required: ["path", "format", "size_bytes", "declares_ontology"],
          properties: {
            path: { type: "string" },
            format: { type: "string", enum: ["turtle", "n3", "ntriples", "nquads", "trig", "rdfxml", "jsonld"] },
            size_bytes: { type: "integer" },
            declares_ontology: { type: "boolean", description: "The start of the file mentions `owl:Ontology`." },
          },
        },
      },
      warnings: { type: "array", items: { type: "string" }, description: "For example files that could not be parsed." },
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
  OntologyFileList: {
    type: "object",
    description: "The RDF files tracked by git on a branch of the project folder, and which one is the project's ontology.",
    required: ["project_id", "branch", "active_path", "active_exists", "files", "suggested_file_name"],
    properties: {
      project_id: { type: "string" },
      branch: { type: "string", description: "The branch that was listed." },
      active_path: {
        type: ["string", "null"],
        description: "Repository-relative path of the project's ontology file (the same for every branch), or null when the project has none.",
        examples: ["src/ontology/pizza.ttl"],
      },
      active_exists: {
        type: "boolean",
        description: "Whether the active file exists on this branch. When false the editor can't open the ontology on this branch.",
      },
      files: {
        type: "array",
        description: "RDF files, best ontology candidate first (same ranking as the Git import). Symbolic links, submodules and untracked files are not listed.",
        items: {
          type: "object",
          required: ["path", "format", "size_bytes", "declares_ontology", "active", "turtle_path", "turtle_exists"],
          properties: {
            path: { type: "string" },
            format: { type: "string", enum: ["turtle", "n3", "ntriples", "nquads", "trig", "rdfxml", "jsonld"] },
            size_bytes: { type: "integer" },
            declares_ontology: { type: "boolean", description: "The start of the file mentions `owl:Ontology`." },
            active: { type: "boolean", description: "This is the project's ontology file." },
            turtle_path: {
              type: ["string", "null"],
              description: "For a file that isn't Turtle: the Turtle file that choosing it makes the ontology. Null for Turtle files.",
            },
            turtle_exists: {
              type: "boolean",
              description:
                "For a file that isn't Turtle: `turtle_path` exists already (an earlier conversion, or a Turtle copy next to it). Choosing the file reuses it when it is up to date; " +
                "when it isn't, `PUT /projects/{id}/ontology-file` asks what to do (see `reconvert`).",
            },
          },
        },
      },
      suggested_file_name: {
        type: "string",
        description: "A free name for a new ontology file: `ontology.ttl`, else `ontology-2.ttl` and so on.",
        examples: ["ontology.ttl"],
      },
    },
  },
  OntologyLocalChanges: {
    type: "object",
    description:
      "Whether the ontology file in the project folder has changes that aren't committed, made outside OntoBuild (by an agent, a terminal or a text editor). " +
      "The editor shows the branch's last commit, so these stay out of view until they are committed.",
    required: ["branch", "path", "changed", "problem"],
    properties: {
      branch: { type: ["string", "null"], description: "The branch checked out in the project folder (the one a commit goes to); null when HEAD is detached." },
      path: { type: ["string", "null"], description: "The ontology file, relative to the project folder; null when the project has no ontology yet." },
      changed: { type: "boolean", description: "The file in the folder differs from the branch's last commit (modified, deleted or never committed)." },
      problem: {
        type: ["string", "null"],
        description: "Why the changed file can't be committed: it's missing or doesn't parse as Turtle. Null when it can, or nothing changed.",
      },
    },
  },
  OntologyLocalCommit: {
    type: "object",
    description: "The commit made from the ontology file in the project folder.",
    required: ["branch", "path", "commit_hash"],
    properties: {
      branch: { type: "string" },
      path: { type: "string" },
      commit_hash: { type: "string" },
    },
  },
  OntologyFileChange: {
    type: "object",
    description: "The result of switching or creating the project's ontology file.",
    required: ["project", "branch", "path", "source_path", "converted", "reused", "replaced", "previous_path", "commit_hash", "warnings"],
    properties: {
      project: ref("Project"),
      branch: { type: "string", description: "The branch the file was checked (and any commit made) on." },
      path: { type: "string", description: "The Turtle file the project now edits (also `project.git_ontology_path`)." },
      source_path: { type: "string", description: "The file that was chosen: `path`, or the non-Turtle file it came from." },
      converted: { type: "boolean", description: "The chosen file was converted to Turtle and committed as `path` (locally, not pushed)." },
      reused: { type: "boolean", description: "The chosen file isn't Turtle and `path` already existed, so it was used without converting again." },
      replaced: {
        type: "boolean",
        description: "The chosen file isn't Turtle, `path` already existed and was overwritten by converting the chosen file again (`reconvert: true`); `converted` is true too.",
      },
      previous_path: { type: ["string", "null"], description: "The ontology file before, or null when the project had none." },
      commit_hash: { type: ["string", "null"], description: "The commit made (a conversion or the new file), or null when nothing was committed." },
      warnings: { type: "array", items: { type: "string" } },
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
  "POST /projects/clone": {
    summary: "Import a project from a Git repository",
    description:
      "Clones a repository, with its full history, into a new project folder. The clone's `origin` remote becomes the project's linked remote, " +
      "so fetch, pull and push work straight away. Authentication uses the machine's git setup (`gh auth login`, a credential helper or SSH keys); " +
      "prompts are disabled and nothing is stored. Only `https://`, `ssh://` and `git@host:owner/repo` URLs are accepted, without embedded credentials.\n\n" +
      "The ontology is the `ontology_path` given, or else the best RDF file found: `ontology.ttl` at the top first, then files declaring `owl:Ontology`, " +
      "outside test/example folders, Turtle before other formats, shallowest first. A Turtle file is edited where it is; another format is converted " +
      "to Turtle, normalized like an uploaded file, and committed as `ontology.ttl` (or `<name>.ttl` beside the original when that exists). " +
      "With no readable RDF file the project is created without an ontology. The name defaults to the repository name and the description to the ontology's description.",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", examples: ["https://github.com/acme/pizza.git", "git@github.com:acme/pizza.git"] },
          branch: { type: ["string", "null"], description: "Branch to check out. Defaults to the repository's default branch." },
          name: { type: ["string", "null"], maxLength: 255, description: "Overrides the project name." },
          description: { type: ["string", "null"], maxLength: 5000, description: "Overrides the project description." },
          ontology_path: {
            type: ["string", "null"],
            description: "Repository-relative path of the ontology file to use, instead of discovering one.",
            examples: ["src/ontology/pizza.owl"],
          },
          is_public: { type: "boolean", description: "Defaults to false. The UI does not use it." },
        },
      },
    },
    responses: {
      "201": {
        description: "The new project, with how the repository was imported.",
        schema: {
          allOf: [
            ref("Project"),
            {
              type: "object",
              required: ["file_path", "git_import"],
              properties: {
                file_path: { type: ["string", "null"], description: "Same as `source_file_path`." },
                git_import: ref("GitImportSummary"),
              },
            },
          ],
        },
      },
      "400": error("The URL is not an accepted git URL, or git failed for another reason."),
      "403": error("Git could not sign in to the host."),
      "404": error("The repository, or the requested branch, does not exist (or is private and git could not sign in)."),
      "409": error("A converted ontology could not be saved because both target file names already exist."),
      "422": error("A field is missing or invalid, or the requested `ontology_path` is not an RDF file in the repository or could not be parsed."),
      "502": error("The host could not be reached."),
      "504": error("The clone took longer than the time limit (5 minutes) and was stopped."),
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
  "GET /projects/{id}/ontology-files": {
    summary: "List ontology files",
    description:
      "Lists the RDF files tracked by git on a branch of the project folder, best ontology candidate first, and which one is the project's ontology. " +
      "The project edits one ontology file at a time; the path is one setting for the whole project, so it may be missing on some branches (`active_exists`).",
    query: [branchQuery],
    responses: {
      "200": { description: "The files and the active one.", schema: ref("OntologyFileList") },
      "404": error("Project or branch not found."),
    },
  },
  "PUT /projects/{id}/ontology-file": {
    summary: "Switch the ontology file",
    description:
      "Makes another RDF file in the project folder the project's ontology, replacing the current one (which is left as it is, so you can switch back). " +
      "The file must be tracked by git on the branch, be a regular file (not a symbolic link) and parse. A Turtle file is edited in place. " +
      "Another format is converted to Turtle and committed on the branch as `<name>.ttl` next to it. When that file, or the file an earlier conversion made, " +
      "already exists it is reused if it is up to date: it has the same triples as the chosen file (blank nodes compared by structure, language tags ignored), " +
      "or, for an earlier OntoBuild conversion, the chosen file's triples haven't changed since that conversion. When it is out of date, `reconvert` decides; " +
      "without it the request fails with 409 and `code: \"turtle_out_of_date\"`. The original is never changed. Derived state of the old file is dropped: the search index, lint runs, " +
      "consistency and duplicate results, the normalization check and the import normalization report. Label preferences are kept. " +
      "Normalization history is kept per file, so the normalization status and history then describe the new file.",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "Repository-relative path of the file.", examples: ["src/ontology/pizza.owl"] },
          branch: { type: ["string", "null"], description: "Branch to check the file on (and commit a conversion to). Defaults to the default branch." },
          reconvert: {
            type: ["boolean", "null"],
            description:
              "Only for a file that isn't Turtle whose Turtle file exists already. `true`: convert the file again and overwrite the Turtle file in a new commit. " +
              "`false`: use the Turtle file as it is, even when it is out of date (a warning says so). Absent: reuse it when it is up to date, else fail with 409 `turtle_out_of_date`.",
          },
        },
      },
    },
    responses: {
      "200": { description: "The project now edits `path`.", schema: ref("OntologyFileChange") },
      "404": error("Project, repository or branch not found."),
      "409": {
        description:
          "The Turtle file next to the chosen file is out of date and `reconvert` wasn't given (`code: \"turtle_out_of_date\"`; send it again with `reconvert`), " +
          "or a converted file can't be written because an uncommitted file of that name is in the project folder (no `code`).",
        schema: {
          type: "object",
          required: ["detail"],
          properties: {
            detail: { type: "string", description: "Human-readable message." },
            code: { type: "string", enum: ["turtle_out_of_date"], description: "Set when the Turtle file is out of date." },
            source_path: { type: "string", description: "The chosen file." },
            turtle_path: { type: "string", description: "The existing Turtle file that is out of date." },
            reason: { type: "string", description: "Why it is out of date." },
            branch: { type: "string" },
          },
        },
      },
      "422": error(
        "The path is missing, outside the repository, a symbolic link, not committed on the branch, not an RDF file, or the file could not be parsed.",
      ),
    },
  },
  "POST /projects/{id}/ontology-file": {
    summary: "Create an ontology file",
    description:
      "Creates a new, empty ontology (an `owl:Ontology` declaration with a `dc:title`), commits it on the branch and makes it the project's ontology, " +
      "replacing the current one, which is left as it is so you can switch back.",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["file_name", "ontology_iri", "title"],
        properties: {
          file_name: {
            type: "string",
            description: "Repository-relative path of the new file. Must end in `.ttl` and not exist yet.",
            examples: ["ontology.ttl", "src/ontology/new.ttl"],
          },
          ontology_iri: { type: "string", description: "The ontology's IRI (absolute, no spaces).", examples: ["http://example.org/ontologies/pizza"] },
          title: { type: "string", minLength: 1, maxLength: 255, description: "The ontology's title (`dc:title`)." },
          branch: { type: ["string", "null"], description: "Branch to commit the file on. Defaults to the default branch." },
        },
      },
    },
    responses: {
      "201": { description: "The file was created and the project now edits it.", schema: ref("OntologyFileChange") },
      "404": error("Project or branch not found."),
      "409": error("A file or folder of that name already exists."),
      "422": error("A field is missing or invalid: the file name is outside the repository or doesn't end in .ttl, or the IRI is not an absolute IRI."),
    },
  },
  "GET /projects/{id}/ontology-file/local-changes": {
    summary: "Check for uncommitted ontology changes",
    description:
      "Says whether the ontology file in the project folder has changes that aren't committed on the checked-out branch, and whether they could be committed.",
    responses: {
      "200": { description: "The state of the ontology file in the folder.", schema: ref("OntologyLocalChanges") },
      "404": error("Project not found."),
    },
  },
  "POST /projects/{id}/ontology-file/local-changes/commit": {
    summary: "Commit uncommitted ontology changes",
    description:
      "Commits the ontology file as it is in the project folder to the checked-out branch (locally, not pushed). Language tags are stripped as for every commit; " +
      "the folder is left matching the commit.",
    body: {
      required: false,
      schema: {
        type: "object",
        properties: {
          commit_message: {
            type: ["string", "null"],
            maxLength: 500,
            description: "The commit message. Defaults to \"Commit changes to <file> made outside OntoBuild\".",
          },
        },
      },
    },
    responses: {
      "200": { description: "The changes were committed.", schema: ref("OntologyLocalCommit") },
      "404": error("Project not found, or it has no ontology file yet."),
      "409": error("Nothing to commit, or no branch is checked out in the folder."),
      "422": error("The file is missing or doesn't parse as Turtle, or commit_message isn't a string."),
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
