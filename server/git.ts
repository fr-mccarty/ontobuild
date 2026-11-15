import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPOS_DIR } from "./db";
import { ApiError } from "./http";

export const DEFAULT_BRANCH = "main";
export const COMMITTER_NAME = "OntoKit";
export const COMMITTER_EMAIL = "noreply@ontokit.dev";

export interface CommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author_name: string;
  author_email: string;
  timestamp: string;
  is_merge: boolean;
  merged_branch: string | null;
  parent_hashes: string[];
}

export interface BranchInfo {
  name: string;
  is_current: boolean;
  is_default: boolean;
  commit_hash: string | null;
  commit_message: string | null;
  commit_date: string | null;
  commits_ahead: number;
  commits_behind: number;
}

export interface FileChange {
  path: string;
  change_type: string;
  old_path: string | null;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface DiffInfo {
  from_version: string;
  to_version: string;
  files_changed: number;
  changes: FileChange[];
  total_additions: number;
  total_deletions: number;
}

export interface MergeResult {
  success: boolean;
  message: string;
  merge_commit_hash: string | null;
  conflicts: string[];
}

export interface Author {
  name?: string | null;
  email?: string | null;
}

export class GitError extends Error {
  constructor(
    message: string,
    public stderr: string,
    public code: number | null,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export function repoPath(projectId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new ApiError(400, "Invalid project id");
  return path.join(REPOS_DIR, `${projectId}.git`);
}

export function repoExists(projectId: string): boolean {
  return fs.existsSync(path.join(repoPath(projectId), "HEAD"));
}

interface RunOpts {
  input?: string | Buffer;
  env?: Record<string, string>;
  okCodes?: number[];
}

export function git(projectId: string, args: string[], opts: RunOpts = {}): Promise<string> {
  return gitRaw(repoPath(projectId), args, opts).then((r) => r.stdout);
}

function gitRaw(
  gitDir: string,
  args: string[],
  opts: RunOpts = {},
): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        env: {
          ...process.env,
          GIT_DIR: gitDir,
          GIT_TERMINAL_PROMPT: "0",
          LC_ALL: "C",
          ...opts.env,
        },
        maxBuffer: 512 * 1024 * 1024,
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = typeof err.code === "number" ? err.code : null;
          if (code !== null && opts.okCodes?.includes(code)) return resolve({ stdout, code });
          return reject(
            new GitError(`git ${args[0]} failed: ${(stderr || err.message).trim()}`, stderr, code),
          );
        }
        resolve({ stdout, code: 0 });
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

const g = globalThis as typeof globalThis & { __ontokitGitLocks?: Map<string, Promise<unknown>> };
const locks = (g.__ontokitGitLocks ??= new Map());

export async function withRepoLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(projectId, next);
  try {
    return await next;
  } finally {
    if (locks.get(projectId) === next) locks.delete(projectId);
  }
}

export async function initRepo(projectId: string): Promise<void> {
  const dir = repoPath(projectId);
  if (repoExists(projectId)) return;
  fs.mkdirSync(dir, { recursive: true });
  await gitRaw(dir, ["init", "--bare", "--quiet", `--initial-branch=${DEFAULT_BRANCH}`, dir]);
}

export async function deleteRepo(projectId: string): Promise<void> {
  fs.rmSync(repoPath(projectId), { recursive: true, force: true });
}

export async function branchExists(projectId: string, name: string): Promise<boolean> {
  return (await resolveRefOrNull(projectId, `refs/heads/${name}`)) !== null;
}

async function resolveRefOrNull(projectId: string, ref: string): Promise<string | null> {
  try {
    const out = await git(projectId, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return out.trim() || null;
  } catch {
    return null;
  }
}

export async function resolveRef(projectId: string, ref: string): Promise<string> {
  if (ref === "HEAD") {
    const head = await resolveRefOrNull(projectId, "HEAD");
    if (head) return head;
    const def = await getDefaultBranch(projectId);
    const sha = await resolveRefOrNull(projectId, `refs/heads/${def}`);
    if (sha) return sha;
    throw new GitError(`Cannot resolve reference: ${ref}`, "", null);
  }
  if (!ref.startsWith("-")) {
    const branch = await resolveRefOrNull(projectId, `refs/heads/${ref}`);
    if (branch) return branch;
    const other = await resolveRefOrNull(projectId, ref);
    if (other) return other;
  }
  throw new GitError(`Cannot resolve reference: ${ref}`, "", null);
}

export async function getDefaultBranch(projectId: string): Promise<string> {
  const names = await listBranchNames(projectId);
  if (names.includes("main")) return "main";
  if (names.includes("master")) return "master";
  return names[0] ?? DEFAULT_BRANCH;
}

export async function getCurrentBranch(projectId: string): Promise<string> {
  try {
    const out = (await git(projectId, ["symbolic-ref", "--quiet", "HEAD"])).trim();
    const name = out.replace(/^refs\/heads\//, "");
    if (name && (await resolveRefOrNull(projectId, `refs/heads/${name}`))) return name;
  } catch {
  }
  return getDefaultBranch(projectId);
}

export async function listBranchNames(projectId: string): Promise<string[]> {
  const out = await git(projectId, ["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"]);
  return out.split("\n").filter(Boolean);
}

export async function isValidBranchName(name: string): Promise<boolean> {
  if (!name || name.startsWith("-")) return false;
  try {
    await gitRaw(os.tmpdir(), ["check-ref-format", "--branch", name]);
    return true;
  } catch {
    return false;
  }
}

export async function aheadBehind(projectId: string, a: string, b: string): Promise<[number, number]> {
  const out = await git(projectId, ["rev-list", "--left-right", "--count", `${a}...${b}`]);
  const [ahead, behind] = out.trim().split(/\s+/).map(Number);
  return [ahead || 0, behind || 0];
}

export async function mergeBase(projectId: string, a: string, b: string): Promise<string | null> {
  const out = await git(projectId, ["merge-base", a, b], { okCodes: [1] });
  return out.trim() || null;
}

export async function listBranches(projectId: string): Promise<BranchInfo[]> {
  const def = await getDefaultBranch(projectId);
  const current = await getCurrentBranch(projectId);
  const out = await git(projectId, [
    "for-each-ref",
    "--format=%(refname:strip=2)%1f%(objectname)%1f%(committerdate:unix)%1f%(contents:subject)",
    "refs/heads",
  ]);
  const result: BranchInfo[] = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [name, sha, ts, subject] = line.split("\x1f");
    let ahead = 0;
    let behind = 0;
    if (name !== def) {
      try {
        [ahead, behind] = await aheadBehind(projectId, `refs/heads/${name}`, `refs/heads/${def}`);
      } catch {
      }
    }
    result.push({
      name,
      is_current: name === current,
      is_default: name === def,
      commit_hash: sha,
      commit_message: subject ?? "",
      commit_date: new Date(Number(ts) * 1000).toISOString(),
      commits_ahead: ahead,
      commits_behind: behind,
    });
  }
  return result;
}

export async function getBranch(projectId: string, name: string): Promise<BranchInfo | null> {
  return (await listBranches(projectId)).find((b) => b.name === name) ?? null;
}

export async function createBranch(projectId: string, name: string, fromRef = "HEAD"): Promise<BranchInfo> {
  if (!(await isValidBranchName(name))) throw new GitError(`Invalid branch name: ${name}`, "", null);
  return withRepoLock(projectId, async () => {
    if (await resolveRefOrNull(projectId, `refs/heads/${name}`))
      throw new GitError(`Branch already exists: ${name}`, "", null);
    const sha = await resolveRef(projectId, fromRef);
    await git(projectId, ["update-ref", `refs/heads/${name}`, sha, ""]);
    const info = await getCommit(projectId, sha);
    return {
      name,
      is_current: false,
      is_default: false,
      commit_hash: sha,
      commit_message: info.message.split("\n")[0],
      commit_date: info.timestamp,
      commits_ahead: 0,
      commits_behind: 0,
    };
  });
}

export async function deleteBranch(projectId: string, name: string, force = false): Promise<void> {
  return withRepoLock(projectId, async () => {
    const def = await getDefaultBranch(projectId);
    if (name === def) throw new Error("Cannot delete the default branch");
    if (!(await resolveRefOrNull(projectId, `refs/heads/${name}`)))
      throw new Error(`Branch not found: ${name}`);
    if (!force) {
      const [ahead] = await aheadBehind(projectId, `refs/heads/${name}`, `refs/heads/${def}`);
      if (ahead > 0)
        throw new Error(`Branch '${name}' has ${ahead} unmerged commits. Use force=True to delete.`);
    }
    try {
      const head = (await git(projectId, ["symbolic-ref", "--quiet", "HEAD"])).trim();
      if (head === `refs/heads/${name}`)
        await git(projectId, ["symbolic-ref", "HEAD", `refs/heads/${def}`]);
    } catch {
    }
    await git(projectId, ["update-ref", "-d", `refs/heads/${name}`]);
  });
}

export async function readFile(projectId: string, ref: string, filePath: string): Promise<string> {
  const sha = await resolveRef(projectId, ref);
  return git(projectId, ["cat-file", "blob", `${sha}:${filePath}`]);
}

export async function readFileOrNull(projectId: string, ref: string, filePath: string): Promise<string | null> {
  try {
    return await readFile(projectId, ref, filePath);
  } catch {
    return null;
  }
}

export async function listFiles(projectId: string, ref = "HEAD"): Promise<string[]> {
  const sha = await resolveRef(projectId, ref);
  const out = await git(projectId, ["ls-tree", "-r", "--name-only", "-z", sha]);
  return out.split("\0").filter(Boolean);
}

const LOG_FORMAT = "%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%B%x1e";

function parseLog(out: string): CommitInfo[] {
  return out
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.trim())
    .map((rec) => {
      const [hash, parents, an, ae, ct, body] = rec.split("\x1f");
      const parent_hashes = parents ? parents.split(" ").filter(Boolean) : [];
      const message = (body ?? "").trim();
      const is_merge = parent_hashes.length > 1;
      const m = is_merge ? message.match(/Merge branch '([^']+)'/) : null;
      return {
        hash,
        short_hash: hash.slice(0, 8),
        message,
        author_name: an,
        author_email: ae,
        timestamp: new Date(Number(ct) * 1000).toISOString(),
        is_merge,
        merged_branch: m ? m[1] : null,
        parent_hashes,
      };
    });
}

export async function getCommit(projectId: string, ref: string): Promise<CommitInfo> {
  const sha = await resolveRef(projectId, ref);
  const out = await git(projectId, ["log", "-1", `--format=${LOG_FORMAT}`, sha]);
  return parseLog(out)[0];
}

export async function getHistory(
  projectId: string,
  opts: { branch?: string; limit?: number; skip?: number; allBranches?: boolean; path?: string } = {},
): Promise<CommitInfo[]> {
  const { branch, limit = 50, skip = 0 } = opts;
  const allBranches = opts.allBranches ?? !branch;
  const args = ["log", "--date-order", `--format=${LOG_FORMAT}`, `--max-count=${limit}`, `--skip=${skip}`];
  try {
    if (allBranches) args.push("--branches");
    else args.push(await resolveRef(projectId, branch ?? "HEAD"));
  } catch {
    return [];
  }
  if (opts.path) args.push("--", opts.path);
  try {
    return parseLog(await git(projectId, args));
  } catch {
    return [];
  }
}

export async function countCommits(projectId: string, ref?: string): Promise<number> {
  try {
    const out = await git(projectId, ["rev-list", "--count", ref ? await resolveRef(projectId, ref) : "--branches"]);
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

export async function getCommitsBetween(projectId: string, fromRef: string, toRef = "HEAD"): Promise<CommitInfo[]> {
  try {
    const from = await resolveRef(projectId, fromRef);
    const to = await resolveRef(projectId, toRef);
    return parseLog(await git(projectId, ["log", "--date-order", `--format=${LOG_FORMAT}`, `${from}..${to}`]));
  } catch {
    return [];
  }
}

export async function diff(projectId: string, fromVersion: string, toVersion = "HEAD"): Promise<DiffInfo> {
  const from = await resolveRef(projectId, fromVersion);
  const to = await resolveRef(projectId, toVersion);
  const nameStatus = await git(projectId, ["diff", "-M", "--name-status", "-z", from, to]);
  const numstat = await git(projectId, ["diff", "-M", "--numstat", "-z", from, to]);
  const patchOut = await git(projectId, ["diff", "-M", from, to]);

  const ns = nameStatus.split("\0").filter((s) => s !== "");
  const entries: { status: string; path: string; oldPath: string | null }[] = [];
  for (let i = 0; i < ns.length; ) {
    const st = ns[i++];
    if (st.startsWith("R") || st.startsWith("C")) {
      const oldPath = ns[i++];
      const newPath = ns[i++];
      entries.push({ status: st[0], path: newPath, oldPath });
    } else {
      entries.push({ status: st[0], path: ns[i++], oldPath: null });
    }
  }

  const stats = new Map<string, { add: number; del: number }>();
  const nsParts = numstat.split("\0");
  for (let i = 0; i < nsParts.length; i++) {
    const part = nsParts[i];
    if (!part) continue;
    const [a, d, p] = part.split("\t");
    let file = p;
    if (p === "") {
      i++;
      file = nsParts[++i];
    }
    stats.set(file, { add: Number(a) || 0, del: Number(d) || 0 });
  }

  const patches = new Map<string, string>();
  const chunks = patchOut.split(/^(?=diff --git )/m).filter((s) => s.startsWith("diff --git "));
  entries.forEach((e, idx) => {
    if (chunks[idx]) patches.set(e.path, chunks[idx]);
  });

  const changes: FileChange[] = entries.map((e) => {
    const st = stats.get(e.path) ?? { add: 0, del: 0 };
    return {
      path: e.path,
      change_type: e.status,
      old_path: e.status === "R" ? e.oldPath : null,
      additions: st.add,
      deletions: st.del,
      patch: patches.get(e.path) ?? null,
    };
  });
  return {
    from_version: fromVersion,
    to_version: toVersion,
    files_changed: changes.length,
    changes,
    total_additions: changes.reduce((s, c) => s + c.additions, 0),
    total_deletions: changes.reduce((s, c) => s + c.deletions, 0),
  };
}

function authorEnv(author?: Author): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: author?.name || COMMITTER_NAME,
    GIT_AUTHOR_EMAIL: author?.email || COMMITTER_EMAIL,
    GIT_COMMITTER_NAME: author?.name || COMMITTER_NAME,
    GIT_COMMITTER_EMAIL: author?.email || COMMITTER_EMAIL,
  };
}

async function withTempIndex<T>(fn: (env: Record<string, string>) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ontokit-idx-"));
  try {
    return await fn({ GIT_INDEX_FILE: path.join(dir, "index") });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface FileWrite {
  path: string;
  content: string | Buffer | null;
}

export async function commitFiles(
  projectId: string,
  opts: { branch: string; files: FileWrite[]; message: string; author?: Author },
): Promise<CommitInfo> {
  await initRepo(projectId);
  return withRepoLock(projectId, async () => {
    const ref = `refs/heads/${opts.branch}`;
    const parent = await resolveRefOrNull(projectId, ref);
    const sha = await withTempIndex(async (idxEnv) => {
      if (parent) await git(projectId, ["read-tree", parent], { env: idxEnv });
      for (const f of opts.files) {
        if (f.content === null) {
          await git(projectId, ["update-index", "--force-remove", "--", f.path], { env: idxEnv });
        } else {
          const blob = (await git(projectId, ["hash-object", "-w", "--stdin"], { input: f.content })).trim();
          await git(projectId, ["update-index", "--add", "--cacheinfo", `100644,${blob},${f.path}`], {
            env: idxEnv,
          });
        }
      }
      const tree = (await git(projectId, ["write-tree"], { env: idxEnv })).trim();
      const args = ["commit-tree", tree, "-F", "-"];
      if (parent) args.push("-p", parent);
      const commit = (
        await git(projectId, args, { input: opts.message, env: authorEnv(opts.author) })
      ).trim();
      await git(projectId, ["update-ref", ref, commit, parent ?? ""]);
      return commit;
    });
    return getCommit(projectId, sha);
  });
}

export function commitFile(
  projectId: string,
  opts: { branch: string; path: string; content: string | Buffer; message: string; author?: Author },
): Promise<CommitInfo> {
  return commitFiles(projectId, {
    branch: opts.branch,
    files: [{ path: opts.path, content: opts.content }],
    message: opts.message,
    author: opts.author,
  });
}

export async function mergeBranch(
  projectId: string,
  source: string,
  target: string,
  opts: { message?: string; author?: Author } = {},
): Promise<MergeResult> {
  return withRepoLock(projectId, async () => {
    const src = await resolveRefOrNull(projectId, `refs/heads/${source}`);
    const tgt = await resolveRefOrNull(projectId, `refs/heads/${target}`);
    if (!src) throw new Error(`Source branch not found: ${source}`);
    if (!tgt) throw new Error(`Target branch not found: ${target}`);
    const base = await mergeBase(projectId, tgt, src);
    if (base === src) {
      return { success: true, message: "Already up to date", merge_commit_hash: tgt, conflicts: [] };
    }
    const { stdout, code } = await gitRaw(
      repoPath(projectId),
      ["merge-tree", "--write-tree", "--name-only", "--no-messages", tgt, src],
      { okCodes: [1] },
    );
    const lines = stdout.split("\n").filter(Boolean);
    if (code === 1) {
      return {
        success: false,
        message: "Merge failed due to conflicts",
        merge_commit_hash: null,
        conflicts: [...new Set(lines.slice(1))],
      };
    }
    const tree = lines[0].trim();
    const msg = opts.message || `Merge branch '${source}' into ${target}`;
    const commit = (
      await git(projectId, ["commit-tree", tree, "-p", tgt, "-p", src, "-F", "-"], {
        input: msg,
        env: authorEnv(opts.author),
      })
    ).trim();
    await git(projectId, ["update-ref", `refs/heads/${target}`, commit, tgt]);
    return { success: true, message: "Merge successful", merge_commit_hash: commit, conflicts: [] };
  });
}
