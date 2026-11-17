import * as git from "./git";
import { httpError } from "./http";
import { ontologyFilePath, requireProject } from "./ontology";
import { LOCAL_USER } from "./user";
import { IGNORED_DIRS } from "./workspaceFiles";

/**
 * Uncommitted changes in the project folder other than the ontology file: code under code/,
 * files written by the agent, a terminal, a script or a text editor. The ontology file is left
 * out because it has its own commit (ontologyLocalChanges.ts), which checks that it parses and
 * reloads the editor.
 */

export type FolderChangeStatus = "added" | "modified" | "deleted";

export interface FolderChange {
  path: string;
  status: FolderChangeStatus;
}

export interface FolderChanges {
  /** The branch checked out in the project folder (the one a commit goes to), or null when detached. */
  branch: string | null;
  /** Changed files, ontology file excluded. */
  files: FolderChange[];
  /** The ontology file has uncommitted changes too (committed separately). */
  ontology_changed: boolean;
}

export interface FolderCommit {
  branch: string;
  commit_hash: string;
  files: FolderChange[];
  ontology_changed: boolean;
}

const MAX_MESSAGE = 500;

const workTreeEnv = (projectId: string) => ({ GIT_WORK_TREE: git.workTreePath(projectId) });

/** The project folder minus the ontology file and dependency/build folders (there's no .gitignore). */
function pathspec(ontologyPath: string | null): string[] {
  const spec = [".", ...[...IGNORED_DIRS].map((d) => `:(exclude,glob)**/${d}/**`)];
  if (ontologyPath) spec.push(`:(exclude,literal)${ontologyPath}`);
  return spec;
}

function statusOf(code: string): FolderChangeStatus {
  if (code.includes("D")) return "deleted";
  if (code.includes("?") || code.includes("A")) return "added";
  return "modified";
}

/** Parse `git status --porcelain -z --no-renames` output. */
function parseStatus(out: string): FolderChange[] {
  return out
    .split("\0")
    .filter((e) => e.length > 3)
    .map((e) => ({ path: e.slice(3), status: statusOf(e.slice(0, 2)) }));
}

async function status(projectId: string, spec: string[]): Promise<FolderChange[]> {
  const out = await git.git(projectId, ["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all", "--", ...spec], {
    env: workTreeEnv(projectId),
  });
  return parseStatus(out);
}

function ontologyPathOf(projectId: string): string | null {
  const project = requireProject(projectId);
  return project.source_file_path ? ontologyFilePath(project) : null;
}

export async function getFolderChanges(projectId: string): Promise<FolderChanges> {
  const ontologyPath = ontologyPathOf(projectId);
  if (!git.repoExists(projectId)) return { branch: null, files: [], ontology_changed: false };
  const branch = await git.checkedOutBranch(projectId);
  const files = await status(projectId, pathspec(ontologyPath));
  const ontology_changed = ontologyPath ? (await status(projectId, [`:(literal)${ontologyPath}`])).length > 0 : false;
  return { branch, files, ontology_changed };
}

/**
 * Commit every change in the project folder except the ontology file to the checked-out branch,
 * locally (not pushed). New files are added and deleted files removed.
 */
export async function commitFolderChanges(projectId: string, commitMessage?: unknown): Promise<FolderCommit> {
  if (commitMessage !== undefined && commitMessage !== null && typeof commitMessage !== "string") {
    httpError(422, "commit_message must be a string");
  }
  const ontologyPath = ontologyPathOf(projectId);
  if (!git.repoExists(projectId)) httpError(409, "The project folder has no git repository yet");
  const env = workTreeEnv(projectId);
  const spec = pathspec(ontologyPath);

  return git.withRepoLock(projectId, async () => {
    const branch = await git.checkedOutBranch(projectId);
    if (!branch) httpError(409, "The project folder has no branch checked out, so there is nowhere to commit to");
    const files = await status(projectId, spec);
    if (!files.length) httpError(409, "The project folder has no uncommitted changes outside the ontology file");

    await git.git(projectId, ["add", "--all", "--", ...spec], { env });
    const message =
      (typeof commitMessage === "string" ? commitMessage.trim().slice(0, MAX_MESSAGE) : "") ||
      `Commit ${files.length} changed ${files.length === 1 ? "file" : "files"} in the project folder`;
    // Only the paths in the spec, so an ontology file someone staged by hand stays out of this commit.
    await git.git(projectId, ["commit", "--quiet", "--only", "-F", "-", "--", ...spec], {
      env: { ...env, ...git.authorEnv(LOCAL_USER) },
      input: message,
    });
    const commit_hash = (await git.git(projectId, ["rev-parse", "HEAD"])).trim();
    const ontology_changed = ontologyPath ? (await status(projectId, [`:(literal)${ontologyPath}`])).length > 0 : false;
    return { branch, commit_hash, files, ontology_changed };
  });
}
