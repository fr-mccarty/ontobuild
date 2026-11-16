import { api } from "./client";

export type LintIssueType = "error" | "warning" | "info";
export type LintRunStatus = "pending" | "running" | "completed" | "failed";
export type SubjectType = "class" | "property" | "individual" | "other";
export type LintLevel = 1 | 2 | 3 | 4 | 5;

export interface LintIssueDetails {
  duplicate_iris?: string[];
  [key: string]: unknown;
}

export interface LintIssue {
  id: string;
  run_id: string;
  project_id: string;
  issue_type: LintIssueType;
  rule_id: string;
  message: string;
  subject_iri: string | null;
  subject_type: SubjectType | null;
  details: LintIssueDetails | null;
  created_at: string;
  resolved_at: string | null;
}

export interface LintRun {
  id: string;
  project_id: string;
  branch: string | null;
  status: LintRunStatus;
  started_at: string;
  completed_at: string | null;
  issues_found: number | null;
  error_message: string | null;
}

export interface LintRunDetail extends LintRun {
  issues: LintIssue[];
}

export interface LintSummary {
  project_id: string;
  /** The most recent run; it may still be pending or running. */
  last_run: LintRun | null;
  /** The completed run the counts come from, or null when no run has completed. */
  counts_run_id: string | null;
  error_count: number;
  warning_count: number;
  info_count: number;
  total_issues: number;
}

export interface LintTriggerResponse {
  job_id: string;
  status: string;
  message: string;
}

export interface LintIssueListResponse {
  items: LintIssue[];
  total: number;
  skip: number;
  limit: number;
}

export interface LintRunListResponse {
  items: LintRun[];
  total: number;
  skip: number;
  limit: number;
}

export interface LintRuleInfo {
  rule_id: string;
  name: string;
  description: string;
  severity: LintIssueType;
  scope: string[];
}

export interface LintRulesResponse {
  rules: LintRuleInfo[];
}

export interface LintLevelInfo {
  level: LintLevel;
  name: string;
  description: string;
  rule_ids: string[];
}

export interface LintLevelsResponse {
  levels: LintLevelInfo[];
}

export type LintConfig =
  | { lint_level: LintLevel; enabled_rules?: never }
  | { lint_level: null; enabled_rules: string[] };

export interface LintConfigResponse {
  project_id: string;
  lint_level: LintLevel | null;
  enabled_rules: string[] | null;
  effective_rules: string[];
  updated_at: string | null;
}

export const lintApi = {
  triggerLint: (projectId: string) =>
    api.post<LintTriggerResponse>(
      `/api/v1/projects/${projectId}/lint/run`,
      undefined
    ),

  getStatus: (projectId: string) =>
    api.get<LintSummary>(`/api/v1/projects/${projectId}/lint/status`),

  listRuns: (
    projectId: string,
    options?: { skip?: number; limit?: number }
  ) =>
    api.get<LintRunListResponse>(`/api/v1/projects/${projectId}/lint/runs`, {
      params: options,
    }),

  getRun: (projectId: string, runId: string, options?: { include_resolved?: boolean }) =>
    api.get<LintRunDetail>(
      `/api/v1/projects/${projectId}/lint/runs/${runId}`,
      {
        params: options,
      }
    ),

  getIssues: (
    projectId: string,
    options?: {
      issue_type?: LintIssueType;
      rule_id?: string;
      subject_iri?: string;
      include_resolved?: boolean;
      skip?: number;
      limit?: number;
    }
  ) =>
    api.get<LintIssueListResponse>(
      `/api/v1/projects/${projectId}/lint/issues`,
      {
        params: options,
      }
    ),

  dismissIssue: (projectId: string, issueId: string) =>
    api.delete(`/api/v1/projects/${projectId}/lint/issues/${issueId}`),

  getRules: () => api.get<LintRulesResponse>("/api/v1/projects/lint/rules"),

  getLevels: () => api.get<LintLevelsResponse>("/api/v1/projects/lint/levels"),

  getLintConfig: (projectId: string) =>
    api.get<LintConfigResponse>(`/api/v1/projects/${projectId}/lint/config`),

  updateLintConfig: (projectId: string, config: LintConfig) =>
    api.put<LintConfigResponse>(
      `/api/v1/projects/${projectId}/lint/config`,
      config
    ),

  clearResults: (projectId: string) =>
    api.delete(`/api/v1/projects/${projectId}/lint/results`),
};

export function isLintRunActive(summary: LintSummary | null | undefined): boolean {
  const status = summary?.last_run?.status;
  return status === "pending" || status === "running";
}

export async function waitForLintRun(
  projectId: string,
  options: { intervalMs?: number; signal?: AbortSignal } = {}
): Promise<LintSummary | null> {
  const interval = options.intervalMs ?? 1500;
  for (;;) {
    if (options.signal?.aborted) return null;
    const summary = await lintApi.getStatus(projectId);
    if (!isLintRunActive(summary)) return summary;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, interval);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
    });
  }
}
