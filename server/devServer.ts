import fs from "node:fs";
import path from "node:path";
import { get, nowIso, run } from "./db";
import { httpError } from "./http";
import { resolveProjectPath } from "./workspaceFiles";
import { listTerminals, spawnTerminal, killTerminal, removeTerminal, userShell, type TerminalSession } from "./terminals";

/**
 * The project's dev server: a configured (or suggested) shell command run in a pty session
 * of kind "devserver". Config lives in project_workspace_settings.
 */

export interface DevServerStatus {
  command: string | null;
  cwd: string;
  configured_url: string | null;
  detected_url: string | null;
  url: string | null;
  running: boolean;
  terminal_id: string | null;
  suggested_command: string | null;
}

interface SettingsRow {
  dev_command: string | null;
  dev_cwd: string | null;
  dev_url: string | null;
}

interface Suggestion {
  command: string;
  cwd: string;
  url: string | null;
}

function readSettings(projectId: string): SettingsRow {
  return (
    get<SettingsRow>("SELECT dev_command, dev_cwd, dev_url FROM project_workspace_settings WHERE project_id = ?", projectId) ?? {
      dev_command: null,
      dev_cwd: null,
      dev_url: null,
    }
  );
}

/** A dev command guessed from the files in code/. */
export function suggestDevCommand(projectId: string): Suggestion | null {
  const { abs: code } = resolveProjectPath(projectId, "code");
  const pkgFile = path.join(code, "package.json");
  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8")) as { scripts?: Record<string, unknown> };
      if (typeof pkg.scripts?.dev === "string") return { command: "npm run dev", cwd: "code", url: null };
      if (typeof pkg.scripts?.start === "string") return { command: "npm start", cwd: "code", url: null };
    } catch {
      // Unreadable package.json: fall through to the other checks.
    }
  }
  if (fs.existsSync(path.join(code, "manage.py"))) return { command: "python3 manage.py runserver", cwd: "code", url: null };
  if (fs.existsSync(path.join(code, "index.html"))) {
    return { command: "python3 -m http.server 8000", cwd: "code", url: "http://localhost:8000" };
  }
  return null;
}

/** Most recent dev server session of the project, running or not. */
function currentSession(projectId: string): TerminalSession | undefined {
  return listTerminals(projectId)
    .filter((s) => s.kind === "devserver")
    .at(-1);
}

function defaultCwd(projectId: string, suggestion: Suggestion | null): string {
  if (suggestion) return suggestion.cwd;
  const { abs } = resolveProjectPath(projectId, "code");
  return fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? "code" : "";
}

export function devServerStatus(projectId: string): DevServerStatus {
  const row = readSettings(projectId);
  const suggestion = suggestDevCommand(projectId);
  const session = currentSession(projectId);
  const detected = session ? (session.detectedUrl ?? (session.running ? session.urlHint : null)) : null;
  return {
    command: row.dev_command,
    cwd: row.dev_cwd ?? defaultCwd(projectId, suggestion),
    configured_url: row.dev_url,
    detected_url: detected,
    url: row.dev_url ?? detected,
    running: !!session?.running,
    terminal_id: session?.id ?? null,
    suggested_command: suggestion?.command ?? null,
  };
}

export interface DevServerPatch {
  command?: unknown;
  cwd?: unknown;
  url?: unknown;
}

export function updateDevServerSettings(projectId: string, body: DevServerPatch): DevServerStatus {
  const row = readSettings(projectId);
  const next = { ...row };
  if (body.command !== undefined) {
    if (body.command !== null && typeof body.command !== "string") httpError(422, "'command' must be a string or null");
    const cmd = typeof body.command === "string" ? body.command.trim() : "";
    if (cmd.length > 4000) httpError(422, "'command' is too long");
    next.dev_command = cmd || null;
  }
  if (body.cwd !== undefined) {
    if (body.cwd !== null && typeof body.cwd !== "string") httpError(422, "'cwd' must be a string");
    next.dev_cwd = body.cwd === null ? null : resolveProjectPath(projectId, body.cwd as string).rel;
  }
  if (body.url !== undefined) {
    if (body.url !== null && typeof body.url !== "string") httpError(422, "'url' must be a string or null");
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        httpError(422, "'url' must be an http(s) URL");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") httpError(422, "'url' must be an http(s) URL");
    }
    next.dev_url = url || null;
  }
  run(
    `INSERT INTO project_workspace_settings (project_id, dev_command, dev_cwd, dev_url, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET dev_command = excluded.dev_command, dev_cwd = excluded.dev_cwd,
       dev_url = excluded.dev_url, updated_at = excluded.updated_at`,
    projectId,
    next.dev_command,
    next.dev_cwd,
    next.dev_url,
    nowIso(),
  );
  return devServerStatus(projectId);
}

export async function startDevServer(projectId: string): Promise<DevServerStatus> {
  const existing = currentSession(projectId);
  if (existing?.running) return devServerStatus(projectId);
  const row = readSettings(projectId);
  const suggestion = suggestDevCommand(projectId);
  const command = row.dev_command ?? suggestion?.command ?? null;
  if (!command) httpError(400, "No dev server command is configured and none could be suggested");
  const cwdRel = row.dev_cwd ?? defaultCwd(projectId, suggestion);
  const { abs, rel } = resolveProjectPath(projectId, cwdRel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) httpError(400, `Not a directory: ${cwdRel || "."}`);
  // Drop finished dev server sessions so only the latest one is kept.
  for (const s of listTerminals(projectId)) {
    if (s.kind === "devserver") {
      await removeTerminal(s);
    }
  }
  await spawnTerminal({
    projectId,
    kind: "devserver",
    title: "Dev server",
    cwd: rel,
    cwdAbs: abs,
    file: userShell(),
    args: ["-lc", command],
    urlHint: row.dev_command === null && suggestion ? suggestion.url : null,
  });
  return devServerStatus(projectId);
}

export async function stopDevServer(projectId: string): Promise<DevServerStatus> {
  const session = currentSession(projectId);
  if (session?.running) await killTerminal(session);
  return devServerStatus(projectId);
}
