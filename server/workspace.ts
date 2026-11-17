import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, PROJECTS_DIR, REPOS_DIR, all, get, getDb, run } from "./db";

/**
 * Project folders. Each project is a normal git repository with a working tree:
 *
 *   data/projects/<folder>/
 *     .git/
 *     ontology.ttl
 *     code/
 *
 * `folder` is a slug of the project name, chosen once when the project is created
 * (or migrated) and stored in `projects.folder`. Renaming a project keeps its folder.
 */
export { PROJECTS_DIR };
export const CODE_DIR = "code";

const FOLDER_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60)
    .replace(/[-._]+$/g, "");
  return slug || "project";
}

/** A folder name for a new project that no other project or directory uses. */
export function allocateFolder(name: string): string {
  ensureMigrated();
  return allocateFolderName(name);
}

function allocateFolderName(name: string): string {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const base = slugify(name);
  const taken = new Set(all<{ folder: string }>("SELECT folder FROM projects WHERE folder IS NOT NULL").map((r) => r.folder));
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!taken.has(candidate) && !fs.existsSync(path.join(PROJECTS_DIR, candidate))) return candidate;
  }
}

function folderToDir(folder: string): string {
  if (!FOLDER_RE.test(folder)) throw new Error(`Invalid project folder: ${folder}`);
  const dir = path.join(PROJECTS_DIR, folder);
  if (path.dirname(dir) !== PROJECTS_DIR) throw new Error(`Invalid project folder: ${folder}`);
  return dir;
}

/** Absolute path of a project's folder, or null when the project is unknown. */
export function projectDir(projectId: string): string | null {
  ensureMigrated();
  const row = get<{ folder: string | null }>("SELECT folder FROM projects WHERE id = ?", projectId);
  return row?.folder ? folderToDir(row.folder) : null;
}

export function removeProjectDir(dir: string): void {
  if (path.dirname(dir) !== PROJECTS_DIR) throw new Error(`Refusing to remove ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

function gitSync(gitDir: string, workTree: string | null, args: string[]): string {
  return execFileSync("git", args, {
    env: {
      ...process.env,
      GIT_DIR: gitDir,
      ...(workTree ? { GIT_WORK_TREE: workTree } : {}),
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const migrated = new WeakSet<object>();

/** Run the folder migration once per database (the first time a project folder is needed). */
export function ensureMigrated(): void {
  const db = getDb();
  if (migrated.has(db)) return;
  migrated.add(db);
  migrateProjectFolders();
}

/**
 * Give every project without a folder one. Projects created before project folders
 * existed have a bare repository at data/repos/<id>.git: it is moved to
 * data/projects/<folder>/.git, turned into a normal repository and checked out.
 * Projects that already have a folder are skipped.
 */
export function migrateProjectFolders(): void {
  const pending = all<{ id: string; name: string }>("SELECT id, name FROM projects WHERE folder IS NULL");
  for (const p of pending) {
    const folder = allocateFolderName(p.name);
    const dir = folderToDir(folder);
    const legacy = path.join(REPOS_DIR, `${p.id}.git`);
    try {
      fs.mkdirSync(path.join(dir, CODE_DIR), { recursive: true });
      const gitDir = path.join(dir, ".git");
      const hasLegacy = fs.existsSync(path.join(legacy, "HEAD"));
      if (hasLegacy) fs.renameSync(legacy, gitDir);
      // From here on the repository lives in the folder, so record it even if checkout fails.
      run("UPDATE projects SET folder = ? WHERE id = ?", folder, p.id);
      if (hasLegacy) {
        gitSync(gitDir, null, ["config", "core.bare", "false"]);
        let hasHead = true;
        try {
          gitSync(gitDir, null, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
        } catch {
          hasHead = false;
        }
        if (hasHead) gitSync(gitDir, dir, ["read-tree", "-u", "--reset", "HEAD"]);
      }
      console.info(`[ontokit] moved project ${p.id} to ${path.relative(DATA_DIR, dir)}`);
    } catch (e) {
      console.error(`[ontokit] failed to migrate project ${p.id} to a project folder:`, e);
    }
  }
}
