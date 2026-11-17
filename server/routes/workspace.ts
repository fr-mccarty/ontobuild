import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { httpError, noContent, readJson } from "../http";
import { requireProject } from "../ontology";
import {
  deletePath,
  listFiles,
  mimeTypeFor,
  parseRange,
  readTextFile,
  resolveProjectPath,
  statFile,
  writeTextFile,
} from "../workspaceFiles";
import {
  getTerminal,
  listTerminals,
  removeTerminal,
  runCommandFor,
  spawnTerminal,
  terminalInfo,
  userShell,
  type TerminalListener,
  type TerminalSession,
} from "../terminals";
import { commitFolderChanges, getFolderChanges } from "../folderChanges";
import { devServerStatus, startDevServer, stopDevServer, updateDevServerSettings, type DevServerPatch } from "../devServer";

const r = new Hono();

function requirePathQuery(value: string | undefined): string {
  if (!value) httpError(422, "Query parameter 'path' is required");
  return value;
}

function terminalSize(v: unknown, name: string, def: number): number {
  if (v === undefined || v === null) return def;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1000) httpError(422, `'${name}' must be an integer from 1 to 1000`);
  return v;
}

function requireTerminal(projectId: string, tid: string): TerminalSession {
  const s = getTerminal(projectId, tid);
  if (!s) httpError(404, "Terminal not found");
  return s;
}

// ── Files ────────────────────────────────────────────────────────────────

r.get("/projects/:id/files", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  return c.json(listFiles(id));
});

r.get("/projects/:id/files/content", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  return c.json(readTextFile(id, requirePathQuery(c.req.query("path"))));
});

r.put("/projects/:id/files/content", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const body = await readJson<{ path?: unknown; content?: unknown }>(c);
  if (typeof body.path !== "string" || !body.path) httpError(422, "'path' must be a non-empty string");
  if (typeof body.content !== "string") httpError(422, "'content' must be a string");
  return c.json(writeTextFile(id, body.path, body.content));
});

r.delete("/projects/:id/files", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  deletePath(id, requirePathQuery(c.req.query("path")));
  return noContent(c);
});

r.get("/projects/:id/files/changes", async (c) => {
  return c.json(await getFolderChanges(c.req.param("id")));
});

r.post("/projects/:id/files/commit", async (c) => {
  const body = await readJson<{ commit_message?: unknown }>(c);
  return c.json(await commitFolderChanges(c.req.param("id"), body.commit_message));
});

r.get("/projects/:id/files/raw", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const file = statFile(id, requirePathQuery(c.req.query("path")));
  const headers: Record<string, string> = {
    "Content-Type": mimeTypeFor(file.path),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  const range = parseRange(c.req.header("range"), file.size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.size}` } });
  }
  const { start, end } = range ?? { start: 0, end: file.size - 1 };
  const length = file.size === 0 ? 0 : end - start + 1;
  headers["Content-Length"] = String(length);
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
  const body =
    length === 0 || c.req.method === "HEAD"
      ? null
      : (Readable.toWeb(fs.createReadStream(file.abs, { start, end })) as ReadableStream<Uint8Array>);
  return new Response(body, { status: range ? 206 : 200, headers });
});

// ── Terminals ────────────────────────────────────────────────────────────

r.get("/projects/:id/terminals", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  return c.json({ items: listTerminals(id).map(terminalInfo) });
});

r.post("/projects/:id/terminals", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const body = await readJson<{ kind?: unknown; cwd?: unknown; run?: unknown; cols?: unknown; rows?: unknown }>(c);
  if (body.kind !== undefined && body.kind !== "shell" && body.kind !== "run") httpError(422, "'kind' must be \"shell\" or \"run\"");
  if (body.cwd !== undefined && typeof body.cwd !== "string") httpError(422, "'cwd' must be a string");
  if (body.run !== undefined && typeof body.run !== "string") httpError(422, "'run' must be a string");
  const kind = body.kind ?? (body.run ? "run" : "shell");
  const cols = terminalSize(body.cols, "cols", 80);
  const rows = terminalSize(body.rows, "rows", 24);

  let session: TerminalSession;
  if (kind === "run") {
    if (!body.run) httpError(422, "'run' (a file path) is required for kind \"run\"");
    const target = resolveProjectPath(id, body.run);
    if (!target.rel || !fs.existsSync(target.abs) || !fs.statSync(target.abs).isFile()) httpError(404, `File not found: ${body.run}`);
    const name = path.basename(target.abs);
    const cmd = runCommandFor(name);
    if (!cmd) {
      const ext = path.extname(name);
      httpError(400, ext ? `Can't run ${ext} files` : "Can't run files without an extension");
    }
    const dirRel = path.posix.dirname(target.rel);
    session = await spawnTerminal({
      projectId: id,
      kind: "run",
      title: name,
      cwd: dirRel === "." ? "" : dirRel,
      cwdAbs: path.dirname(target.abs),
      file: cmd.file,
      args: cmd.args,
      cols,
      rows,
    });
  } else {
    const dir = resolveProjectPath(id, body.cwd ?? "");
    if (!fs.existsSync(dir.abs) || !fs.statSync(dir.abs).isDirectory()) httpError(400, `Not a directory: ${body.cwd}`);
    const shell = userShell();
    session = await spawnTerminal({
      projectId: id,
      kind: "shell",
      title: path.basename(shell),
      cwd: dir.rel,
      cwdAbs: dir.abs,
      file: shell,
      args: ["-l"],
      cols,
      rows,
    });
  }
  return c.json(terminalInfo(session), 201);
});

r.get("/projects/:id/terminals/:tid/stream", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const session = requireTerminal(id, c.req.param("tid"));
  return streamSSE(c, async (stream) => {
    // Snapshot the buffer and subscribe in the same tick so no output is lost or duplicated.
    const replay = session.buffer;
    const alreadyExited = !session.running;
    let chain: Promise<unknown> = Promise.resolve();
    const write = (event: string, data: unknown) => {
      chain = chain.then(() => (stream.aborted ? undefined : stream.writeSSE({ event, data: JSON.stringify(data) }))).catch(() => {});
      return chain;
    };
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const listener: TerminalListener = {
      data: (chunk) => void write("data", { data: chunk }),
      exit: (exitCode) => void write("exit", { exit_code: exitCode }).then(finish),
    };
    const detach = () => {
      session.listeners.delete(listener);
      finish();
    };
    if (!alreadyExited) session.listeners.add(listener);
    stream.onAbort(detach);
    c.req.raw.signal?.addEventListener("abort", detach, { once: true });

    await write("data", { data: replay });
    if (alreadyExited) await write("exit", { exit_code: session.exitCode });
    else await finished;
    session.listeners.delete(listener);
    c.req.raw.signal?.removeEventListener("abort", detach);
  });
});

r.post("/projects/:id/terminals/:tid/input", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const session = requireTerminal(id, c.req.param("tid"));
  const body = await readJson<{ data?: unknown }>(c);
  if (typeof body.data !== "string") httpError(422, "'data' must be a string");
  if (!session.running) httpError(409, "The terminal's process has exited");
  session.pty.write(body.data);
  return noContent(c);
});

r.post("/projects/:id/terminals/:tid/resize", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const session = requireTerminal(id, c.req.param("tid"));
  const body = await readJson<{ cols?: unknown; rows?: unknown }>(c);
  const cols = terminalSize(body.cols, "cols", 0);
  const rows = terminalSize(body.rows, "rows", 0);
  if (!cols || !rows) httpError(422, "'cols' and 'rows' are required");
  if (session.running) {
    try {
      session.pty.resize(cols, rows);
    } catch {
      // The process may have exited between the check and the resize.
    }
  }
  return noContent(c);
});

r.delete("/projects/:id/terminals/:tid", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const session = requireTerminal(id, c.req.param("tid"));
  // Removed from the registry immediately; the process is killed in the background.
  void removeTerminal(session);
  return noContent(c);
});

// ── Dev server ───────────────────────────────────────────────────────────

r.get("/projects/:id/dev-server", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  return c.json(devServerStatus(id));
});

r.put("/projects/:id/dev-server", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  return c.json(updateDevServerSettings(id, await readJson<DevServerPatch>(c)));
});

r.post("/projects/:id/dev-server/start", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  return c.json(await startDevServer(id));
});

r.post("/projects/:id/dev-server/stop", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  return c.json(await stopDevServer(id));
});

export default r;
