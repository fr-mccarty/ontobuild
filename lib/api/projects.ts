import { api, type UploadProgress } from "./client";

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
  created_at: string;
  updated_at?: string;
  source_file_path?: string;
  git_ontology_path?: string;
  /** Folder name under data/projects (the git working tree with ontology.ttl and code/). */
  folder?: string | null;
  ontology_iri?: string;
  label_preferences?: string[];
  normalization_report?: NormalizationReport;
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
  list: (skip = 0, limit = 20, search?: string) => {
    return api.get<ProjectListResponse>("/api/v1/projects", {
      params: { skip, limit, search: search || undefined },
    });
  },

  get: (id: string) => {
    return api.get<Project>(`/api/v1/projects/${id}`);
  },

  create: (data: ProjectCreate) =>
    api.post<Project>("/api/v1/projects", data),

  import: (
    data: ProjectImportData,
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
          onProgress,
        }
      );
    }

    return api.upload<ProjectImportResponse>("/api/v1/projects/import", formData);
  },

  update: (id: string, data: ProjectUpdate) =>
    api.patch<Project>(`/api/v1/projects/${id}`, data),

  delete: (id: string) =>
    api.delete(`/api/v1/projects/${id}`),
};
