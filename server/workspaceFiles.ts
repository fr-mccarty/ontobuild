import fs from "node:fs";
import path from "node:path";
import { ApiError } from "./http";
import { workTreePath } from "./git";

/**
 * Safe access to files in a project folder (data/projects/<folder>/). Every path is
 * relative to the project folder, uses "/" separators, and must stay inside it.
 * The .git directory is never listed, read or written.
 */

export const IGNORED_DIRS = new Set([".git", "node_modules", ".next", "__pycache__", ".venv", "venv", "dist", "build", ".turbo"]);
export const MAX_LIST_ENTRIES = 5000;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export interface FileEntry {
  path: string;
  type: "file" | "dir";
  size: number;
}

/** Normalize a client path ("code/app.py", "/code/app.py", "") to a safe relative path. */
export function normalizeRelPath(rel: string | undefined | null): string {
  const raw = (rel ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  const norm = path.posix.normalize(raw || ".");
  if (norm === ".") return "";
  if (norm === ".." || norm.startsWith("../") || path.posix.isAbsolute(norm)) {
    throw new ApiError(400, `Path is outside the project folder: ${rel}`);
  }
  const first = norm.split("/")[0];
  if (first === ".git") throw new ApiError(403, "The .git directory can't be accessed");
  return norm.replace(/\/$/, "");
}

/** Absolute path for a project-relative path; symlinks may not escape the project folder. */
export function resolveProjectPath(projectId: string, rel: string | undefined | null): { root: string; rel: string; abs: string } {
  const root = workTreePath(projectId);
  const clean = normalizeRelPath(rel);
  const abs = path.join(root, clean);
  // Resolve symlinks of the deepest existing ancestor and check it is still inside the root.
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== root) probe = path.dirname(probe);
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(probe);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new ApiError(400, `Path is outside the project folder: ${rel}`);
  }
  return { root, rel: clean, abs };
}

/** All files and directories under `rel` (recursively), skipping IGNORED_DIRS. */
export function listFiles(projectId: string, rel = ""): { entries: FileEntry[]; truncated: boolean } {
  const { abs, rel: base } = resolveProjectPath(projectId, rel);
  if (!fs.existsSync(abs)) throw new ApiError(404, `Not found: ${rel}`);
  const entries: FileEntry[] = [];
  let truncated = false;
  const walk = (dirAbs: string, dirRel: string) => {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    items.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const it of items) {
      if (entries.length >= MAX_LIST_ENTRIES) {
        truncated = true;
        return;
      }
      const childRel = dirRel ? `${dirRel}/${it.name}` : it.name;
      const childAbs = path.join(dirAbs, it.name);
      if (it.isDirectory()) {
        if (IGNORED_DIRS.has(it.name)) continue;
        entries.push({ path: childRel, type: "dir", size: 0 });
        walk(childAbs, childRel);
      } else if (it.isFile() || it.isSymbolicLink()) {
        let size = 0;
        try {
          size = fs.statSync(childAbs).size;
        } catch {
          continue;
        }
        entries.push({ path: childRel, type: "file", size });
      }
    }
  };
  walk(abs, base);
  return { entries, truncated };
}

export function isProbablyBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function readTextFile(projectId: string, rel: string): { path: string; content: string; size: number } {
  const { abs, rel: clean } = resolveProjectPath(projectId, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new ApiError(404, `File not found: ${rel}`);
  const size = fs.statSync(abs).size;
  if (size > MAX_TEXT_BYTES) throw new ApiError(413, `File is too large to open as text (${size} bytes)`);
  const buf = fs.readFileSync(abs);
  if (isProbablyBinary(buf)) throw new ApiError(415, `File is binary: ${rel}`);
  return { path: clean, content: buf.toString("utf8"), size };
}

export function writeTextFile(projectId: string, rel: string, content: string): { path: string; size: number; created: boolean } {
  const { abs, rel: clean } = resolveProjectPath(projectId, rel);
  if (!clean) throw new ApiError(400, "A file path is required");
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) throw new ApiError(400, `Is a directory: ${rel}`);
  const created = !fs.existsSync(abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return { path: clean, size: Buffer.byteLength(content), created };
}

export function deletePath(projectId: string, rel: string): void {
  const { abs, rel: clean } = resolveProjectPath(projectId, rel);
  if (!clean) throw new ApiError(400, "Refusing to delete the project folder");
  if (!fs.existsSync(abs)) throw new ApiError(404, `Not found: ${rel}`);
  fs.rmSync(abs, { recursive: true, force: true });
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif",
  pdf: "application/pdf",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4", ogv: "video/ogg",
  csv: "text/csv", tsv: "text/tab-separated-values", txt: "text/plain", md: "text/markdown", json: "application/json",
  html: "text/plain", htm: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Content type used when serving a file's raw bytes. HTML and SVG are served so they can't run scripts. */
export function mimeTypeFor(rel: string): string {
  const ext = path.extname(rel).slice(1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

/** Absolute path and size of an existing regular file, for streaming its raw bytes. */
export function statFile(projectId: string, rel: string): { path: string; abs: string; size: number } {
  const { abs, rel: clean } = resolveProjectPath(projectId, rel);
  if (!clean || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new ApiError(404, `File not found: ${rel}`);
  return { path: clean, abs, size: fs.statSync(abs).size };
}

/**
 * Parses a single-range "Range: bytes=..." header against a file size.
 * Returns null to serve the whole file (no header, or a multi-range/unknown unit we don't support),
 * "unsatisfiable" for a range outside the file, or the inclusive byte range.
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (!a && !b) return "unsatisfiable";
  let start: number;
  let end: number;
  if (!a) {
    const suffix = Number(b);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b ? Math.min(Number(b), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
