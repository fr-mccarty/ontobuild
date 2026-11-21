import fs from "node:fs";
import path from "node:path";
import * as git from "./git";
import { httpError } from "./http";
import { commitOntology, ontologyFilePath, requireProject } from "./ontology";
import { parseTurtle, RdfParseError, stripLanguageTagsFromTurtle } from "./rdf";

/**
 * Changes to the ontology file made in the project folder, outside OntoBuild (by an agent, a
 * terminal or a text editor). The editor reads the ontology from the branch's last commit, so
 * these stay out of view until they are committed.
 */
export interface OntologyLocalChanges {
  /** The branch checked out in the project folder (the one a commit goes to), or null when detached. */
  branch: string | null;
  /** The ontology file, relative to the project folder; null when the project has none yet. */
  path: string | null;
  /** The file in the folder differs from the branch's last commit. */
  changed: boolean;
  /** Why the changed file can't be committed (it's missing or doesn't parse); null when it can. */
  problem: string | null;
}

const workTreeEnv = (projectId: string) => ({ GIT_WORK_TREE: git.workTreePath(projectId) });

async function fileIsChanged(projectId: string, file: string): Promise<boolean> {
  const out = await git.git(projectId, ["status", "--porcelain", "--untracked-files=all", "--", file], {
    env: workTreeEnv(projectId),
  });
  return out.trim() !== "";
}

/** Parse results by file and modification, so polling a large unchanged file doesn't parse it again. */
const g = globalThis as typeof globalThis & { __ontobuildLocalParse?: Map<string, string | null> };
const parseMemo: Map<string, string | null> = (g.__ontobuildLocalParse ??= new Map());

function parseProblem(absolute: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return "The file is missing from the project folder.";
  }
  if (!stat.isFile()) return "The ontology path in the project folder isn't a regular file.";
  const key = `${absolute}:${stat.mtimeMs}:${stat.size}`;
  if (parseMemo.has(key)) return parseMemo.get(key)!;
  let problem: string | null = null;
  try {
    parseTurtle(fs.readFileSync(absolute, "utf8"));
  } catch (e) {
    if (!(e instanceof RdfParseError)) throw e;
    problem = `The file doesn't parse as Turtle: ${e.message}`;
  }
  for (const k of parseMemo.keys()) if (k.startsWith(`${absolute}:`)) parseMemo.delete(k);
  parseMemo.set(key, problem);
  return problem;
}

function absolutePath(projectId: string, file: string): string {
  const root = git.workTreePath(projectId);
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(root + path.sep)) httpError(400, "The ontology path is outside the project folder");
  return absolute;
}

export async function getOntologyLocalChanges(projectId: string): Promise<OntologyLocalChanges> {
  const project = requireProject(projectId);
  if (!project.source_file_path || !git.repoExists(projectId)) {
    return { branch: null, path: null, changed: false, problem: null };
  }
  const file = ontologyFilePath(project);
  const branch = await git.checkedOutBranch(projectId);
  const changed = await fileIsChanged(projectId, file);
  const problem = changed ? parseProblem(absolutePath(projectId, file)) : null;
  return { branch, path: file, changed, problem };
}

/**
 * Commit the ontology file as it is in the project folder to the checked-out branch. Language
 * tags are stripped as for every other commit, and the folder is left matching the commit.
 */
export async function commitOntologyLocalChanges(
  projectId: string,
  commitMessage?: unknown,
): Promise<{ branch: string; path: string; commit_hash: string }> {
  if (commitMessage !== undefined && commitMessage !== null && typeof commitMessage !== "string") {
    httpError(422, "commit_message must be a string");
  }
  const status = await getOntologyLocalChanges(projectId);
  if (!status.path) httpError(404, "This project has no ontology file yet");
  if (!status.branch) httpError(409, "The project folder has no branch checked out, so there is nowhere to commit to");
  if (!status.changed) httpError(409, "The ontology file has no uncommitted changes");
  if (status.problem) httpError(422, status.problem);

  const absolute = absolutePath(projectId, status.path);
  const raw = fs.readFileSync(absolute, "utf8");
  const { content } = await stripLanguageTagsFromTurtle(raw);
  if (content !== raw) fs.writeFileSync(absolute, content);
  // Stage it first: committing moves the folder to the new commit, which git only does for a file
  // whose folder copy matches the index.
  await git.git(projectId, ["add", "--", status.path], { env: workTreeEnv(projectId) });

  const commit = await commitOntology({
    projectId,
    branch: status.branch,
    content,
    message: commitMessage?.trim().slice(0, 500) || `Commit changes to ${status.path} made outside OntoBuild`,
    origin: "local",
  });
  return { branch: commit.branch, path: status.path, commit_hash: commit.hash };
}
