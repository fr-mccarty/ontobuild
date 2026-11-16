import { error, ref, type DocMap, type Schema } from "./types";

export const normalizationSchemas: Record<string, Schema> = {
  NormalizationReport: {
    type: "object",
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
      original_format: { type: "string", description: "Display name of the source format.", examples: ["Turtle", "RDF/XML"] },
      original_filename: { type: "string", examples: ["ontology.ttl"] },
      original_size_bytes: { type: "integer" },
      normalized_size_bytes: { type: "integer" },
      triple_count: { type: "integer" },
      prefixes_before: { type: "array", items: { type: "string" } },
      prefixes_after: { type: "array", items: { type: "string" } },
      prefixes_removed: { type: "array", items: { type: "string" } },
      prefixes_added: { type: "array", items: { type: "string" } },
      format_converted: { type: "boolean", description: "True when the source was not Turtle." },
      notes: {
        type: "array",
        items: { type: "string" },
        description:
          "Human-readable summary of the changes, such as removed prefixes, the number of literals whose language tags were stripped, and the size difference.",
        examples: [["Removed language tags from 12 literal(s)", "Triples reordered into canonical sequence"]],
      },
    },
  },
  NormalizationRun: {
    type: "object",
    required: [
      "id",
      "project_id",
      "created_at",
      "triggered_by",
      "trigger_type",
      "report",
      "is_dry_run",
      "commit_hash",
      "original_content",
      "normalized_content",
    ],
    properties: {
      id: { type: "string" },
      project_id: { type: "string" },
      created_at: { type: "string", format: "date-time" },
      triggered_by: { type: ["string", "null"], description: "User id that started the run." },
      trigger_type: { type: "string", description: "What started the run.", examples: ["manual", "import"] },
      report: {
        anyOf: [ref("NormalizationReport"), { type: "null" }],
        description: "Null only if the stored report could not be read.",
      },
      is_dry_run: { type: "boolean" },
      commit_hash: {
        type: ["string", "null"],
        description: "Commit created by the run; null for dry runs or when the source was already normalized.",
      },
      original_content: {
        type: ["string", "null"],
        description: "Source before normalization. Only set in the response to a synchronous dry run.",
      },
      normalized_content: {
        type: ["string", "null"],
        description: "Normalized Turtle. Only set in the response to a synchronous dry run.",
      },
    },
  },
  NormalizationJobStatus: {
    type: "object",
    required: ["job_id", "status", "result", "error"],
    properties: {
      job_id: { type: "string" },
      status: { type: "string", enum: ["pending", "running", "completed", "failed"] },
      result: {
        type: ["object", "null"],
        additionalProperties: true,
        description:
          "Job output once completed. A normalization job returns `{ project_id, run_id, dry_run, commit_hash, status: \"completed\" }`; " +
          "a status check returns `{ project_id, needs_normalization, last_run, error }`, where `needs_normalization` is null and `error` " +
          "is set when the project has no ontology file (as in `GET /projects/{id}/normalization/status`).",
      },
      error: { type: ["string", "null"] },
    },
  },
};

const dryRunBody = {
  required: false,
  schema: {
    type: "object",
    properties: {
      dry_run: { type: "boolean", default: false, description: "Compute the result without committing it." },
    },
  },
};

const branchQuery = {
  name: "branch",
  description: "Branch to work on. Defaults to the repository's default branch.",
  schema: { type: "string" },
};

export const normalizationDocs: DocMap = {
  "GET /projects/{id}/normalization/status": {
    summary: "Get normalization status",
    description:
      "Reports whether the source on the branch differs from its canonical Turtle form. The check is cached per commit. " +
      "When the status can't be determined (no ontology file on the branch, or the check failed), `needs_normalization` is null " +
      "and `error` says why, rather than returning an error status.",
    query: [branchQuery],
    responses: {
      "200": {
        description: "Normalization status.",
        schema: {
          type: "object",
          required: ["needs_normalization", "last_run", "last_run_id", "last_check", "preview_report", "error"],
          properties: {
            needs_normalization: { type: ["boolean", "null"], description: "Null when `error` is set." },
            last_run: { type: ["string", "null"], format: "date-time", description: "When the last non-dry run happened." },
            last_run_id: { type: ["string", "null"] },
            last_check: { type: ["string", "null"], format: "date-time" },
            preview_report: {
              anyOf: [ref("NormalizationReport"), { type: "null" }],
              description: "What normalizing would change; null when no changes are needed.",
            },
            error: {
              type: ["string", "null"],
              description: "Why the status is unknown, e.g. \"Project has no ontology file\".",
            },
          },
        },
      },
      "404": error("Project or branch not found."),
    },
  },
  "POST /projects/{id}/normalization/refresh": {
    summary: "Queue status check",
    description:
      "Starts a background job that recomputes the normalization status. Poll `GET /projects/{id}/normalization/jobs/{jobId}` with the returned `job_id`.",
    query: [branchQuery],
    responses: {
      "202": {
        description: "The job was queued.",
        schema: {
          type: "object",
          required: ["message", "job_id"],
          properties: { message: { type: "string" }, job_id: { type: "string" } },
        },
      },
      "404": error("Project or branch not found."),
    },
  },
  "POST /projects/{id}/normalization/queue": {
    summary: "Queue normalization",
    description:
      "Starts a background normalization job. Like the synchronous run, a branch without an ontology file is rejected up front with 400. " +
      "Poll `GET /projects/{id}/normalization/jobs/{jobId}`; the completed result holds the `run_id` of the recorded run.",
    body: dryRunBody,
    query: [branchQuery],
    responses: {
      "202": {
        description: "The job was queued.",
        schema: {
          type: "object",
          required: ["message", "job_id", "status"],
          properties: {
            message: { type: "string" },
            job_id: { type: "string" },
            status: { type: "string", const: "queued" },
          },
        },
      },
      "400": error("The branch has no ontology file."),
      "404": error("Project or branch not found."),
      "422": error("The body is not valid JSON."),
    },
  },
  "GET /projects/{id}/normalization/jobs/{jobId}": {
    summary: "Get normalization job",
    description: "Returns a normalization or status-check job.",
    responses: {
      "200": { description: "Job status.", schema: ref("NormalizationJobStatus") },
      "404": error("Project not found, or the job is unknown, expired or belongs to another project."),
    },
  },
  "GET /projects/{id}/normalization/jobs": {
    summary: "List normalization jobs",
    description: "Returns the 10 most recent normalization and status-check jobs, newest first.",
    responses: {
      "200": { description: "Recent jobs.", schema: { type: "array", items: ref("NormalizationJobStatus") } },
      "404": error("Project not found."),
    },
  },
  "POST /projects/{id}/normalization": {
    summary: "Run normalization",
    description:
      "Normalizes the source on the branch synchronously and records a run. A real run commits the result when it changed; " +
      "a dry run commits nothing and returns the original and normalized content.",
    body: dryRunBody,
    query: [branchQuery],
    responses: {
      "200": { description: "The recorded run.", schema: ref("NormalizationRun") },
      "400": error("The branch has no ontology file."),
      "404": error("Project or branch not found."),
      "422": error("The body is not valid JSON."),
      "500": error("Normalization failed, for example because the source could not be parsed."),
    },
  },
  "GET /projects/{id}/normalization/history": {
    summary: "List normalization runs",
    description: "Returns recent runs, newest first. `total` is the number of matching runs, which may exceed `limit`.",
    query: [
      { name: "limit", description: "Maximum number of runs.", schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } },
      { name: "include_dry_runs", description: "Include dry runs.", schema: { type: "boolean", default: false } },
    ],
    responses: {
      "200": {
        description: "Runs, without content.",
        schema: {
          type: "object",
          required: ["items", "total"],
          properties: { items: { type: "array", items: ref("NormalizationRun") }, total: { type: "integer" } },
        },
      },
      "404": error("Project not found."),
      "422": error("`limit` is not an integer in range."),
    },
  },
  "GET /projects/{id}/normalization/runs/{runId}": {
    summary: "Get normalization run",
    description: "Returns a recorded run. `original_content` and `normalized_content` are always null here.",
    responses: {
      "200": { description: "The run.", schema: ref("NormalizationRun") },
      "404": error("Project or run not found."),
    },
  },
};
