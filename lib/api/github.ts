/**
 * Typed client for linking a project to GitHub (or another git host): the `origin` remote,
 * fetch, push, fast-forward pull and creating a repository with the gh CLI.
 */
import { ApiError } from "./client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface GitHubRemote {
  remote_url: string | null;
  web_url: string | null;
  host: string | null;
  is_github: boolean;
  branch: string;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  last_fetched_at: string | null;
  gh_available: boolean;
  gh_authenticated: boolean;
}

export interface GitHubRemoteResult extends GitHubRemote {
  output: string;
}

export interface CreateGitHubRepoRequest {
  name: string;
  private: boolean;
  description?: string;
}

/** Remote operations can take up to a minute on the server, longer than the shared client's timeout. */
const TIMEOUT_MS = 90_000;

async function call<T>(projectId: string, method: string, sub = "", body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/v1/projects/${encodeURIComponent(projectId)}/github${sub}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, res.statusText, text);
    return (text ? JSON.parse(text) : undefined) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** The `detail` of an API error body, or the error's message. */
export function githubErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.message) as { detail?: unknown };
      if (typeof parsed.detail === "string") return parsed.detail;
    } catch {
    }
    return error.message || `${error.status} ${error.statusText}`;
  }
  if (error instanceof Error) return error.name === "AbortError" ? "The request timed out." : error.message;
  return String(error);
}

export const githubApi = {
  get: (projectId: string) => call<GitHubRemote>(projectId, "GET"),
  link: (projectId: string, remoteUrl: string) => call<GitHubRemote>(projectId, "PUT", "", { remote_url: remoteUrl }),
  unlink: (projectId: string) => call<void>(projectId, "DELETE"),
  fetch: (projectId: string) => call<GitHubRemoteResult>(projectId, "POST", "/fetch", {}),
  push: (projectId: string, opts: { all?: boolean } = {}) =>
    call<GitHubRemoteResult>(projectId, "POST", "/push", opts),
  pull: (projectId: string) => call<GitHubRemoteResult>(projectId, "POST", "/pull", {}),
  create: (projectId: string, req: CreateGitHubRepoRequest) =>
    call<GitHubRemoteResult>(projectId, "POST", "/create", req),
};
