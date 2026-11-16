import { api } from "./client";

export interface RevisionCommit {
  hash: string;
  short_hash: string;
  message: string;
  author_name: string;
  author_email: string;
  timestamp: string;
  is_merge?: boolean;
  merged_branch?: string;
  parent_hashes: string[];
}

export interface RevisionHistoryResponse {
  project_id: string;
  commits: RevisionCommit[];
  total: number;
  refs?: Record<string, string[]>;
}

export interface RevisionDiffChange {
  path: string;
  change_type: string;
  old_path?: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface RevisionDiffResponse {
  project_id: string;
  from_version: string;
  to_version: string;
  files_changed: number;
  total_additions: number;
  total_deletions: number;
  changes: RevisionDiffChange[];
}

export interface RevisionFileResponse {
  project_id: string;
  version: string;
  filename: string;
  content: string;
}

export interface BranchInfo {
  name: string;
  is_current: boolean;
  is_default: boolean;
  commit_hash?: string;
  commit_message?: string;
  commit_date?: string;
  commits_ahead: number;
  commits_behind: number;
  created_by_id?: string;
  created_by_name?: string;
  can_delete: boolean;
  has_open_pr: boolean;
  has_delete_permission: boolean;
}

export interface BranchListResponse {
  items: BranchInfo[];
  current_branch: string;
  default_branch: string;
  preferred_branch: string | null;
}

export interface BranchCreate {
  name: string;
  from_branch?: string;
}

export const revisionsApi = {
  getHistory: (projectId: string, token?: string, limit = 50) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<RevisionHistoryResponse>(
      `/api/v1/projects/${projectId}/revisions`,
      {
        params: { limit },
        headers,
      }
    );
  },

  getFileAtVersion: (
    projectId: string,
    version: string,
    token?: string,
    filename = "ontology.ttl"
  ) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<RevisionFileResponse>(
      `/api/v1/projects/${projectId}/revisions/file`,
      {
        params: { version, filename },
        headers,
      }
    );
  },

  getDiff: (
    projectId: string,
    fromVersion: string,
    toVersion = "HEAD",
    token?: string
  ) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<RevisionDiffResponse>(
      `/api/v1/projects/${projectId}/revisions/diff`,
      {
        params: { from_version: fromVersion, to_version: toVersion },
        headers,
      }
    );
  },
};

export const branchesApi = {
  list: (projectId: string, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<BranchListResponse>(
      `/api/v1/projects/${projectId}/branches`,
      { headers }
    );
  },

  create: (projectId: string, data: BranchCreate, token: string) =>
    api.post<BranchInfo>(`/api/v1/projects/${projectId}/branches`, data, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  delete: (projectId: string, branchName: string, token: string, force = false) =>
    api.delete(
      `/api/v1/projects/${projectId}/branches/${encodeURIComponent(branchName)}`,
      {
        params: { force },
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  savePreference: (projectId: string, branch: string, token: string) =>
    api.put<void>(
      `/api/v1/projects/${projectId}/branch-preference`,
      undefined,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { branch },
      }
    ),
};
