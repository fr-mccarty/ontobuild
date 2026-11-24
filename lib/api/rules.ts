import { api } from "./client";

export type RuleSeverity = "error" | "warning" | "info";

export type RuleConstraint =
  | "min_count"
  | "max_count"
  | "value_class"
  | "value_datatype"
  | "allowed_values"
  | "pattern"
  | "min_length"
  | "max_length"
  | "closed";

export interface RuleValue {
  value: string;
  type: "iri" | "literal";
  datatype?: string | null;
}

export interface RuleFields {
  applies_to_iri: string;
  property_iri: string | null;
  min_count: number | null;
  max_count: number | null;
  value_class_iri: string | null;
  value_datatype_iri: string | null;
  allowed_values: RuleValue[] | null;
  pattern: string | null;
  min_length: number | null;
  max_length: number | null;
  closed: boolean;
  severity: RuleSeverity;
  label: string | null;
  message: string | null;
}

export interface Rule extends RuleFields {
  iri: string;
  read_only: boolean;
  imported_from: string | null;
}

export type RuleInput = Partial<RuleFields> & { applies_to_iri: string; iri?: string; commit_message?: string };

export interface RuleWriteResult {
  rule: Rule;
  commit_hash: string;
  branch: string;
}

export interface RuleViolation {
  rule_iri: string;
  applies_to_iri: string;
  focus_node: string;
  property_iri: string | null;
  value: string | null;
  constraint: RuleConstraint;
  severity: RuleSeverity;
  message: string;
}

export interface RuleCounts {
  error: number;
  warning: number;
  info: number;
  total: number;
}

export interface RuleValidationResult {
  project_id: string;
  branch: string;
  commit_hash: string;
  checked_at: string;
  duration_ms: number;
  rule_count: number;
  counts: RuleCounts;
  violations: RuleViolation[];
}

export interface LatestRuleValidation {
  project_id: string;
  branch: string;
  commit_hash: string | null;
  checked_at: string | null;
  duration_ms: number | null;
  rule_count: number | null;
  counts: RuleCounts;
  violations: RuleViolation[];
  stale: boolean;
}

const base = (projectId: string) => `/api/v1/projects/${projectId}/rules`;

export const rulesApi = {
  list: (projectId: string, branch?: string, classIri?: string) =>
    api.get<{ rules: Rule[] }>(base(projectId), { params: { branch, class: classIri } }),

  get: (projectId: string, iri: string, branch?: string) =>
    api.get<Rule>(`${base(projectId)}/${encodeURIComponent(iri)}`, { params: { branch } }),

  create: (projectId: string, input: RuleInput, branch?: string) =>
    api.post<RuleWriteResult>(base(projectId), input, { params: { branch } }),

  replace: (projectId: string, iri: string, input: RuleInput, branch?: string) =>
    api.put<RuleWriteResult>(`${base(projectId)}/${encodeURIComponent(iri)}`, input, { params: { branch } }),

  remove: (projectId: string, iri: string, branch?: string, commitMessage?: string) =>
    api.delete<void>(`${base(projectId)}/${encodeURIComponent(iri)}`, { params: { branch, commit_message: commitMessage } }),

  shaclUrl: (projectId: string, branch?: string) =>
    `${base(projectId)}/shacl${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`,

  validate: (projectId: string, branch?: string) =>
    api.post<{ job_id: string }>(`${base(projectId)}/validate`, undefined, { params: { branch } }),

  getJobResult: (projectId: string, jobId: string) =>
    api.get<RuleValidationResult | { job_id: string; status: "pending" }>(`${base(projectId)}/jobs/${jobId}`),

  getViolations: (projectId: string, branch?: string, filter: { classIri?: string; entityIri?: string } = {}) =>
    api.get<LatestRuleValidation>(`${base(projectId)}/violations`, {
      params: { branch, class: filter.classIri, entity: filter.entityIri },
    }),
};
