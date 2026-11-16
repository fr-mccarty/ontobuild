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
    branch?: string
  ) =>
    api.get<CrossReferencesResponse>(
      `/api/v1/projects/${projectId}/entities/${encodeURIComponent(entityIri)}/references`,
      {
        params: { branch },
      }
    ),

  triggerConsistencyCheck: (
    projectId: string,
    branch?: string
  ) =>
    api.post<{ job_id: string }>(
      `/api/v1/projects/${projectId}/quality/check`,
      undefined,
      {
        params: { branch },
      }
    ),

  getConsistencyJobResult: (
    projectId: string,
    jobId: string
  ) =>
    api.get<ConsistencyCheckResult | QualityJobPendingResponse>(
      `/api/v1/projects/${projectId}/quality/jobs/${jobId}`
    ),

  getConsistencyIssues: (
    projectId: string,
    branch?: string
  ) =>
    api.get<LatestConsistencyResult>(
      `/api/v1/projects/${projectId}/quality/issues`,
      {
        params: { branch },
      }
    ),

  triggerDuplicateDetection: (
    projectId: string,
    branch?: string,
    threshold = 0.85
  ) =>
    api.post<{ job_id: string }>(
      `/api/v1/projects/${projectId}/quality/duplicates`,
      undefined,
      {
        params: { branch, threshold },
      }
    ),

  getDuplicateJobResult: (
    projectId: string,
    jobId: string
  ) =>
    api.get<DuplicateDetectionResult | QualityJobPendingResponse>(
      `/api/v1/projects/${projectId}/quality/duplicates/jobs/${jobId}`
    ),

  getLatestDuplicates: (
    projectId: string,
    branch?: string
  ) =>
    api.get<LatestDuplicateResult>(
      `/api/v1/projects/${projectId}/quality/duplicates/latest`,
      {
        params: { branch },
      }
    ),
};
