import crypto from "node:crypto";
import fs from "node:fs";
import type { IPty } from "node-pty";

/**
 * Pseudo-terminal sessions (node-pty) for the workspace: interactive shells, "run this file"
 * sessions and the project's dev server. Sessions live in memory on globalThis so they
 * survive Next dev module reloads. Each one belongs to a single project and keeps the last
 * ~200KB of output so a reconnecting client can replay it.
 */

export type TerminalKind = "shell" | "run" | "devserver";

export interface TerminalInfo {
  id: string;
  title: string;
  kind: TerminalKind;
  running: boolean;
  exit_code: number | null;
  cwd: string;
}

export interface TerminalListener {
  data(chunk: string): void;
  exit(exitCode: number | null): void;
}

export interface TerminalSession {
  id: string;
  projectId: string;
  title: string;
  kind: TerminalKind;
  /** Project-relative working directory. */
  cwd: string;
  pty: IPty;
  running: boolean;
  exitCode: number | null;
  buffer: string;
  listeners: Set<TerminalListener>;
  createdAt: number;
  /** First local http URL seen in the output (dev server sessions only). */
  detectedUrl: string | null;
  /** URL to report while running when none is detected (e.g. a suggested dev command's known port). */
  urlHint: string | null;
  scanTail: string;
  killTimer: ReturnType<typeof setTimeout> | null;
}

export const BUFFER_LIMIT = 200 * 1024;

type G = typeof globalThis & { __ontokitTerminals?: Map<string, TerminalSession> };

function registry(): Map<string, TerminalSession> {
  const g = globalThis as G;
  if (!g.__ontokitTerminals) g.__ontokitTerminals = new Map();
  return g.__ontokitTerminals;
}

/** Environment for child processes: the server's, minus anything that would confuse a nested Node/Next process. */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === "NODE_OPTIONS" || k === "NODE_ENV" || k === "PORT") continue;
    if (k.startsWith("NEXT_") || k.startsWith("__NEXT") || k.startsWith("TURBOPACK")) continue;
    env[k] = v;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

/** The user's shell: $SHELL, else /bin/zsh, else /bin/bash. */
export function userShell(): string {
  for (const s of [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"]) {
    if (s && fs.existsSync(s)) return s;
  }
  return "/bin/sh";
}

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
const URL_RE = /(https?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):(\d{2,5})/;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** First local http(s) URL in `text` (ANSI codes stripped); 0.0.0.0 and [::] are reported as localhost. */
export function findLocalUrl(text: string): string | null {
  const m = URL_RE.exec(stripAnsi(text));
  if (!m) return null;
  const host = m[2] === "0.0.0.0" || m[2] === "[::]" ? "localhost" : m[2];
  return `${m[1]}://${host}:${m[3]}`;
}

export interface SpawnOptions {
  projectId: string;
  kind: TerminalKind;
  title: string;
  /** Project-relative working directory (for display). */
  cwd: string;
  /** Absolute working directory. */
  cwdAbs: string;
  file: string;
  args: string[];
  cols?: number;
  rows?: number;
  urlHint?: string | null;
}

export async function spawnTerminal(opts: SpawnOptions): Promise<TerminalSession> {
  const nodePty = await import("node-pty");
  const pty = nodePty.spawn(opts.file, opts.args, {
    name: "xterm-256color",
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd: opts.cwdAbs,
    env: childEnv(),
  });
  const session: TerminalSession = {
    id: crypto.randomUUID(),
    projectId: opts.projectId,
    title: opts.title,
    kind: opts.kind,
    cwd: opts.cwd,
    pty,
    running: true,
    exitCode: null,
    buffer: "",
    listeners: new Set(),
    createdAt: Date.now(),
    detectedUrl: null,
    urlHint: opts.urlHint ?? null,
    scanTail: "",
    killTimer: null,
  };
  pty.onData((chunk) => {
    session.buffer += chunk;
    if (session.buffer.length > BUFFER_LIMIT) session.buffer = session.buffer.slice(session.buffer.length - BUFFER_LIMIT);
    if (session.kind === "devserver" && !session.detectedUrl) {
      const scan = session.scanTail + chunk;
      session.detectedUrl = findLocalUrl(scan);
      session.scanTail = scan.slice(-512);
    }
    for (const l of session.listeners) {
      try {
        l.data(chunk);
      } catch {
        // A broken listener must not stop the others.
      }
    }
  });
  pty.onExit(({ exitCode, signal }) => {
    session.running = false;
    session.exitCode = signal ? (exitCode || 128 + signal) : exitCode;
    if (session.killTimer) clearTimeout(session.killTimer);
    session.killTimer = null;
    for (const l of [...session.listeners]) {
      try {
        l.exit(session.exitCode);
      } catch {
        // ignore
      }
    }
    session.listeners.clear();
  });
  registry().set(session.id, session);
  return session;
}

export function terminalInfo(s: TerminalSession): TerminalInfo {
  return { id: s.id, title: s.title, kind: s.kind, running: s.running, exit_code: s.exitCode, cwd: s.cwd };
}

export function listTerminals(projectId: string): TerminalSession[] {
  return [...registry().values()].filter((s) => s.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt);
}

export function getTerminal(projectId: string, id: string): TerminalSession | undefined {
  const s = registry().get(id);
  return s && s.projectId === projectId ? s : undefined;
}

function signalGroup(s: TerminalSession, sig: NodeJS.Signals) {
  // The pty child is a session leader, so -pid signals everything it started (e.g. npm's children).
  try {
    process.kill(-s.pty.pid, sig);
    return;
  } catch {
    // fall through
  }
  try {
    s.pty.kill(sig);
  } catch {
    // already gone
  }
}

/** SIGHUP the session's process group, then SIGKILL after 2s if it is still running. Resolves when it exits (or after ~3s). */
export function killTerminal(s: TerminalSession): Promise<void> {
  if (!s.running) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(giveUp);
      resolve();
    };
    const giveUp = setTimeout(() => {
      s.listeners.delete(listener);
      resolve();
    }, 3000);
    const listener: TerminalListener = { data: () => {}, exit: done };
    s.listeners.add(listener);
    signalGroup(s, "SIGHUP");
    if (!s.killTimer) {
      s.killTimer = setTimeout(() => {
        s.killTimer = null;
        if (s.running) signalGroup(s, "SIGKILL");
      }, 2000);
      s.killTimer.unref?.();
    }
  });
}

/** Kill a session and drop it from the registry. */
export function removeTerminal(s: TerminalSession): Promise<void> {
  registry().delete(s.id);
  return killTerminal(s);
}

/** Kill and remove every session of a project (used when the project is deleted). */
export function killProjectTerminals(projectId: string): Promise<void> {
  return Promise.all(listTerminals(projectId).map((s) => removeTerminal(s))).then(() => undefined);
}

/** Kill and remove every session (tests, shutdown). */
export function killAllTerminals(): Promise<void> {
  return Promise.all([...registry().values()].map((s) => removeTerminal(s))).then(() => undefined);
}

/** How to run a file, by extension: [command, args]. Null when the extension isn't supported. */
export function runCommandFor(fileName: string): { file: string; args: string[] } | null {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  switch (ext) {
    case "sh":
    case "bash":
      return { file: "bash", args: [fileName] };
    case "py":
      return { file: "python3", args: [fileName] };
    case "ts":
    case "mts":
    case "js":
    case "mjs":
      return { file: process.execPath, args: [fileName] };
    default:
      return null;
  }
}
