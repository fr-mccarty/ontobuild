import { api, ApiError, type UploadProgress } from "./client";

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

/** The ontology file in the project folder, compared with the checked-out branch's last commit. */
export interface OntologyLocalChanges {
  /** The branch checked out in the folder (where a commit goes); null when detached. */
  branch: string | null;
  path: string | null;
  changed: boolean;
  /** Why the changes can't be committed (the file is missing or doesn't parse); null when they can. */
  problem: string | null;
}

export interface OntologyLocalCommit {
  branch: string;
  path: string;
  commit_hash: string;
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

export interface GitImportRequest {
  /** https://, ssh:// or git@host:owner/repo URL. */
  url: string;
  /** Branch to check out; the repository's default branch when omitted. */
  branch?: string;
  /** Project name; the repository name when omitted. */
  name?: string;
  description?: string;
  /** Repository-relative path of the ontology file; discovered when omitted. */
  ontology_path?: string;
}

export interface GitImportCandidate {
  path: string;
  format: string;
  size_bytes: number;
  declares_ontology: boolean;
}

export interface GitImportSummary {
  remote_url: string;
  web_url: string | null;
  branch: string | null;
  /** The Turtle file the project edits, or null when the repository has no ontology. */
  ontology_path: string | null;
  /** The file the ontology came from (differs from ontology_path when converted). */
  source_path: string | null;
  converted: boolean;
  selection: "requested" | "automatic" | "none";
  candidates: GitImportCandidate[];
  warnings: string[];
}

export interface GitImportResponse extends Project {
  git_import: GitImportSummary;
}

/** An RDF file in the project folder (tracked by git on the listed branch). */
export interface OntologyFile {
  /** Repository-relative path. */
  path: string;
  format: string;
  size_bytes: number;
  declares_ontology: boolean;
  /** This is the project's ontology file. */
  active: boolean;
  /** For a file that isn't Turtle: the Turtle file choosing it makes the ontology; null for Turtle files. */
  turtle_path: string | null;
  /** For a file that isn't Turtle: turtle_path already exists; it is reused when up to date (else the user is asked). */
  turtle_exists: boolean;
}

export interface OntologyFileList {
  project_id: string;
  branch: string;
  /** The project's ontology file (one for the whole project), or null when it has none. */
  active_path: string | null;
  /** Whether the active file exists on this branch. */
  active_exists: boolean;
  files: OntologyFile[];
  /** A free name for a new ontology file. */
  suggested_file_name: string;
}

export interface OntologyFileChange {
  project: Project;
  branch: string;
  /** The Turtle file the project now edits. */
  path: string;
  /** The file that was chosen (differs from path when it was converted or a Turtle copy was used). */
  source_path: string;
  converted: boolean;
  reused: boolean;
  /** An existing .ttl was overwritten by converting the chosen file again (`reconvert: true`). */
  replaced: boolean;
  previous_path: string | null;
  commit_hash: string | null;
  warnings: string[];
}

export interface OntologyFileCreate {
  file_name: string;
  ontology_iri: string;
  title: string;
  branch?: string;
}

/** The error code of a switch whose existing .ttl is out of date; send it again with `reconvert`. */
export const TURTLE_OUT_OF_DATE = "turtle_out_of_date";

/** Display names of the formats the server reports. */
export const ONTOLOGY_FORMAT_NAMES: Record<string, string> = {
  turtle: "Turtle",
  n3: "Notation3",
  ntriples: "N-Triples",
  nquads: "N-Quads",
  trig: "TriG",
  rdfxml: "RDF/XML",
  jsonld: "JSON-LD",
};

/** The `detail` of an API error body, or the error's message. */
export function projectErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return error instanceof Error ? error.message : String(error);
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
/** A clone may take up to 5 minutes on the server; the shared client would time out and retry it. */
const CLONE_TIMEOUT_MS = 6 * 60_000;

async function importFromGit(data: GitImportRequest): Promise<GitImportResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLONE_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/v1/projects/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, res.statusText, text);
    return JSON.parse(text) as GitImportResponse;
  } finally {
    clearTimeout(timer);
  }
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

  /** Clone a git repository into a new project (one request, no retries). */
  importFromGit,

  update: (id: string, data: ProjectUpdate) =>
    api.patch<Project>(`/api/v1/projects/${id}`, data),

  delete: (id: string) =>
    api.delete(`/api/v1/projects/${id}`),

  /** The RDF files in the project folder on a branch, and which one is the ontology. */
  listOntologyFiles: (id: string, branch?: string) =>
    api.get<OntologyFileList>(`/api/v1/projects/${id}/ontology-files`, { params: { branch } }),

  /**
   * Make another file in the folder the project's ontology (non-Turtle files are converted).
   * `reconvert` is for a non-Turtle file whose .ttl exists already but is out of date (the server
   * then answers 409 with code "turtle_out_of_date"): true converts again and overwrites the .ttl
   * in a new commit, false uses the .ttl as it is.
   */
  switchOntologyFile: (id: string, path: string, branch?: string, options: { reconvert?: boolean } = {}) =>
    api.put<OntologyFileChange>(`/api/v1/projects/${id}/ontology-file`, { path, branch, reconvert: options.reconvert }),

  /** Whether the ontology file in the project folder has changes made outside OntoBuilder that aren't committed. */
  getOntologyLocalChanges: (id: string) =>
    api.get<OntologyLocalChanges>(`/api/v1/projects/${id}/ontology-file/local-changes`),

  /** Commit the ontology file as it is in the project folder to the checked-out branch. */
  commitOntologyLocalChanges: (id: string) =>
    api.post<OntologyLocalCommit>(`/api/v1/projects/${id}/ontology-file/local-changes/commit`),

  /** Create a new, empty ontology file and make it the project's ontology. */
  createOntologyFile: (id: string, data: OntologyFileCreate) =>
    api.post<OntologyFileChange>(`/api/v1/projects/${id}/ontology-file`, data),
};
