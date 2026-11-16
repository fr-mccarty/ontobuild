import { api } from "./client";

export type PRStatus = "open" | "merged" | "closed";
export type ReviewStatus = "approved" | "changes_requested" | "commented";

export interface PRUser {
  id: string;
  name: string | null;
  email: string | null;
}

export interface PullRequest {
  id: string;
  project_id: string;
  pr_number: number;
  title: string;
  description: string | null;
  source_branch: string;
  target_branch: string;
  status: PRStatus;
  author_id: string;
  author: PRUser | null;
  merged_by: string | null;
  merged_by_user: PRUser | null;
  merged_at: string | null;
  merge_commit_hash: string | null;
  base_commit_hash: string | null;
  head_commit_hash: string | null;
  created_at: string;
  updated_at: string | null;
  review_count: number;
  approval_count: number;
  comment_count: number;
  commits_ahead: number;
  /** Open, has commits to merge (commits_ahead > 0) and enough approvals. */
  can_merge: boolean;
}

export interface PRListResponse {
  items: PullRequest[];
  total: number;
  skip: number;
  limit: number;
}

export interface PRCreate {
  title: string;
  description?: string | null;
  source_branch: string;
  target_branch?: string;
}

export interface PRUpdate {
  title?: string;
  /** null clears the description; omit to leave it unchanged. */
  description?: string | null;
}

export interface PRMergeRequest {
  merge_message?: string;
  delete_source_branch?: boolean;
}

export interface PRMergeResponse {
  success: boolean;
  message: string;
  merged_at?: string;
  merge_commit_hash?: string;
}

export interface Review {
  id: string;
  pull_request_id: string;
  reviewer_id: string;
  reviewer: PRUser | null;
  status: ReviewStatus;
  body: string | null;
  created_at: string;
}

export interface ReviewListResponse {
  items: Review[];
  total: number;
}

export interface ReviewCreate {
  status: ReviewStatus;
  body?: string;
}

export interface Comment {
  id: string;
  pull_request_id: string;
  author_id: string;
  author: PRUser | null;
  body: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string | null;
  replies: Comment[];
}

export interface CommentListResponse {
  /** Top-level comments, each with its replies nested. */
  items: Comment[];
  /** All comments including replies; matches PullRequest.comment_count. */
  total: number;
}

export interface CommentCreate {
  body: string;
  parent_id?: string;
}

export interface CommentUpdate {
  body: string;
}

export interface PRCommit {
  hash: string;
  short_hash: string;
  message: string;
  author_name: string;
  author_email: string;
  timestamp: string;
}

export interface PRCommitListResponse {
  items: PRCommit[];
  total: number;
}

export interface PRFileChange {
  path: string;
  change_type: "added" | "modified" | "deleted" | "renamed";
  old_path: string | null;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface PRDiffResponse {
  files: PRFileChange[];
  total_additions: number;
  total_deletions: number;
  files_changed: number;
}

export interface PRSettings {
  pr_approval_required: number;
}

export interface PRSettingsUpdate {
  pr_approval_required: number;
}

export interface ProjectOpenPRCount {
  project_id: string;
  project_name: string;
  open_count: number;
}

export interface OpenPRsSummary {
  total_open: number;
  by_project: ProjectOpenPRCount[];
}

export const pullRequestsApi = {
  getOpenSummary: (token: string) =>
    api.get<OpenPRsSummary>(
      `/api/v1/projects/pull-requests/open-summary`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  list: (
    projectId: string,
    token?: string,
    status?: PRStatus,
    authorId?: string,
    skip = 0,
    limit = 20
  ) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<PRListResponse>(
      `/api/v1/projects/${projectId}/pull-requests`,
      {
        params: { status, author_id: authorId, skip, limit },
        headers,
      }
    );
  },

  get: (projectId: string, prNumber: number, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<PullRequest>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}`,
      { headers }
    );
  },

  create: (projectId: string, data: PRCreate, token: string) =>
    api.post<PullRequest>(
      `/api/v1/projects/${projectId}/pull-requests`,
      data,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  update: (
    projectId: string,
    prNumber: number,
    data: PRUpdate,
    token: string
  ) =>
    api.patch<PullRequest>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}`,
      data,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  close: (projectId: string, prNumber: number, token: string) =>
    api.post<PullRequest>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/close`,
      undefined,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  reopen: (projectId: string, prNumber: number, token: string) =>
    api.post<PullRequest>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/reopen`,
      undefined,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  merge: (
    projectId: string,
    prNumber: number,
    data: PRMergeRequest,
    token: string
  ) =>
    api.post<PRMergeResponse>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/merge`,
      data,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  getCommits: (projectId: string, prNumber: number, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<PRCommitListResponse>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/commits`,
      { headers }
    );
  },

  getDiff: (projectId: string, prNumber: number, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<PRDiffResponse>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/diff`,
      { headers }
    );
  },

  listReviews: (projectId: string, prNumber: number, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<ReviewListResponse>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/reviews`,
      { headers }
    );
  },

  createReview: (
    projectId: string,
    prNumber: number,
    data: ReviewCreate,
    token: string
  ) =>
    api.post<Review>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/reviews`,
      data,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  listComments: (projectId: string, prNumber: number, token?: string) => {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return api.get<CommentListResponse>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/comments`,
      { headers }
    );
  },

  createComment: (
    projectId: string,
    prNumber: number,
    data: CommentCreate,
    token: string
  ) =>
    api.post<Comment>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/comments`,
      data,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  updateComment: (
    projectId: string,
    prNumber: number,
    commentId: string,
    data: CommentUpdate,
    token: string
  ) =>
    api.patch<Comment>(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/comments/${commentId}`,
      data,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),

  deleteComment: (
    projectId: string,
    prNumber: number,
    commentId: string,
    token: string
  ) =>
    api.delete(
      `/api/v1/projects/${projectId}/pull-requests/${prNumber}/comments/${commentId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    ),
};

export const prSettingsApi = {
  get: (projectId: string, token: string) =>
    api.get<PRSettings>(`/api/v1/projects/${projectId}/pr-settings`, {
      headers: { Authorization: `Bearer ${token}` },
    }),

  update: (projectId: string, data: PRSettingsUpdate, token: string) =>
    api.patch<PRSettings>(`/api/v1/projects/${projectId}/pr-settings`, data, {
      headers: { Authorization: `Bearer ${token}` },
    }),
};
