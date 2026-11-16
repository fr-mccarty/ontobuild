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

export const normalizationApi = {
  getStatus: (projectId: string) => {
    return api.get<NormalizationStatusResponse>(
      `/api/v1/projects/${projectId}/normalization/status`
    );
  },

  runNormalization: (
    projectId: string,
    dryRun: boolean = false
  ) =>
    api.post<NormalizationRunResponse>(
      `/api/v1/projects/${projectId}/normalization`,
      { dry_run: dryRun }
    ),

  getHistory: (
    projectId: string,
    limit: number = 10,
    includeDryRuns: boolean = false
  ) => {
    return api.get<NormalizationHistoryResponse>(
      `/api/v1/projects/${projectId}/normalization/history`,
      {
        params: { limit, include_dry_runs: includeDryRuns },
      }
    );
  },

  getRun: (projectId: string, runId: string) => {
    return api.get<NormalizationRunResponse>(
      `/api/v1/projects/${projectId}/normalization/runs/${runId}`
    );
  },

  refreshStatus: (projectId: string) => {
    return api.post<RefreshStatusResponse>(
      `/api/v1/projects/${projectId}/normalization/refresh`,
      {}
    );
  },

  queueNormalization: (projectId: string, dryRun: boolean) =>
    api.post<QueuedJobResponse>(
      `/api/v1/projects/${projectId}/normalization/queue`,
      { dry_run: dryRun }
    ),

  getJobStatus: (projectId: string, jobId: string) => {
    return api.get<JobStatusResponse>(
      `/api/v1/projects/${projectId}/normalization/jobs/${jobId}`
    );
  },
};
