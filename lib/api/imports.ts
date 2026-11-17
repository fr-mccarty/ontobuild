/**
 * Typed client for ontology imports (owl:imports): /api/v1/projects/:id/imports and
 * /api/v1/import-candidates.
 */
import { api } from "./client";

export interface ImportStatus {
  iri: string;
  source: "project" | "remote";
  project_id?: string;
  project_name?: string;
  status: "ok" | "error" | "cycle";
  error?: string;
  class_count: number;
  direct: boolean;
  imported_by: string[];
  label: string | null;
  fetched_at?: string | null;
}

export interface ImportsResponse {
  direct: string[];
  closure: ImportStatus[];
}

export interface ImportCandidate {
  project_id: string;
  name: string;
  ontology_iri: string;
  description: string | null;
}

export const importsApi = {
  list: (projectId: string, branch?: string) =>
    api.get<ImportsResponse>(`/api/v1/projects/${projectId}/imports`, { params: { branch } }),

  add: (projectId: string, iri: string, branch?: string, commitMessage?: string) =>
    api.post<ImportsResponse>(
      `/api/v1/projects/${projectId}/imports`,
      { iri, ...(commitMessage ? { commit_message: commitMessage } : {}) },
      { params: { branch } },
    ),

  remove: (projectId: string, iri: string, branch?: string) =>
    api.delete<ImportsResponse>(`/api/v1/projects/${projectId}/imports`, { params: { branch, iri } }),

  refresh: (projectId: string, branch?: string) =>
    api.post<ImportsResponse>(`/api/v1/projects/${projectId}/imports/refresh`, undefined, { params: { branch } }),

  candidates: (q: string) => api.get<ImportCandidate[]>(`/api/v1/import-candidates`, { params: { q } }),
};

/** The `detail` of an API error response, or the error's message. */
export function importErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(message) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // Not JSON: use the message as is.
  }
  return message;
}
