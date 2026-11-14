/**
 * Lint API client for ontology health checking
 */

import { api } from "./client";

// Types
export type LintIssueType = "error" | "warning" | "info";
export type LintRunStatus = "pending" | "running" | "completed" | "failed";
export type SubjectType = "class" | "property" | "individual" | "other";
/** Numeric preset levels exposed by the backend's `/lint/levels` endpoint. */
export type LintLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Known fields the backend populates inside `LintIssue.details`.
 *
 * Add fields here when introducing a new lint rule that emits structured
 * payload data. The index signature keeps the type forward-compatible with
 * unknown rules, but consumers should validate at runtime before reading
 * unknown keys.
 */
export interface LintIssueDetails {
  /** Other entity IRIs that share the offending property (duplicate-label, etc.) */
  duplicate_iris?: string[];
  /** Conflicting label values (label-per-language) */
  labels?: string[];
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
  last_run: LintRun | null;
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

/**
 * Lint configuration payload. The two modes are mutually exclusive — the
 * backend's `enforce_xor` validator rejects requests that set both fields.
 * Modeling this as a discriminated union prevents the bad combination from
 * compiling.
 *
 * - **preset**: `{ lint_level: 1..5 }` — backend computes effective_rules.
 * - **custom**: `{ lint_level: null, enabled_rules: [...] }` — explicit rules.
 */
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

// API functions
export const lintApi = {
  /**
   * Trigger a new lint run for a project. The run executes in the background;
   * poll `getStatus` (see `waitForLintRun`) until `last_run` is no longer
   * pending/running.
   */
  triggerLint: (projectId: string, token: string) =>
    api.post<LintTriggerResponse>(
      `/api/v1/projects/${projectId}/lint/run`,
      undefined,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  /**
   * Get the current lint status and summary for a project
   */
  getStatus: (projectId: string, token?: string) =>
    api.get<LintSummary>(`/api/v1/projects/${projectId}/lint/status`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }),

  /**
   * List all lint runs for a project
   */
  listRuns: (
    projectId: string,
    token?: string,
    options?: { skip?: number; limit?: number }
  ) =>
    api.get<LintRunListResponse>(`/api/v1/projects/${projectId}/lint/runs`, {
      params: options,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }),

  /**
   * Get details of a specific lint run including all issues
   */
  getRun: (projectId: string, runId: string, token?: string) =>
    api.get<LintRunDetail>(
      `/api/v1/projects/${projectId}/lint/runs/${runId}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }
    ),

  /**
   * Get lint issues for a project
   */
  getIssues: (
    projectId: string,
    token?: string,
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
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }
    ),

  /**
   * Dismiss/resolve a lint issue
   */
  dismissIssue: (projectId: string, issueId: string, token: string) =>
    api.delete(`/api/v1/projects/${projectId}/lint/issues/${issueId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  /**
   * Get the list of available lint rules
   */
  getRules: () => api.get<LintRulesResponse>("/api/v1/projects/lint/rules"),

  /**
   * Get lint level definitions (which rules are in each level)
   */
  getLevels: () => api.get<LintLevelsResponse>("/api/v1/projects/lint/levels"),

  /**
   * Get lint configuration for a project
   */
  getLintConfig: (projectId: string, token?: string) =>
    api.get<LintConfigResponse>(`/api/v1/projects/${projectId}/lint/config`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }),

  /**
   * Update lint configuration for a project
   */
  updateLintConfig: (projectId: string, config: LintConfig, token?: string) =>
    api.put<LintConfigResponse>(
      `/api/v1/projects/${projectId}/lint/config`,
      config,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }
    ),

  /**
   * Clear all lint results (runs and issues) for a project
   */
  clearResults: (projectId: string, token: string) =>
    api.delete(`/api/v1/projects/${projectId}/lint/results`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
};

/** True while a lint run is queued or executing. */
export function isLintRunActive(summary: LintSummary | null | undefined): boolean {
  const status = summary?.last_run?.status;
  return status === "pending" || status === "running";
}

/**
 * Poll the lint status endpoint until the latest run finishes (completed/failed).
 * Replaces the old `/lint/ws` websocket. Resolves with the final summary, or null
 * if cancelled via `signal`.
 */
export async function waitForLintRun(
  projectId: string,
  options: { token?: string; intervalMs?: number; signal?: AbortSignal } = {}
): Promise<LintSummary | null> {
  const interval = options.intervalMs ?? 1500;
  for (;;) {
    if (options.signal?.aborted) return null;
    const summary = await lintApi.getStatus(projectId, options.token);
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
