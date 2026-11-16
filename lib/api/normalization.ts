import { api } from "./client";
import { NormalizationReport } from "./projects";

export interface NormalizationStatusResponse {
  /** null when the status can't be determined; `error` then says why. */
  needs_normalization: boolean | null;
  last_run: string | null;
  last_run_id: string | null;
  last_check: string | null;
  preview_report: NormalizationReport | null;
  error: string | null;
}

export interface RefreshStatusResponse {
  message: string;
  job_id: string | null;
}

export interface QueuedJobResponse {
  message: string;
  job_id: string;
  status: string;
}

export interface JobStatusResponse {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface NormalizationRunResponse {
  id: string;
  project_id: string;
  created_at: string;
  triggered_by: string | null;
  trigger_type: string;
  /** null only if the stored report could not be read. */
  report: NormalizationReport | null;
  is_dry_run: boolean;
  commit_hash: string | null;
  original_content: string | null;
  normalized_content: string | null;
}

export interface NormalizationHistoryResponse {
  items: NormalizationRunResponse[];
  total: number;
}

export interface NormalizationTriggerRequest {
  dry_run?: boolean;
}

export const normalizationApi = {
  getStatus: (projectId: string, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<NormalizationStatusResponse>(
      `/api/v1/projects/${projectId}/normalization/status`,
      { headers }
    );
  },

  runNormalization: (
    projectId: string,
    dryRun: boolean = false,
    token: string
  ) =>
    api.post<NormalizationRunResponse>(
      `/api/v1/projects/${projectId}/normalization`,
      { dry_run: dryRun },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  getHistory: (
    projectId: string,
    limit: number = 10,
    includeDryRuns: boolean = false,
    token?: string
  ) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<NormalizationHistoryResponse>(
      `/api/v1/projects/${projectId}/normalization/history`,
      {
        params: { limit, include_dry_runs: includeDryRuns },
        headers,
      }
    );
  },

  getRun: (projectId: string, runId: string, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<NormalizationRunResponse>(
      `/api/v1/projects/${projectId}/normalization/runs/${runId}`,
      { headers }
    );
  },

  refreshStatus: (projectId: string, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.post<RefreshStatusResponse>(
      `/api/v1/projects/${projectId}/normalization/refresh`,
      {},
      { headers }
    );
  },

  queueNormalization: (projectId: string, dryRun: boolean, token: string) =>
    api.post<QueuedJobResponse>(
      `/api/v1/projects/${projectId}/normalization/queue`,
      { dry_run: dryRun },
      { headers: { Authorization: `Bearer ${token}` } }
    ),

  getJobStatus: (projectId: string, jobId: string, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<JobStatusResponse>(
      `/api/v1/projects/${projectId}/normalization/jobs/${jobId}`,
      { headers }
    );
  },
};
