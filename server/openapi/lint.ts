import { error, ref, type DocMap, type Schema } from "./types";

const severity: Schema = { type: "string", enum: ["error", "warning", "info"] };
const ruleIds: Schema = { type: "array", items: { type: "string" } };

const page = (item: string): Schema => ({
  type: "object",
  required: ["items", "total", "skip", "limit"],
  properties: {
    items: { type: "array", items: ref(item) },
    total: { type: "integer", description: "Total number of matching items." },
    skip: { type: "integer" },
    limit: { type: "integer" },
  },
});

const paging = (defLimit: number, maxLimit: number) => [
  { name: "skip", description: "Number of items to skip.", schema: { type: "integer", minimum: 0, default: 0 } },
  {
    name: "limit",
    description: "Maximum number of items to return.",
    schema: { type: "integer", minimum: 1, maximum: maxLimit, default: defLimit },
  },
];

export const lintSchemas: Record<string, Schema> = {
  LintRun: {
    type: "object",
    required: ["id", "project_id", "branch", "status", "started_at", "completed_at", "issues_found", "error_message"],
    properties: {
      id: { type: "string" },
      project_id: { type: "string" },
      branch: { type: ["string", "null"], description: "Branch that was linted." },
      status: { type: "string", enum: ["pending", "running", "completed", "failed"] },
      started_at: { type: "string", format: "date-time" },
      completed_at: { type: ["string", "null"], format: "date-time" },
      issues_found: { type: ["integer", "null"], description: "Set once the run completes." },
      error_message: { type: ["string", "null"], description: "Why the run failed." },
    },
  },
  LintIssue: {
    type: "object",
    required: [
      "id",
      "run_id",
      "project_id",
      "issue_type",
      "rule_id",
      "message",
      "subject_iri",
      "subject_type",
      "details",
      "created_at",
      "resolved_at",
    ],
    properties: {
      id: { type: "string" },
      run_id: { type: "string" },
      project_id: { type: "string" },
      issue_type: { ...severity, description: "Severity of the issue." },
      rule_id: { type: "string", examples: ["missing-label"] },
      message: { type: "string" },
      subject_iri: { type: ["string", "null"], description: "IRI of the resource the issue is about." },
      subject_type: { type: ["string", "null"], enum: ["class", "property", "individual", "other", null] },
      details: {
        type: ["object", "null"],
        additionalProperties: true,
        description: "Rule-specific extra data, for example `duplicate_iris` for duplicate labels.",
      },
      created_at: { type: "string", format: "date-time" },
      resolved_at: { type: ["string", "null"], format: "date-time", description: "Set when the issue is dismissed." },
    },
  },
  LintRule: {
    type: "object",
    required: ["rule_id", "name", "description", "severity", "scope"],
    properties: {
      rule_id: { type: "string", examples: ["undefined-parent"] },
      name: { type: "string", examples: ["Undefined Parent"] },
      description: { type: "string" },
      severity,
      scope: {
        type: "array",
        items: { type: "string", enum: ["class", "property", "individual"] },
        description: "Kinds of resource the rule checks.",
      },
    },
  },
  LintLevel: {
    type: "object",
    required: ["level", "name", "description", "rule_ids"],
    properties: {
      level: { type: "integer", minimum: 1, maximum: 5 },
      name: { type: "string", examples: ["Critical"] },
      description: { type: "string" },
      rule_ids: { ...ruleIds, description: "Rules enabled at this level, sorted." },
    },
  },
  LintConfig: {
    type: "object",
    required: ["project_id", "lint_level", "enabled_rules", "effective_rules", "updated_at"],
    description:
      "A project uses either a preset level or a custom rule list. With neither set (never configured), every rule is enabled.",
    properties: {
      project_id: { type: "string" },
      lint_level: { type: ["integer", "null"], minimum: 1, maximum: 5, description: "Preset level, or null in custom mode." },
      enabled_rules: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "Custom rule list, or null in preset mode.",
      },
      effective_rules: { ...ruleIds, description: "Rules that the next run will apply, sorted." },
      updated_at: { type: ["string", "null"], format: "date-time", description: "Null when never configured." },
    },
  },
};

export const lintDocs: DocMap = {
  "GET /projects/lint/levels": {
    summary: "List lint levels",
    description: "Lists the preset levels 1 to 5. Each level includes all the rules of the levels below it.",
    responses: {
      "200": {
        description: "Lint levels, ordered by level.",
        schema: { type: "object", required: ["levels"], properties: { levels: { type: "array", items: ref("LintLevel") } } },
      },
    },
  },
  "GET /projects/lint/rules": {
    summary: "List lint rules",
    responses: {
      "200": {
        description: "All available lint rules.",
        schema: { type: "object", required: ["rules"], properties: { rules: { type: "array", items: ref("LintRule") } } },
      },
    },
  },
  "POST /projects/{id}/lint/run": {
    summary: "Start a lint run",
    description:
      "Queues a lint run using the project's lint config. " +
      "Poll `GET /projects/{id}/lint/runs/{run_id}` until `status` is `completed` or `failed`.",
    query: [{ name: "branch", description: "Branch to lint. Defaults to the repository's default branch.", schema: { type: "string" } }],
    responses: {
      "202": {
        description: "The run was queued.",
        schema: {
          type: "object",
          required: ["job_id", "run_id", "branch", "status", "message"],
          properties: {
            job_id: { type: "string", description: "Background job id." },
            run_id: { type: "string", description: "Id of the lint run; poll it at `GET /projects/{id}/lint/runs/{runId}`." },
            branch: { type: "string" },
            status: { type: "string", const: "queued" },
            message: { type: "string" },
          },
        },
      },
      "400": error("The project has no repository to lint."),
      "404": error("Project or branch not found."),
      "409": error("A lint run is already pending or running for this project."),
    },
  },
  "GET /projects/{id}/lint/status": {
    summary: "Get lint status",
    description:
      "Returns the most recent run (`last_run`, which may still be pending or running) and the counts of unresolved issues " +
      "by severity from the most recent *completed* run (`counts_run_id`), the same run `GET /projects/{id}/lint/issues` lists. " +
      "Counts are zero when no run has completed.",
    responses: {
      "200": {
        description: "Lint summary.",
        schema: {
          type: "object",
          required: ["project_id", "last_run", "counts_run_id", "error_count", "warning_count", "info_count", "total_issues"],
          properties: {
            project_id: { type: "string" },
            last_run: { anyOf: [ref("LintRun"), { type: "null" }] },
            counts_run_id: {
              type: ["string", "null"],
              description: "Id of the completed run the counts come from, or null when no run has completed.",
            },
            error_count: { type: "integer" },
            warning_count: { type: "integer" },
            info_count: { type: "integer" },
            total_issues: { type: "integer" },
          },
        },
      },
      "404": error("Project not found."),
    },
  },
  "GET /projects/{id}/lint/runs": {
    summary: "List lint runs",
    description: "Lists runs newest first.",
    query: paging(20, 100),
    responses: {
      "200": { description: "A page of lint runs.", schema: page("LintRun") },
      "404": error("Project not found."),
      "422": error("A paging parameter is invalid."),
    },
  },
  "GET /projects/{id}/lint/runs/{runId}": {
    summary: "Get lint run",
    description:
      "Returns a run with its issues ordered by severity, rule and subject. Like `GET /projects/{id}/lint/issues`, " +
      "dismissed issues are left out unless `include_resolved=true`.",
    pathParams: { runId: "Lint run id." },
    query: [{ name: "include_resolved", description: "Include dismissed issues.", schema: { type: "boolean", default: false } }],
    responses: {
      "200": {
        description: "The run and its issues.",
        schema: {
          allOf: [
            ref("LintRun"),
            {
              type: "object",
              required: ["issues"],
              properties: { issues: { type: "array", items: ref("LintIssue") } },
            },
          ],
        },
      },
      "404": error("Project or lint run not found."),
    },
  },
  "GET /projects/{id}/lint/issues": {
    summary: "List lint issues",
    description:
      "Lists issues from the most recent completed run, ordered by severity, rule and subject. " +
      "Returns an empty page when no run has completed.",
    query: [
      { name: "issue_type", description: "Only issues of this severity.", schema: severity },
      { name: "rule_id", description: "Only issues raised by this rule.", schema: { type: "string" } },
      { name: "subject_iri", description: "Only issues about this resource.", schema: { type: "string" } },
      {
        name: "include_resolved",
        description: "Include dismissed issues.",
        schema: { type: "boolean", default: false },
      },
      ...paging(100, 500),
    ],
    responses: {
      "200": { description: "A page of lint issues.", schema: page("LintIssue") },
      "404": error("Project not found."),
      "422": error("A paging parameter is invalid, or `issue_type` is not error, warning or info."),
    },
  },
  "DELETE /projects/{id}/lint/issues/{issueId}": {
    summary: "Dismiss lint issue",
    description: "Marks the issue as resolved. The issue is kept and can still be listed with `include_resolved=true`.",
    pathParams: { issueId: "Lint issue id." },
    responses: {
      "204": { description: "The issue was dismissed." },
      "400": error("The issue is already resolved."),
      "404": error("Project or lint issue not found."),
    },
  },
  "DELETE /projects/{id}/lint/results": {
    summary: "Clear lint results",
    description: "Deletes all completed and failed runs and their issues. A run in progress is kept.",
    responses: {
      "204": { description: "The results were cleared." },
      "404": error("Project not found."),
    },
  },
  "GET /projects/{id}/lint/config": {
    summary: "Get lint config",
    responses: {
      "200": { description: "The project's lint config.", schema: ref("LintConfig") },
      "404": error("Project not found."),
    },
  },
  "PUT /projects/{id}/lint/config": {
    summary: "Replace lint config",
    description:
      "Sets either a preset `lint_level` or a custom `enabled_rules` list, not both. " +
      "Omit both (or send null) to enable every rule. Rule ids from removed rules are accepted and dropped.",
    body: {
      required: true,
      schema: {
        type: "object",
        properties: {
          lint_level: { type: ["integer", "null"], minimum: 1, maximum: 5 },
          enabled_rules: { type: ["array", "null"], items: { type: "string" }, description: "Rule ids to enable." },
        },
      },
    },
    responses: {
      "200": { description: "The saved lint config.", schema: ref("LintConfig") },
      "404": error("Project not found."),
      "422": error("The level is out of range, a rule id is unknown, or both fields were given."),
    },
  },
};
