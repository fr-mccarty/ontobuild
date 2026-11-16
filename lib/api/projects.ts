import { api, type UploadProgress } from "./client";

export type ProjectRole = "owner" | "admin" | "editor" | "viewer";

export interface ProjectOwner {
  id: string;
  name?: string;
  email?: string;
}

export interface NormalizationReport {
  original_format: string;
  original_filename: string;
  original_size_bytes: number;
  normalized_size_bytes: number;
  triple_count: number;
  prefixes_before: string[];
  prefixes_after: string[];
  prefixes_removed: string[];
  prefixes_added: string[];
  format_converted: boolean;
  notes: string[];
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  is_public: boolean;
  owner_id: string;
  owner?: ProjectOwner;
  created_at: string;
  updated_at?: string;
  member_count: number;
  user_role?: ProjectRole;
  is_superadmin?: boolean;
  source_file_path?: string;
  git_ontology_path?: string;
  ontology_iri?: string;
  label_preferences?: string[];
  normalization_report?: NormalizationReport;
  is_exemplar?: boolean;
  exemplar_slug?: string;
  exemplar_source_url?: string;
}

export interface ProjectListResponse {
  items: Project[];
  total: number;
  unfiltered_total: number;
  skip: number;
  limit: number;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  is_public?: boolean;
}

export interface ProjectUpdate {
  name?: string;
  /** null clears the description; omit to leave it unchanged. */
  description?: string | null;
  is_public?: boolean;
  label_preferences?: string[];
}

export interface ProjectImportResponse extends Project {
  ontology_iri?: string;
  file_path: string;
}

export interface ProjectImportData {
  file: File;
  is_public: boolean;
  name?: string;
  description?: string;
}

export const projectApi = {
  list: (skip = 0, limit = 20, token?: string, search?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<ProjectListResponse>("/api/v1/projects", {
      params: { skip, limit, search: search || undefined },
      headers,
    });
  },

  get: (id: string, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<Project>(`/api/v1/projects/${id}`, { headers });
  },

  create: (data: ProjectCreate, token: string) =>
    api.post<Project>("/api/v1/projects", data, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  import: (
    data: ProjectImportData,
    token: string,
    onProgress?: (progress: UploadProgress) => void
  ) => {
    const formData = new FormData();
    formData.append("file", data.file);
    formData.append("is_public", String(data.is_public));
    if (data.name) {
      formData.append("name", data.name);
    }
    if (data.description) {
      formData.append("description", data.description);
    }

    if (onProgress) {
      return api.uploadWithProgress<ProjectImportResponse>(
        "/api/v1/projects/import",
        formData,
        {
          headers: { Authorization: `Bearer ${token}` },
          onProgress,
        }
      );
    }

    return api.upload<ProjectImportResponse>("/api/v1/projects/import", formData, {
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  update: (id: string, data: ProjectUpdate, token: string) =>
    api.patch<Project>(`/api/v1/projects/${id}`, data, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  delete: (id: string, token: string) =>
    api.delete(`/api/v1/projects/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
};
