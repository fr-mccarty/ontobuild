/**
 * Typed client for the project workspace API: the project folder's files, terminal
 * sessions and the dev server (base /api/v1/projects/:id/...).
 */
import { api } from "./client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface WorkspaceEntry {
  path: string;
  type: "file" | "dir";
  size: number;
}

export interface WorkspaceFileList {
  entries: WorkspaceEntry[];
  truncated: boolean;
}

export interface WorkspaceFileContent {
  path: string;
  content: string;
  size: number;
}

export interface WorkspaceWriteResult {
  path: string;
  size: number;
  created: boolean;
}

export type TerminalKind = "shell" | "run" | "devserver";

export interface TerminalSession {
  id: string;
  title: string;
  kind: TerminalKind;
  running: boolean;
  exit_code: number | null;
  cwd: string;
}

export interface CreateTerminalRequest {
  kind?: "shell" | "run";
  cwd?: string;
  /** File path (relative to the project folder) to run. */
  run?: string;
  cols?: number;
  rows?: number;
}

export interface DevServerStatus {
  command: string | null;
  cwd: string | null;
  configured_url: string | null;
  detected_url: string | null;
  url: string | null;
  running: boolean;
  terminal_id: string | null;
  suggested_command: string | null;
}

export interface DevServerConfig {
  command?: string;
  cwd?: string;
  url?: string;
}

/** Extensions the server knows how to run. */
export const RUNNABLE_EXTENSIONS = ["sh", "bash", "py", "ts", "mts", "js", "mjs"] as const;

export function fileExtension(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isRunnable(path: string): boolean {
  return (RUNNABLE_EXTENSIONS as readonly string[]).includes(fileExtension(path));
}

const base = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}`;

/** Absolute-or-relative URL for an API path, without going through fetch (img/iframe src, EventSource). */
function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export const workspaceApi = {
  listFiles: (projectId: string) => api.get<WorkspaceFileList>(`${base(projectId)}/files`),

  readFile: (projectId: string, path: string) =>
    api.get<WorkspaceFileContent>(`${base(projectId)}/files/content`, { params: { path } }),

  writeFile: (projectId: string, path: string, content: string) =>
    api.put<WorkspaceWriteResult>(`${base(projectId)}/files/content`, { path, content }),

  deleteFile: (projectId: string, path: string) =>
    api.delete<void>(`${base(projectId)}/files`, { params: { path } }),

  /** URL serving the file's raw bytes (for img/audio/video/iframe src and "Open raw"). */
  rawUrl: (projectId: string, path: string) =>
    apiUrl(`${base(projectId)}/files/raw?path=${encodeURIComponent(path)}`),

  listTerminals: (projectId: string) =>
    api.get<{ items: TerminalSession[] }>(`${base(projectId)}/terminals`),

  createTerminal: (projectId: string, body: CreateTerminalRequest = {}) =>
    api.post<TerminalSession>(`${base(projectId)}/terminals`, body),

  /** SSE stream URL: event "data" {data}, event "exit" {exit_code}. */
  terminalStreamUrl: (projectId: string, terminalId: string) =>
    apiUrl(`${base(projectId)}/terminals/${encodeURIComponent(terminalId)}/stream`),

  sendInput: (projectId: string, terminalId: string, data: string) =>
    api.post<void>(`${base(projectId)}/terminals/${encodeURIComponent(terminalId)}/input`, { data }),

  resizeTerminal: (projectId: string, terminalId: string, cols: number, rows: number) =>
    api.post<void>(`${base(projectId)}/terminals/${encodeURIComponent(terminalId)}/resize`, { cols, rows }),

  closeTerminal: (projectId: string, terminalId: string) =>
    api.delete<void>(`${base(projectId)}/terminals/${encodeURIComponent(terminalId)}`),

  getDevServer: (projectId: string) => api.get<DevServerStatus>(`${base(projectId)}/dev-server`),

  configureDevServer: (projectId: string, config: DevServerConfig) =>
    api.put<DevServerStatus>(`${base(projectId)}/dev-server`, config),

  startDevServer: (projectId: string) => api.post<DevServerStatus>(`${base(projectId)}/dev-server/start`),

  stopDevServer: (projectId: string) => api.post<DevServerStatus>(`${base(projectId)}/dev-server/stop`),
};
