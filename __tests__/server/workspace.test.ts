// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPizzaProject, removeDir, useTempDataDir, type AppLike } from "./agent/helpers";

let dataDir: string;
let app: AppLike;
let projectId: string;
let projectDir: string;

const api = (p: string) => `/api/v1/projects/${projectId}${p}`;
const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeAll(async () => {
  dataDir = useTempDataDir();
  app = (await import("@/server/app")).default;
  projectId = await createPizzaProject(app);
  const project = (await (await app.request(`/api/v1/projects/${projectId}`)).json()) as { folder: string };
  projectDir = path.join(dataDir, "projects", project.folder);
}, 30_000);

afterAll(async () => {
  const { killAllTerminals } = await import("@/server/terminals");
  await killAllTerminals();
  removeDir(dataDir);
}, 15_000);

async function writeFile(p: string, content: string) {
  const res = await app.request(api("/files/content"), jsonInit("PUT", { path: p, content }));
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as { path: string; size: number; created: boolean };
}

interface Terminal {
  id: string;
  title: string;
  kind: string;
  running: boolean;
  exit_code: number | null;
  cwd: string;
}

async function openTerminal(body: Record<string, unknown>): Promise<Terminal> {
  const res = await app.request(api("/terminals"), jsonInit("POST", body));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Terminal;
}

interface StreamResult {
  output: string;
  exitCode: number | null | undefined;
  events: { event: string; data: Record<string, unknown> }[];
}

/** Reads a terminal's SSE stream until `until(output)` is true, an exit event arrives, or the timeout passes. */
async function readStream(tid: string, until: (output: string) => boolean = () => false, timeoutMs = 15_000): Promise<StreamResult> {
  const res = await app.request(api(`/terminals/${tid}/stream`));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const result: StreamResult = { output: "", exitCode: undefined, events: [] };
  let pending = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const timer = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), Math.max(1, deadline - Date.now())));
      const chunk = await Promise.race([reader.read(), timer]);
      if (chunk === "timeout" || chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      let idx: number;
      while ((idx = pending.indexOf("\n\n")) >= 0) {
        const block = pending.slice(0, idx);
        pending = pending.slice(idx + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (!data.length) continue;
        const parsed = JSON.parse(data.join("\n")) as Record<string, unknown>;
        result.events.push({ event, data: parsed });
        if (event === "data") result.output += parsed.data as string;
        if (event === "exit") result.exitCode = parsed.exit_code as number | null;
      }
      if (result.exitCode !== undefined || until(result.output)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return result;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe("workspace files", () => {
  it("lists the project folder without .git", async () => {
    const res = await app.request(api("/files"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { path: string; type: string; size: number }[]; truncated: boolean };
    expect(body.truncated).toBe(false);
    const paths = body.entries.map((e) => e.path);
    expect(paths).toContain("ontology.ttl");
    expect(body.entries.find((e) => e.path === "code")?.type).toBe("dir");
    expect(paths.some((p) => p === ".git" || p.startsWith(".git/"))).toBe(false);
  });

  it("round-trips text content", async () => {
    const created = await writeFile("code/notes/readme.md", "# Hello\nwörld\n");
    expect(created).toEqual({ path: "code/notes/readme.md", size: Buffer.byteLength("# Hello\nwörld\n"), created: true });
    expect((await writeFile("code/notes/readme.md", "changed")).created).toBe(false);
    const res = await app.request(api("/files/content?path=code/notes/readme.md"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "code/notes/readme.md", content: "changed", size: 7 });
  });

  it("refuses binary files as text and deletes paths", async () => {
    fs.writeFileSync(path.join(projectDir, "code", "blob.bin"), Buffer.from([1, 0, 2, 0]));
    expect((await app.request(api("/files/content?path=code/blob.bin"))).status).toBe(415);
    const del = await app.request(api("/files?path=code/blob.bin"), { method: "DELETE" });
    expect(del.status).toBe(204);
    expect(fs.existsSync(path.join(projectDir, "code", "blob.bin"))).toBe(false);
    expect((await app.request(api("/files?path=code/blob.bin"), { method: "DELETE" })).status).toBe(404);
  });

  it("rejects paths outside the project folder", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ontobuild-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "TOP-SECRET-CONTENT");
    fs.symlinkSync(outside, path.join(projectDir, "code", "escape"));
    try {
      for (const p of ["../ontobuild.db", "code/../../ontobuild.db", "/etc/passwd", "../../../../../etc/passwd", "code/escape/secret.txt"]) {
        const res = await app.request(api(`/files/content?path=${encodeURIComponent(p)}`));
        expect([400, 404], p).toContain(res.status);
        expect(await res.text(), p).not.toContain("TOP-SECRET-CONTENT");
      }
      expect((await app.request(api("/files/content?path=code/escape/secret.txt"))).status).toBe(400);
      expect((await app.request(api("/files/raw?path=code/escape/secret.txt"))).status).toBe(400);
      expect((await app.request(api("/files/content?path=.git/config"))).status).toBe(403);
      expect((await app.request(api("/files/raw?path=.git/HEAD"))).status).toBe(403);
      const put = await app.request(api("/files/content"), jsonInit("PUT", { path: "../evil.txt", content: "x" }));
      expect(put.status).toBe(400);
      expect(fs.existsSync(path.join(projectDir, "..", "evil.txt"))).toBe(false);
      const putLink = await app.request(api("/files/content"), jsonInit("PUT", { path: "code/escape/new.txt", content: "x" }));
      expect(putLink.status).toBe(400);
      expect(fs.existsSync(path.join(outside, "new.txt"))).toBe(false);
      expect((await app.request(api("/files?path=.git"), { method: "DELETE" })).status).toBe(403);
      expect(fs.existsSync(path.join(projectDir, ".git"))).toBe(true);
    } finally {
      fs.unlinkSync(path.join(projectDir, "code", "escape"));
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("serves raw bytes with ranges, a content type and a sandbox CSP", async () => {
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
    fs.writeFileSync(path.join(projectDir, "code", "clip.mp3"), bytes);

    const full = await app.request(api("/files/raw?path=code/clip.mp3"));
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("audio/mpeg");
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");
    expect(full.headers.get("content-security-policy")).toBe("sandbox");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true);

    const part = await app.request(api("/files/raw?path=code/clip.mp3"), { headers: { Range: "bytes=100-199" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(part.headers.get("content-length")).toBe("100");
    expect(part.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await part.arrayBuffer()).equals(bytes.subarray(100, 200))).toBe(true);

    const tail = await app.request(api("/files/raw?path=code/clip.mp3"), { headers: { Range: "bytes=-10" } });
    expect(tail.status).toBe(206);
    expect(Buffer.from(await tail.arrayBuffer()).equals(bytes.subarray(990))).toBe(true);

    const open = await app.request(api("/files/raw?path=code/clip.mp3"), { headers: { Range: "bytes=900-" } });
    expect(open.headers.get("content-range")).toBe("bytes 900-999/1000");
    expect(Buffer.from(await open.arrayBuffer()).equals(bytes.subarray(900))).toBe(true);

    const bad = await app.request(api("/files/raw?path=code/clip.mp3"), { headers: { Range: "bytes=5000-" } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */1000");

    await writeFile("code/page.html", "<script>alert(1)</script>");
    const html = await app.request(api("/files/raw?path=code/page.html"));
    expect(html.headers.get("content-type")).not.toContain("text/html");
    expect(html.headers.get("content-security-policy")).toBe("sandbox");
  });
});

describe("terminals", () => {
  it("runs Python, shell and TypeScript files", async () => {
    await writeFile("code/hello.py", "import os\nprint('hello from python', os.path.basename(os.getcwd()))\n");
    await writeFile("code/hello.sh", "echo \"hello from bash $((40 + 2))\"\n");
    await writeFile("code/hello.ts", "const n: number = 6 * 7;\nconsole.log(`hello from ts ${n}`);\n");
    const cases: [string, string][] = [
      ["code/hello.py", "hello from python code"],
      ["code/hello.sh", "hello from bash 42"],
      ["code/hello.ts", "hello from ts 42"],
    ];
    for (const [file, expected] of cases) {
      const t = await openTerminal({ run: file });
      expect(t).toMatchObject({ kind: "run", title: path.basename(file), cwd: "code" });
      const result = await readStream(t.id);
      expect(result.output, file).toContain(expected);
      expect(result.exitCode, `${file}: ${result.output}`).toBe(0);
      expect(result.events[0].event).toBe("data");

      // The session is kept after it exits, and a new stream replays its output then ends.
      const list = (await (await app.request(api("/terminals"))).json()) as { items: Terminal[] };
      expect(list.items.find((i) => i.id === t.id)).toMatchObject({ running: false, exit_code: 0 });
      const replay = await readStream(t.id);
      expect(replay.output).toContain(expected);
      expect(replay.exitCode).toBe(0);
      expect((await app.request(api(`/terminals/${t.id}`), { method: "DELETE" })).status).toBe(204);
    }
  }, 60_000);

  it("reports a failing exit code", async () => {
    await writeFile("code/fail.sh", "echo failing\nexit 3\n");
    const t = await openTerminal({ kind: "run", run: "code/fail.sh" });
    const result = await readStream(t.id);
    expect(result.output).toContain("failing");
    expect(result.exitCode).toBe(3);
  }, 20_000);

  it("refuses unsupported files", async () => {
    await writeFile("code/data.xyz", "nothing");
    const res = await app.request(api("/terminals"), jsonInit("POST", { run: "code/data.xyz" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toBe("Can't run .xyz files");
    expect((await app.request(api("/terminals"), jsonInit("POST", { run: "code/missing.py" }))).status).toBe(404);
    expect((await app.request(api("/terminals"), jsonInit("POST", { run: "../x.py" }))).status).toBe(400);
  });

  it("runs an interactive shell that accepts input, and kills it on delete", async () => {
    const t = await openTerminal({ kind: "shell", cwd: "code", cols: 100, rows: 30 });
    expect(t).toMatchObject({ kind: "shell", running: true, exit_code: null, cwd: "code" });
    const streaming = readStream(t.id, (out) => out.includes("hi-42"), 20_000);
    const input = await app.request(api(`/terminals/${t.id}/input`), jsonInit("POST", { data: "echo hi-$((40+2))\n" }));
    expect(input.status).toBe(204);
    const resize = await app.request(api(`/terminals/${t.id}/resize`), jsonInit("POST", { cols: 120, rows: 40 }));
    expect(resize.status).toBe(204);
    const result = await streaming;
    expect(result.output).toContain("hi-42");

    const { getTerminal } = await import("@/server/terminals");
    const session = getTerminal(projectId, t.id)!;
    const pid = session.pty.pid;
    expect((await app.request(api(`/terminals/${t.id}`), { method: "DELETE" })).status).toBe(204);
    expect((await app.request(api(`/terminals/${t.id}/stream`))).status).toBe(404);
    const dead = await waitFor(async () => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    });
    expect(dead).toBe(true);
    expect(session.running).toBe(false);
  }, 30_000);

  it("404s for unknown terminals and other projects' terminals", async () => {
    expect((await app.request(api("/terminals/nope/stream"))).status).toBe(404);
    const other = await createPizzaProject(app);
    const t = await openTerminal({ run: "code/hello.sh" });
    expect((await app.request(`/api/v1/projects/${other}/terminals/${t.id}/stream`)).status).toBe(404);
    expect((await app.request(`/api/v1/projects/${other}/terminals`)).status).toBe(200);
    expect((await app.request(`/api/v1/projects/missing/terminals`)).status).toBe(404);
  });
});

describe("dev server", () => {
  it("suggests a command from code/", async () => {
    const res = await app.request(api("/dev-server"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ command: null, running: false, terminal_id: null, suggested_command: null, url: null });
    await writeFile("code/index.html", "<h1>hi</h1>");
    expect(await (await app.request(api("/dev-server"))).json()).toMatchObject({
      suggested_command: "python3 -m http.server 8000",
      cwd: "code",
    });
    await writeFile("code/package.json", JSON.stringify({ scripts: { start: "node server.js" } }));
    expect(await (await app.request(api("/dev-server"))).json()).toMatchObject({ suggested_command: "npm start" });
    await writeFile("code/package.json", JSON.stringify({ scripts: { dev: "vite", start: "node server.js" } }));
    expect(await (await app.request(api("/dev-server"))).json()).toMatchObject({ suggested_command: "npm run dev" });
  });

  it("starts a configured command, detects its URL, and stops it", async () => {
    const command = `node -e "console.log('Listening on http://0.0.0.0:4567'); setInterval(()=>{},1000)"`;
    const put = await app.request(api("/dev-server"), jsonInit("PUT", { command, cwd: "code" }));
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ command, cwd: "code", configured_url: null, running: false });

    const start = await app.request(api("/dev-server/start"), { method: "POST" });
    expect(start.status).toBe(200);
    const started = (await start.json()) as { running: boolean; terminal_id: string };
    expect(started.running).toBe(true);
    expect(started.terminal_id).toBeTruthy();

    const detected = await waitFor(async () => {
      const s = (await (await app.request(api("/dev-server"))).json()) as { detected_url: string | null };
      return s.detected_url === "http://localhost:4567";
    }, 20_000);
    expect(detected).toBe(true);
    const status = (await (await app.request(api("/dev-server"))).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ url: "http://localhost:4567", running: true, terminal_id: started.terminal_id });

    // Starting again returns the running server.
    const again = (await (await app.request(api("/dev-server/start"), { method: "POST" })).json()) as { terminal_id: string };
    expect(again.terminal_id).toBe(started.terminal_id);

    const list = (await (await app.request(api("/terminals"))).json()) as { items: Terminal[] };
    expect(list.items.find((i) => i.id === started.terminal_id)).toMatchObject({ kind: "devserver", title: "Dev server", cwd: "code" });

    // A configured URL wins over the detected one.
    const withUrl = await app.request(api("/dev-server"), jsonInit("PUT", { url: "http://localhost:9999/app" }));
    expect(await withUrl.json()).toMatchObject({ url: "http://localhost:9999/app", detected_url: "http://localhost:4567" });
    expect((await app.request(api("/dev-server"), jsonInit("PUT", { url: "ftp://x" }))).status).toBe(422);

    const stop = await app.request(api("/dev-server/stop"), { method: "POST" });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ running: false, terminal_id: started.terminal_id });
  }, 40_000);

  it("refuses to start without a command", async () => {
    fs.rmSync(path.join(projectDir, "code", "package.json"));
    fs.rmSync(path.join(projectDir, "code", "index.html"));
    await app.request(api("/dev-server"), jsonInit("PUT", { command: null }));
    expect((await app.request(api("/dev-server/start"), { method: "POST" })).status).toBe(400);
  });

  it("kills a project's terminals", async () => {
    const { killProjectTerminals, listTerminals } = await import("@/server/terminals");
    await openTerminal({ kind: "shell" });
    expect(listTerminals(projectId).length).toBeGreaterThan(0);
    await killProjectTerminals(projectId);
    expect(listTerminals(projectId)).toEqual([]);
  }, 15_000);
});
