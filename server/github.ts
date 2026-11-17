/**
 * Linking a project's repository to a remote (usually GitHub): the "origin" remote,
 * fetch, push and fast-forward pull.
 *
 * Authentication is whatever the user already has set up for git: a credential helper,
 * an SSH agent or `gh auth login`. OntoBuilder never stores tokens. Git runs with terminal
 * prompts disabled so a missing credential fails fast instead of hanging the server.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ApiError, httpError } from "./http";
import * as git from "./git";
import { emitOntologyEvent, invalidateOntologyCache } from "./ontology";

export const REMOTE = "origin";
const TIMEOUT_MS = 60_000;

export interface RemoteInfo {
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

export interface ParsedRemote {
  url: string;
  host: string;
  is_github: boolean;
  web_url: string | null;
}

function fileRemotesAllowed(): boolean {
  return process.env.NODE_ENV === "test" || process.env.ONTOBUILDER_ALLOW_FILE_REMOTES === "1";
}

/**
 * Checks a remote URL and works out its host and web page. Accepts GitHub over HTTPS or
 * SSH, and other HTTPS (or ssh://) git hosts. Rejects URLs with embedded credentials.
 */
export function parseRemoteUrl(raw: unknown): ParsedRemote {
  if (typeof raw !== "string" || !raw.trim()) httpError(400, "Field 'remote_url' is required");
  const url = raw.trim();
  if (/\s/.test(url) || url.startsWith("-")) httpError(400, "The remote URL must not contain spaces");

  // git@github.com:owner/repo(.git)
  const scp = url.match(/^([A-Za-z0-9._-]+)@([A-Za-z0-9][A-Za-z0-9.-]*):([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(\.git)?\/?$/);
  if (scp) {
    const host = scp[2].toLowerCase();
    return {
      url,
      host,
      is_github: host === "github.com",
      web_url: `https://${host}/${scp[3]}/${scp[4]}`,
    };
  }

  if (url.startsWith("file://")) {
    if (!fileRemotesAllowed()) httpError(400, "file:// remotes are not supported. Use an https:// or git@ URL.");
    return { url, host: "local", is_github: false, web_url: null };
  }

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    httpError(
      400,
      "Not a git remote URL. Use https://github.com/owner/repo.git or git@github.com:owner/repo.git",
    );
  }
  if (u.protocol !== "https:" && u.protocol !== "ssh:") {
    httpError(400, "Only https:// and SSH (git@host:owner/repo.git) remote URLs are supported");
  }
  if (u.password || (u.protocol === "https:" && u.username)) {
    httpError(
      400,
      "Don't put credentials in the remote URL. Sign in with `gh auth login` or a git credential helper instead.",
    );
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length < 2) httpError(400, "The remote URL must name a repository, like https://github.com/owner/repo");
  const isGithub = host === "github.com";
  if (isGithub && parts.length !== 2) httpError(400, "A GitHub URL must look like https://github.com/owner/repo");
  if (!parts.every((p) => /^[A-Za-z0-9._~-]+$/.test(p))) httpError(400, "The remote URL has an invalid repository path");
  const repoPath = parts.join("/").replace(/\.git$/, "");
  return {
    url,
    host,
    is_github: isGithub,
    web_url: `https://${host}${u.port && u.protocol === "https:" ? `:${u.port}` : ""}/${repoPath}`,
  };
}

/** Like parseRemoteUrl, but never throws: used to describe whatever origin is already configured. */
function describeRemote(url: string | null): Pick<RemoteInfo, "web_url" | "host" | "is_github"> {
  if (!url) return { web_url: null, host: null, is_github: false };
  try {
    const p = parseRemoteUrl(url);
    return { web_url: p.web_url, host: p.host, is_github: p.is_github };
  } catch {
    return { web_url: null, host: null, is_github: false };
  }
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function sshCommand(): Record<string, string> {
  // BatchMode makes ssh fail instead of asking for a passphrase or password.
  return process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" };
}

/** Runs git (or gh) with a timeout, collecting stdout and stderr; never rejects on a non-zero exit. */
function run(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string | undefined>; cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "never",
          LC_ALL: "C",
          ...sshCommand(),
          ...opts.env,
        },
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
          if (e.code === "ENOENT") return reject(e);
          if (e.killed) {
            return reject(new ApiError(504, `${cmd} ${args[0]} timed out after ${timeoutMs / 1000} seconds`));
          }
          return resolve({ stdout, stderr, code: typeof e.code === "number" ? e.code : 1 });
        }
        resolve({ stdout, stderr, code: 0 });
      },
    );
    child.stdin?.end();
  });
}

function gitEnv(projectId: string): Record<string, string> {
  return {
    GIT_DIR: git.repoPath(projectId),
    GIT_WORK_TREE: git.workTreePath(projectId),
    GIT_COMMITTER_NAME: git.COMMITTER_NAME,
    GIT_COMMITTER_EMAIL: git.COMMITTER_EMAIL,
  };
}

function runGit(projectId: string, args: string[]): Promise<RunResult> {
  return run("git", args, { env: gitEnv(projectId), cwd: git.workTreePath(projectId) });
}

const AUTH_PATTERNS = [
  /authentication failed/i,
  /could not read (username|password)/i,
  /terminal prompts disabled/i,
  /permission denied \(publickey/i,
  /host key verification failed/i,
  /invalid username or password/i,
  /\b403\b/,
  /repository not found/i,
];

/** Turns a failed remote command into an ApiError with advice on signing in when it looks like an auth problem. */
function remoteFailure(action: string, res: RunResult): never {
  const output = (res.stderr || res.stdout).trim();
  if (AUTH_PATTERNS.some((p) => p.test(output))) {
    httpError(
      403,
      `Couldn't ${action}: git could not sign in to the remote, or the repository doesn't exist. ` +
        "For HTTPS remotes run `gh auth login` (and `gh auth setup-git`) or set up a git credential helper; " +
        "for SSH remotes make sure your SSH key is loaded (`ssh-add`) and added to your GitHub account. " +
        `Git said: ${output.split("\n").slice(-3).join(" ")}`,
    );
  }
  httpError(400, `Couldn't ${action}: ${output || `git exited with code ${res.code}`}`);
}

function outputOf(res: RunResult): string {
  return [res.stdout, res.stderr].map((s) => s.trim()).filter(Boolean).join("\n");
}

export async function getRemoteUrl(projectId: string): Promise<string | null> {
  const res = await runGit(projectId, ["config", "--get", `remote.${REMOTE}.url`]);
  return res.code === 0 ? res.stdout.trim() || null : null;
}

async function upstreamOf(projectId: string, branch: string): Promise<string | null> {
  const res = await runGit(projectId, ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${branch}`]);
  if (res.code !== 0) return null;
  return res.stdout.trim() || null;
}

async function refExists(projectId: string, ref: string): Promise<boolean> {
  const res = await runGit(projectId, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return res.code === 0;
}

interface GhStatus {
  available: boolean;
  authenticated: boolean;
  at: number;
}
const gs = globalThis as typeof globalThis & { __ontobuilderGhStatus?: GhStatus };

function ghBin(): string {
  return process.env.ONTOBUILDER_GH_BIN || "gh";
}

/** Whether the GitHub CLI is installed and signed in (cached for a minute). */
export async function ghStatus(force = false): Promise<{ available: boolean; authenticated: boolean }> {
  const cached = gs.__ontobuilderGhStatus;
  if (!force && cached && Date.now() - cached.at < 60_000) return cached;
  let status: GhStatus;
  try {
    const version = await run(ghBin(), ["--version"]);
    if (version.code !== 0) status = { available: false, authenticated: false, at: Date.now() };
    else {
      const auth = await run(ghBin(), ["auth", "status", "--hostname", "github.com"]);
      status = { available: true, authenticated: auth.code === 0, at: Date.now() };
    }
  } catch {
    status = { available: false, authenticated: false, at: Date.now() };
  }
  gs.__ontobuilderGhStatus = status;
  return status;
}

export async function remoteInfo(projectId: string): Promise<RemoteInfo> {
  await git.initRepo(projectId);
  const remote_url = await getRemoteUrl(projectId);
  const branch = (await git.checkedOutBranch(projectId)) ?? (await git.getCurrentBranch(projectId));
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  if (remote_url) {
    upstream = await upstreamOf(projectId, branch);
    const tracking = upstream ?? `${REMOTE}/${branch}`;
    if ((await refExists(projectId, `refs/heads/${branch}`)) && (await refExists(projectId, `refs/remotes/${tracking}`))) {
      try {
        [ahead, behind] = await git.aheadBehind(projectId, `refs/heads/${branch}`, `refs/remotes/${tracking}`);
      } catch {
      }
    }
  }
  let last_fetched_at: string | null = null;
  try {
    last_fetched_at = fs.statSync(path.join(git.repoPath(projectId), "FETCH_HEAD")).mtime.toISOString();
  } catch {
  }
  const gh = await ghStatus();
  return {
    remote_url,
    ...describeRemote(remote_url),
    branch,
    upstream,
    ahead,
    behind,
    last_fetched_at,
    gh_available: gh.available,
    gh_authenticated: gh.authenticated,
  };
}

export async function setRemote(projectId: string, rawUrl: unknown): Promise<RemoteInfo> {
  const parsed = parseRemoteUrl(rawUrl);
  await git.initRepo(projectId);
  await git.withRepoLock(projectId, async () => {
    const existing = await getRemoteUrl(projectId);
    const res = existing
      ? await runGit(projectId, ["remote", "set-url", REMOTE, parsed.url])
      : await runGit(projectId, ["remote", "add", REMOTE, parsed.url]);
    if (res.code !== 0) httpError(400, `Couldn't set the remote: ${outputOf(res)}`);
  });
  return remoteInfo(projectId);
}

export async function removeRemote(projectId: string): Promise<void> {
  await git.withRepoLock(projectId, async () => {
    if (!(await getRemoteUrl(projectId))) httpError(404, "The project is not linked to a remote");
    const res = await runGit(projectId, ["remote", "remove", REMOTE]);
    if (res.code !== 0) httpError(400, `Couldn't unlink the remote: ${outputOf(res)}`);
  });
}

async function requireRemote(projectId: string): Promise<string> {
  const url = await getRemoteUrl(projectId);
  if (!url) httpError(409, "The project is not linked to a remote yet. Add a remote URL first.");
  return url;
}

async function fetchLocked(projectId: string): Promise<string> {
  const res = await runGit(projectId, ["fetch", "--prune", REMOTE]);
  if (res.code !== 0) remoteFailure("fetch from the remote", res);
  return outputOf(res);
}

export async function fetchRemote(projectId: string): Promise<{ output: string }> {
  await requireRemote(projectId);
  const output = await git.withRepoLock(projectId, () => fetchLocked(projectId));
  return { output: output || "Already up to date with the remote." };
}

export async function pushRemote(projectId: string, opts: { all?: boolean } = {}): Promise<{ output: string }> {
  await requireRemote(projectId);
  const output = await git.withRepoLock(projectId, async () => {
    let args: string[];
    if (opts.all) {
      args = ["push", "--porcelain", "--set-upstream", REMOTE, "--all"];
    } else {
      const branch = await git.checkedOutBranch(projectId);
      if (!branch) httpError(409, "No branch is checked out in the project folder");
      if (!(await refExists(projectId, `refs/heads/${branch}`))) httpError(409, `Branch '${branch}' has no commits yet`);
      args = ["push", "--porcelain", "--set-upstream", REMOTE, `refs/heads/${branch}:refs/heads/${branch}`];
    }
    const res = await runGit(projectId, args);
    if (res.code !== 0) {
      const text = `${res.stdout}\n${res.stderr}`;
      if (/\[rejected\]|non-fast-forward|fetch first/i.test(text)) {
        httpError(
          409,
          "The remote has commits you don't have. Pull first (or merge them on a branch), then push again.",
        );
      }
      remoteFailure("push to the remote", res);
    }
    return outputOf(res);
  });
  return { output };
}

/** Fetch, then fast-forward the checked-out branch (and the project folder) to its upstream. */
export async function pullRemote(projectId: string): Promise<{ output: string }> {
  await requireRemote(projectId);
  const result = await git.withRepoLock(projectId, async () => {
    const fetchOut = await fetchLocked(projectId);
    const branch = await git.checkedOutBranch(projectId);
    if (!branch) httpError(409, "No branch is checked out in the project folder");
    const upstream = (await upstreamOf(projectId, branch)) ?? `${REMOTE}/${branch}`;
    if (!(await refExists(projectId, `refs/remotes/${upstream}`))) {
      httpError(409, `The remote has no branch '${branch}' yet. Push it first.`);
    }
    const before = (await runGit(projectId, ["rev-parse", "--verify", "--quiet", "HEAD"])).stdout.trim() || null;
    const res = await runGit(projectId, ["merge", "--ff-only", "--no-edit", `refs/remotes/${upstream}`]);
    if (res.code !== 0) {
      const text = outputOf(res);
      if (/not possible to fast-forward|diverging|non-fast-forward|fatal: Not possible/i.test(text)) {
        httpError(
          409,
          `Can't fast-forward '${branch}': it and '${upstream}' have both changed. ` +
            "Merge or rebase them in a terminal, or push your work to a new branch.",
        );
      }
      if (/would be overwritten|local changes|untracked working tree files/i.test(text)) {
        httpError(
          409,
          `The project folder has uncommitted changes that the pull would overwrite. Commit or discard them first. (${text.split("\n")[0]})`,
        );
      }
      httpError(409, `Couldn't pull: ${text}`);
    }
    const after = (await runGit(projectId, ["rev-parse", "--verify", "--quiet", "HEAD"])).stdout.trim() || null;
    return { output: outputOf(res) || fetchOut, branch, before, after };
  });
  if (result.after && result.after !== result.before) {
    invalidateOntologyCache(projectId);
    await emitOntologyEvent({
      type: "commit",
      projectId,
      branch: result.branch,
      commitHash: result.after,
      parentHash: result.before,
      message: `Pulled from ${REMOTE}`,
      origin: "pull",
    });
  }
  return { output: result.output };
}

const REPO_NAME_RE = /^(?:[A-Za-z0-9-]+\/)?[A-Za-z0-9._-]+$/;

/** Create a GitHub repository with the gh CLI, link it as origin and push. */
export async function createGitHubRepo(
  projectId: string,
  opts: { name: unknown; private: unknown; description?: unknown },
): Promise<{ output: string }> {
  if (typeof opts.name !== "string" || !REPO_NAME_RE.test(opts.name.trim()))
    httpError(400, "Field 'name' must be a repository name like 'my-ontology' or 'owner/my-ontology'");
  if (opts.private !== undefined && typeof opts.private !== "boolean")
    httpError(400, "Field 'private' must be a boolean");
  if (opts.description !== undefined && opts.description !== null && typeof opts.description !== "string")
    httpError(400, "Field 'description' must be a string");
  const gh = await ghStatus(true);
  if (!gh.available) {
    httpError(
      400,
      "The GitHub CLI (gh) isn't installed. Install it from https://cli.github.com, run `gh auth login`, then try again — or create the repository on github.com and paste its URL.",
    );
  }
  if (!gh.authenticated) {
    httpError(400, "The GitHub CLI isn't signed in. Run `gh auth login` in a terminal, then try again.");
  }
  if (await getRemoteUrl(projectId)) httpError(409, "The project is already linked to a remote. Unlink it first.");
  const dir = git.workTreePath(projectId);
  const output = await git.withRepoLock(projectId, async () => {
    const args = [
      "repo",
      "create",
      (opts.name as string).trim(),
      opts.private === false ? "--public" : "--private",
      "--source",
      dir,
      "--remote",
      REMOTE,
      "--push",
    ];
    if (typeof opts.description === "string" && opts.description.trim()) args.push("--description", opts.description.trim());
    let res: RunResult;
    try {
      res = await run(ghBin(), args, { cwd: dir });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      httpError(400, "The GitHub CLI (gh) couldn't be started. Install it from https://cli.github.com.");
    }
    if (res.code !== 0) remoteFailure("create the GitHub repository", res);
    return outputOf(res);
  });
  return { output };
}

/** How long a clone may take. Big repositories need longer than the other remote commands. */
function cloneTimeoutMs(): number {
  const fromEnv = Number(process.env.ONTOBUILDER_CLONE_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 5 * 60_000;
}

/** The repository's name from its URL, for a default project name: `.../pizza-ontology.git` → `pizza-ontology`. */
export function repoNameFromUrl(url: string): string {
  const last = url.replace(/[/\\]+$/, "").split(/[/:\\]/).pop() ?? "";
  return last.replace(/\.git$/, "") || "repository";
}

/** Turns a failed `git clone` into an ApiError: bad branch, unknown repository, sign-in problem or network error. */
function cloneFailure(res: RunResult, opts: { branch?: string | null; host: string }): never {
  const output = (res.stderr || res.stdout).trim();
  const tail = output
    .split("\n")
    .filter((l) => l && !/^Cloning into/.test(l))
    .slice(-3)
    .join(" ");
  if (opts.branch && /Remote branch .* not found/i.test(output)) {
    httpError(404, `The repository has no branch '${opts.branch}'. Leave the branch empty to use its default branch.`);
  }
  if (/could not resolve host|could not resolve hostname|network is unreachable|connection refused|connection timed out|failed to connect|operation timed out/i.test(output)) {
    httpError(502, `Couldn't reach ${opts.host}. Check the URL and your network connection. Git said: ${tail}`);
  }
  if (/repository not found|repository '.*' not found|does not appear to be a git repository|not found\s*$|\b404\b/im.test(output)) {
    httpError(
      404,
      "Repository not found. Check the URL; if the repository is private, make sure you're signed in to the host " +
        "(`gh auth login` and `gh auth setup-git`, a git credential helper, or an SSH key loaded with `ssh-add`). " +
        `Git said: ${tail}`,
    );
  }
  if (AUTH_PATTERNS.some((p) => p.test(output))) {
    httpError(
      403,
      "Couldn't clone: git could not sign in to the host, or the repository doesn't exist. " +
        "For HTTPS URLs run `gh auth login` (and `gh auth setup-git`) or set up a git credential helper; " +
        "for SSH URLs make sure your SSH key is loaded (`ssh-add`) and added to your account on the host. " +
        `Git said: ${tail}`,
    );
  }
  httpError(400, `Couldn't clone the repository: ${tail || `git exited with code ${res.code}`}`);
}

/**
 * Clone a repository (full history) into `dir`, which must not exist yet. The remote is
 * named `origin`, so fetch, pull and push work on the new project straight away.
 * Git runs without a shell, with `--` before the URL, terminal prompts off and a timeout.
 * The caller removes `dir` if this throws.
 */
export async function cloneRepository(
  rawUrl: unknown,
  dir: string,
  opts: { branch?: string | null } = {},
): Promise<{ remote: ParsedRemote; output: string }> {
  const remote = parseRemoteUrl(rawUrl);
  const args = [
    // Only the protocols parseRemoteUrl accepts; ext:: (runs commands) and local files are refused.
    "-c",
    "protocol.ext.allow=never",
    "-c",
    `protocol.file.allow=${fileRemotesAllowed() ? "always" : "never"}`,
    "clone",
    "--origin",
    REMOTE,
    "--no-recurse-submodules",
  ];
  if (opts.branch) args.push("--branch", opts.branch);
  args.push("--", remote.url, dir);
  const timeoutMs = cloneTimeoutMs();
  let res: RunResult;
  try {
    res = await run("git", args, {
      // A clone must not inherit another repository from the environment.
      env: {
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_INDEX_FILE: undefined,
        GIT_COMMITTER_NAME: git.COMMITTER_NAME,
        GIT_COMMITTER_EMAIL: git.COMMITTER_EMAIL,
      },
      cwd: path.dirname(dir),
      timeoutMs,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 504) {
      const limit = timeoutMs >= 60_000 ? `${Math.round(timeoutMs / 60_000)} minutes` : `${timeoutMs / 1000} seconds`;
      httpError(
        504,
        `Cloning took longer than ${limit} and was stopped. The repository may be very large or the host slow; ` +
          "clone it in a terminal instead, or try again later.",
      );
    }
    throw e;
  }
  if (res.code !== 0) cloneFailure(res, { branch: opts.branch, host: remote.host });
  return { remote, output: outputOf(res) };
}
