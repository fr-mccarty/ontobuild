import { error, ref, type DocMap, type Schema } from "./types";

const branchQuery = {
  name: "branch",
  description: "Branch to check. Defaults to the project's default branch.",
  schema: { type: "string" },
};

const entityType: Schema = {
  type: "string",
  enum: ["class", "property", "individual", "unknown", "ontology"],
  description: "`ontology` marks ontology-wide issues (multi_root), whose `entity_iri` is empty.",
};

const jobStarted = (what: string) => ({
  "202": {
    description: `The ${what} job was queued.`,
    schema: { type: "object", required: ["job_id"], properties: { job_id: { type: "string" } } },
  },
  "404": error("Project, repository or branch not found."),
});

const jobResult = (result: string, what: string) => ({
  pathParams: { jobId: `Job id returned when the ${what} was started.` },
  responses: {
    "200": { description: "The job finished; the body is its result.", schema: ref(result) },
    "202": { description: "The job is still pending or running. Poll again.", schema: ref("QualityJobPending") },
    "404": error("Project not found, or no such job of this kind for the project."),
    "500": error("The job failed, for example because the Turtle source could not be loaded or parsed."),
  },
});

export const qualitySchemas: Record<string, Schema> = {
  QualityConsistencyIssue: {
    type: "object",
    required: ["rule_id", "severity", "entity_iri", "entity_type", "message", "details"],
    properties: {
      rule_id: {
        type: "string",
        enum: [
          "orphan_class",
          "cycle_detect",
          "unused_property",
          "missing_label",
          "missing_comment",
          "orphan_individual",
          "empty_domain",
          "empty_range",
          "duplicate_label",
          "deprecated_parent",
          "dangling_ref",
          "multi_root",
        ],
      },
      severity: { type: "string", enum: ["error", "warning", "info"] },
      entity_iri: { type: "string" },
      entity_type: entityType,
      message: { type: "string" },
      details: { type: ["object", "null"], additionalProperties: true, description: "Rule-specific extra data." },
    },
  },
  QualityConsistencyResult: {
    type: "object",
    required: ["project_id", "branch", "issues", "checked_at", "duration_ms"],
    properties: {
      project_id: { type: "string" },
      branch: { type: "string" },
      issues: { type: "array", items: ref("QualityConsistencyIssue") },
      checked_at: { type: "string", format: "date-time" },
      duration_ms: { type: "number" },
    },
  },
  QualityLatestConsistencyResult: {
    type: "object",
    required: ["project_id", "branch", "issues", "checked_at", "duration_ms"],
    properties: {
      project_id: { type: "string" },
      branch: { type: "string" },
      issues: { type: "array", items: ref("QualityConsistencyIssue") },
      checked_at: { type: ["string", "null"], format: "date-time", description: "Null when no check has run on the branch." },
      duration_ms: { type: ["number", "null"], description: "Null when no check has run on the branch." },
    },
  },
  QualityDuplicateCluster: {
    type: "object",
    required: ["entities", "similarity"],
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          required: ["iri", "label", "entity_type"],
          properties: {
            iri: { type: "string" },
            label: { type: "string", description: "First rdfs:label of the entity." },
            entity_type: {
              type: "string",
              enum: ["class", "property", "individual"],
              description: "Same vocabulary as consistency issues. Labels are only compared within one type.",
            },
          },
        },
      },
      similarity: { type: "number", minimum: 0, maximum: 1, description: "Average label trigram similarity, rounded to 3 places." },
    },
  },
  QualityDuplicateResult: {
    type: "object",
    required: ["clusters", "threshold", "checked_at"],
    properties: {
      clusters: { type: "array", items: ref("QualityDuplicateCluster"), description: "Most similar first." },
      threshold: { type: "number" },
      checked_at: { type: "string", format: "date-time" },
    },
  },
  QualityLatestDuplicateResult: {
    type: "object",
    required: ["clusters", "threshold", "checked_at"],
    properties: {
      clusters: { type: "array", items: ref("QualityDuplicateCluster"), description: "Most similar first." },
      threshold: { type: ["number", "null"], description: "Null when no detection has run on the branch." },
      checked_at: { type: ["string", "null"], format: "date-time", description: "Null when no detection has run on the branch." },
    },
  },
  QualityJobPending: {
    type: "object",
    required: ["job_id", "status"],
    properties: { job_id: { type: "string" }, status: { type: "string", const: "pending" } },
  },
};

export const qualityDocs: DocMap = {
  "POST /projects/{id}/quality/check": {
    summary: "Start a consistency check",
    description:
      "Queues a background consistency check of the branch and returns 202. The repository and branch are validated first. Poll `GET /projects/{id}/quality/jobs/{jobId}` for the result, " +
      "which is also saved as the branch's latest result.",
    query: [branchQuery],
    responses: jobStarted("consistency check"),
  },
  "GET /projects/{id}/quality/jobs/{jobId}": {
    summary: "Get consistency check result",
    ...jobResult("QualityConsistencyResult", "consistency check"),
  },
  "GET /projects/{id}/quality/issues": {
    summary: "Get latest consistency issues",
    description:
      "Returns the last saved consistency check for the branch. If none has run, `issues` is empty and " +
      "`checked_at` and `duration_ms` are null, so \"never checked\" is distinguishable from \"no issues\".",
    query: [branchQuery],
    responses: {
      "200": { description: "The latest consistency check result.", schema: ref("QualityLatestConsistencyResult") },
      "404": error("Project or branch not found."),
    },
  },
  "POST /projects/{id}/quality/duplicates": {
    summary: "Start duplicate detection",
    description:
      "Queues a background search for entities with similar labels and returns 202. The repository and branch are validated first. " +
      "Poll `GET /projects/{id}/quality/duplicates/jobs/{jobId}` for the result, which is also saved as the branch's latest result.",
    query: [
      branchQuery,
      {
        name: "threshold",
        description: "Minimum label similarity for two entities to be clustered.",
        schema: { type: "number", minimum: 0.5, maximum: 1, default: 0.85 },
      },
    ],
    responses: { ...jobStarted("duplicate detection"), "422": error("The threshold is not a number between 0.5 and 1.") },
  },
  "GET /projects/{id}/quality/duplicates/jobs/{jobId}": {
    summary: "Get duplicate detection result",
    ...jobResult("QualityDuplicateResult", "duplicate detection"),
  },
  "GET /projects/{id}/quality/duplicates/latest": {
    summary: "Get latest duplicates",
    description:
      "Returns the last saved duplicate detection for the branch. If none has run, `clusters` is empty and " +
      "`threshold` and `checked_at` are null.",
    query: [branchQuery],
    responses: {
      "200": { description: "The latest duplicate detection result.", schema: ref("QualityLatestDuplicateResult") },
      "404": error("Project or branch not found."),
    },
  },
};
