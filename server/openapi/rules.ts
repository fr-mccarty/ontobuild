import { error, ref, type DocMap, type Schema } from "./types";

const branchQuery = {
  name: "branch",
  description: "Branch to read or change. Defaults to the project's default branch.",
  schema: { type: "string" },
};

const iriPath = { iri: "Full rule IRI, URL-encoded." };

const nullableIri: Schema = { type: ["string", "null"], format: "iri" };
const nullableCount: Schema = { type: ["integer", "null"], minimum: 0 };
const severity: Schema = {
  type: "string",
  enum: ["error", "warning", "info"],
  description: "`rule:Error`, `rule:Warning` or `rule:Info` in the ontology. A rule without `rule:severity` is an error.",
};

const ruleFields: Record<string, Schema> = {
  applies_to_iri: { type: "string", format: "iri", description: "`rule:appliesTo`: the class whose instances, and its subclasses' instances, the rule checks." },
  property_iri: { ...nullableIri, description: "`rule:property`: the property whose values are checked. Only a closed rule may leave it out." },
  min_count: { ...nullableCount, description: "`rule:minCount`." },
  max_count: { ...nullableCount, description: "`rule:maxCount`." },
  value_class_iri: { ...nullableIri, description: "`rule:valueClass`: each value must be an instance of this class." },
  value_datatype_iri: { ...nullableIri, description: "`rule:valueDatatype`: each value must be a literal of this datatype." },
  allowed_values: {
    type: ["array", "null"],
    items: ref("RuleValue"),
    description: "`rule:allowedValues`: the only values the property may have, in order.",
  },
  pattern: { type: ["string", "null"], description: "`rule:pattern`: a regular expression each value must match." },
  min_length: { ...nullableCount, description: "`rule:minLength`." },
  max_length: { ...nullableCount, description: "`rule:maxLength`." },
  closed: {
    type: "boolean",
    description:
      "`rule:closed true`: instances may use only the properties that have a rule for the class, besides `rdf:type` and annotation properties.",
  },
  severity,
  label: { type: ["string", "null"], description: "`rdfs:label` of the rule." },
  message: { type: ["string", "null"], description: "`rdfs:comment` of the rule: the message shown for its violations." },
};

const ruleFieldNames = Object.keys(ruleFields);

const writeResult: Schema = {
  type: "object",
  required: ["rule", "commit_hash", "branch"],
  properties: { rule: ref("Rule"), commit_hash: { type: "string" }, branch: { type: "string" } },
};

export const rulesSchemas: Record<string, Schema> = {
  RuleValue: {
    type: "object",
    required: ["value", "type"],
    properties: {
      value: { type: "string" },
      type: { type: "string", enum: ["iri", "literal"] },
      datatype: { type: ["string", "null"], format: "iri", description: "A literal's datatype; absent for a plain string." },
    },
  },
  Rule: {
    type: "object",
    required: ["iri", ...ruleFieldNames, "read_only", "imported_from"],
    properties: {
      iri: { type: "string", format: "iri" },
      ...ruleFields,
      read_only: { type: "boolean", description: "True for a rule from an imported ontology: it can only be changed there." },
      imported_from: { ...nullableIri, description: "IRI of the imported ontology a read-only rule comes from." },
    },
  },
  RuleInput: {
    type: "object",
    required: ["applies_to_iri"],
    description:
      "The whole rule: fields left out are removed from it. A rule needs `property_iri` and at least one constraint, or `closed: true`.",
    properties: {
      iri: { type: "string", format: "iri", description: "On create only: the new rule's IRI. Generated from the ontology's namespace when left out." },
      ...ruleFields,
      closed: { ...ruleFields.closed, default: false },
      severity: { ...severity, default: "error" },
      commit_message: { type: "string", maxLength: 500, description: "Git commit message. A default names the rule." },
    },
  },
  RuleViolation: {
    type: "object",
    required: ["rule_iri", "applies_to_iri", "focus_node", "property_iri", "value", "constraint", "severity", "message"],
    properties: {
      rule_iri: { type: "string", format: "iri" },
      applies_to_iri: { type: "string", format: "iri", description: "The class the rule applies to." },
      focus_node: { type: "string", description: "The instance that breaks the rule." },
      property_iri: { ...nullableIri, description: "The property involved; for a closed rule, the property that is not allowed." },
      value: { type: ["string", "null"], description: "The offending value (an IRI or a literal's text), or null when a value is missing." },
      constraint: {
        type: "string",
        enum: ["min_count", "max_count", "value_class", "value_datatype", "allowed_values", "pattern", "min_length", "max_length", "closed"],
      },
      severity,
      message: { type: "string", description: "The rule's `rdfs:comment`, or a generated message." },
    },
  },
  RuleCounts: {
    type: "object",
    required: ["error", "warning", "info", "total"],
    properties: {
      error: { type: "integer" },
      warning: { type: "integer" },
      info: { type: "integer" },
      total: { type: "integer" },
    },
  },
  RuleValidationResult: {
    type: "object",
    required: ["project_id", "branch", "commit_hash", "checked_at", "duration_ms", "rule_count", "counts", "violations"],
    properties: {
      project_id: { type: "string" },
      branch: { type: "string" },
      commit_hash: { type: "string", description: "The commit that was validated." },
      checked_at: { type: "string", format: "date-time" },
      duration_ms: { type: "number" },
      rule_count: { type: "integer", description: "Rules applied: the file's own and its imports'." },
      counts: ref("RuleCounts"),
      violations: { type: "array", items: ref("RuleViolation"), description: "Errors first, then warnings, then info." },
    },
  },
  RuleLatestValidation: {
    type: "object",
    required: ["project_id", "branch", "commit_hash", "checked_at", "duration_ms", "rule_count", "counts", "violations", "stale"],
    properties: {
      project_id: { type: "string" },
      branch: { type: "string" },
      commit_hash: { type: ["string", "null"], description: "Null when the branch has never been validated." },
      checked_at: { type: ["string", "null"], format: "date-time", description: "Null when the branch has never been validated." },
      duration_ms: { type: ["number", "null"] },
      rule_count: { type: ["integer", "null"] },
      counts: { ...ref("RuleCounts"), description: "Counts of the violations returned (after the class and entity filters)." },
      violations: { type: "array", items: ref("RuleViolation") },
      stale: { type: "boolean", description: "True when the branch has moved past the validated commit." },
    },
  },
};

export const rulesDocs: DocMap = {
  "GET /projects/{id}/rules": {
    summary: "List rules",
    description:
      "The rules (`rule:Rule` terms) in the ontology file and its imports. Rules from imports are marked `read_only`. " +
      "With `class`, only the rules that apply to that class or one of its superclasses.",
    query: [branchQuery, { name: "class", description: "Class IRI.", schema: { type: "string" } }],
    responses: {
      "200": {
        description: "The rules.",
        schema: { type: "object", required: ["rules"], properties: { rules: { type: "array", items: ref("Rule") } } },
      },
      "404": error("Project, repository or branch not found."),
    },
  },
  "POST /projects/{id}/rules": {
    summary: "Create a rule",
    description:
      "Adds a rule to the ontology file as one commit. The first rule also adds `owl:imports <https://ontobuild.dev/rules>` and the `rule:` prefix.",
    query: [branchQuery],
    body: { required: true, schema: ref("RuleInput") },
    responses: {
      "201": { description: "The rule was committed.", schema: writeResult },
      "404": error("Project, repository or branch not found."),
      "409": error("The IRI is already in use, or the ontology file has uncommitted changes in the project folder."),
      "422": error("The rule is invalid, or `applies_to_iri` is not a class."),
    },
  },
  "POST /projects/{id}/rules/validate": {
    summary: "Start rule validation",
    description:
      "Queues a background validation of the branch against its rules, as SHACL, and returns 202. Poll `GET /projects/{id}/rules/jobs/{jobId}`. " +
      "The result is also saved as the branch's latest. Validation also runs after every commit to a branch whose file has rules or imports.",
    query: [branchQuery],
    responses: {
      "202": {
        description: "The validation job was queued.",
        schema: { type: "object", required: ["job_id"], properties: { job_id: { type: "string" } } },
      },
      "404": error("Project, repository or branch not found."),
    },
  },
  "GET /projects/{id}/rules/jobs/{jobId}": {
    summary: "Get rule validation result",
    pathParams: { jobId: "Job id returned when the validation was started." },
    responses: {
      "200": { description: "The job finished; the body is its result.", schema: ref("RuleValidationResult") },
      "202": { description: "The job is still pending or running. Poll again.", schema: ref("QualityJobPending") },
      "404": error("Project not found, or no such validation job for the project."),
      "500": error("The job failed, for example because the Turtle source could not be loaded."),
    },
  },
  "GET /projects/{id}/rules/violations": {
    summary: "Get latest rule violations",
    description:
      "The branch's last saved validation. If none has run, `violations` is empty and `checked_at` is null. " +
      "`class` keeps the violations of rules that apply to that class; `entity` keeps those whose focus node is that entity.",
    query: [
      branchQuery,
      { name: "class", description: "Class IRI.", schema: { type: "string" } },
      { name: "entity", description: "Entity IRI.", schema: { type: "string" } },
    ],
    responses: {
      "200": { description: "The latest validation.", schema: ref("RuleLatestValidation") },
      "404": error("Project, repository or branch not found."),
    },
  },
  "GET /projects/{id}/rules/shacl": {
    summary: "Export rules as SHACL",
    description: "The SHACL shapes the rules of the file and its imports become, as Turtle. Nothing is stored: they are derived on each request.",
    query: [branchQuery],
    responses: {
      "200": { description: "SHACL shapes graph.", contentType: "text/turtle", schema: { type: "string" } },
      "404": error("Project, repository or branch not found."),
    },
  },
  "GET /projects/{id}/rules/{iri}": {
    summary: "Get a rule",
    pathParams: iriPath,
    query: [branchQuery],
    responses: {
      "200": { description: "The rule.", schema: ref("Rule") },
      "404": error("Project, branch or rule not found."),
    },
  },
  "PUT /projects/{id}/rules/{iri}": {
    summary: "Replace a rule",
    description: "Replaces the whole rule in the ontology file as one commit. `iri` in the body is ignored.",
    pathParams: iriPath,
    query: [branchQuery],
    body: { required: true, schema: ref("RuleInput") },
    responses: {
      "200": { description: "The rule was committed.", schema: writeResult },
      "403": error("The rule comes from an imported ontology."),
      "404": error("Project, branch or rule not found."),
      "409": error("The ontology file has uncommitted changes in the project folder."),
      "422": error("The rule is invalid, or `applies_to_iri` is not a class."),
    },
  },
  "DELETE /projects/{id}/rules/{iri}": {
    summary: "Delete a rule",
    pathParams: iriPath,
    query: [branchQuery, { name: "commit_message", description: "Git commit message.", schema: { type: "string", maxLength: 500 } }],
    responses: {
      "204": { description: "The rule was removed in a commit." },
      "403": error("The rule comes from an imported ontology."),
      "404": error("Project, branch or rule not found."),
      "409": error("The ontology file has uncommitted changes in the project folder."),
    },
  },
};
