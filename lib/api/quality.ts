import { api } from "./client";
import type {
  CrossReferencesResponse,
  ConsistencyCheckResult,
  DuplicateDetectionResult,
  LatestConsistencyResult,
  LatestDuplicateResult,
  QualityJobPendingResponse,
} from "@/lib/ontology/qualityTypes";

export const qualityApi = {
  getCrossReferences: (
    projectId: string,
    entityIri: string,
    token?: string,
    branch?: string
  ) =>
    api.get<CrossReferencesResponse>(
      `/api/v1/projects/${projectId}/entities/${encodeURIComponent(entityIri)}/references`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        params: { branch },
      }
    ),

  triggerConsistencyCheck: (
    projectId: string,
    token: string,
    branch?: string
  ) =>
    api.post<{ job_id: string }>(
      `/api/v1/projects/${projectId}/quality/check`,
      undefined,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { branch },
      }
    ),

  getConsistencyJobResult: (
    projectId: string,
    jobId: string,
    token?: string
  ) =>
    api.get<ConsistencyCheckResult | QualityJobPendingResponse>(
      `/api/v1/projects/${projectId}/quality/jobs/${jobId}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }
    ),

  getConsistencyIssues: (
    projectId: string,
    token?: string,
    branch?: string
  ) =>
    api.get<LatestConsistencyResult>(
      `/api/v1/projects/${projectId}/quality/issues`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        params: { branch },
      }
    ),

  triggerDuplicateDetection: (
    projectId: string,
    token: string,
    branch?: string,
    threshold = 0.85
  ) =>
    api.post<{ job_id: string }>(
      `/api/v1/projects/${projectId}/quality/duplicates`,
      undefined,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { branch, threshold },
      }
    ),

  getDuplicateJobResult: (
    projectId: string,
    jobId: string,
    token?: string
  ) =>
    api.get<DuplicateDetectionResult | QualityJobPendingResponse>(
      `/api/v1/projects/${projectId}/quality/duplicates/jobs/${jobId}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }
    ),

  getLatestDuplicates: (
    projectId: string,
    token?: string,
    branch?: string
  ) =>
    api.get<LatestDuplicateResult>(
      `/api/v1/projects/${projectId}/quality/duplicates/latest`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        params: { branch },
      }
    ),
};
