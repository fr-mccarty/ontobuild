/**
 * The RDF files in a project folder, and which one is the project's ontology.
 *
 * A project edits exactly one ontology file at a time: `projects.git_ontology_path`, a path in the
 * project's git repository. A folder (especially one cloned from a repository) can hold several
 * RDF files, so this module
 * - finds them: files tracked by git on a branch (symbolic links and submodules are skipped, since
 *   they can point outside the folder), best candidate first. Used by the Git import too.
 * - switches the project to another one. OntoBuilder reads and writes Turtle only, so choosing a
 *   file in another format converts it to Turtle and commits the result next to the original. When
 *   that Turtle file exists already (an earlier conversion, or the repository's own copy) it is
 *   reused if it is up to date: it has the same triples as the original, or for an earlier
 *   conversion, the original hasn't changed since. When it is out of date the caller chooses
 *   (`reconvert`): use it anyway, or convert again and overwrite it. The original is never changed.
 * - creates a new, empty ontology file and makes it the project's ontology.
 *
 * The path is one setting for the whole project, not per branch. Switching and creating happen on
 * one branch: the file must exist there (a new or converted file is committed there). On a branch
 * without the file the editor reports that the file is missing and offers the switcher, and the
 * file reaches other branches when they are merged.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as git from "./git";
import { nowIso, run, toJson, update } from "./db";
import { httpError } from "./http";
import {
  DEFAULT_ONTOLOGY_FILE,
  emitOntologyEvent,
  invalidateOntologyCache,
  ontologyFilePath,
  projectToResponse,
  requireBranch,
  requireProject,
  type ProjectRow,
} from "./ontology";
import {
  FORMAT_NAMES,
  RdfParseError,
  SUPPORTED_EXTENSIONS,
  formatFromFilename,
  importNormalizationReport,
  normalizeToTurtle,
  ontologyMetadata,
  parseTurtle,
  sameGraph,
  stripLanguageTags,
  type ImportNormalizationReport,
  type RdfFormat,
} from "./rdf";
import { LOCAL_USER } from "./user";

/** Same limit as an uploaded file. */
export const MAX_ONTOLOGY_FILE_SIZE = 50 * 1024 * 1024;
/** Bytes read from each candidate to see whether it declares an owl:Ontology. */
const SNIFF_BYTES = 256 * 1024;
/** Files whose start is read to look for owl:Ontology; further ones count as not declaring one. */
const MAX_SNIFFED_FILES = 200;
const SNIFF_CONCURRENCY = 8;

/** Extensions looked for automatically. `.xml` and `.json` count only when the file declares an owl:Ontology. */
const GENERIC_EXTENSIONS = new Set([".xml", ".json"]);
/** Folders whose RDF files are usually examples, tests or dependencies rather than the ontology being developed. */
const UNLIKELY_DIRS = /(^|\/)(tests?|examples?|fixtures?|samples?|docs?|node_modules|vendor|third[-_]?party|imports?|mirror|tmp|target|build|dist)\//i;
const DECLARES_ONTOLOGY = /owl[:#]Ontology\b/;

const SYMLINK_MODE = "120000";
const SUBMODULE_MODE = "160000";

export interface OntologyCandidate {
  path: string;
  format: RdfFormat;
  size_bytes: number;
  /** The first 256 KB mention owl:Ontology (in any syntax). */
  declares_ontology: boolean;
}

/** A file or link in a commit's tree. */
export interface TreeEntry {
  path: string;
  mode: string;
  oid: string;
  size: number;
}

export type TreeListing = Map<string, TreeEntry>;

function extensionOf(p: string): string {
  const m = /\.[^./]+$/.exec(p);
  return m ? m[0].toLowerCase() : "";
}

function gitEnv(dir: string): NodeJS.ProcessEnv {
  return { ...process.env, GIT_DIR: path.join(dir, ".git"), GIT_WORK_TREE: dir, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
}

/** Runs git in a project folder (or a fresh clone) and returns its output. */
export function runGit(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: dir, env: gitEnv(dir), maxBuffer: 128 * 1024 * 1024, encoding: "utf8" },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/** Every file in the tree of `ref` (a branch, `HEAD` or a commit). Empty when the ref doesn't exist yet. */
export async function listTree(dir: string, ref: string): Promise<TreeListing> {
  let out: string;
  try {
    out = await runGit(dir, ["ls-tree", "-r", "-l", "-z", "--full-tree", ref]);
  } catch {
    return new Map(); // an empty repository, or a branch without commits
  }
  const entries: TreeListing = new Map();
  for (const rec of out.split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const [mode, , oid, size] = rec.slice(0, tab).split(/\s+/);
    const p = rec.slice(tab + 1);
    entries.set(p, { path: p, mode, oid, size: Number(size) || 0 });
  }
  return entries;
}

/** The first `max` bytes of a blob, without reading the rest. */
function readBlobPrefix(dir: string, oid: string, max: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("git", ["cat-file", "blob", oid], { cwd: dir, env: gitEnv(dir) });
    const chunks: Buffer[] = [];
    let n = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).subarray(0, max).toString("utf8"));
    };
    child.stdout.on("data", (b: Buffer) => {
      chunks.push(b);
      n += b.length;
      if (n >= max) {
        child.kill();
        finish();
      }
    });
    child.on("close", finish);
    child.on("error", finish);
  });
}

/** A whole file at `ref`. */
export function readTreeFile(dir: string, ref: string, rel: string): Promise<string> {
  return runGit(dir, ["cat-file", "blob", `${ref}:${rel}`]);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The RDF files in a tree listing, best candidate first. Links and submodules are skipped. */
export async function candidatesFromTree(dir: string, entries: TreeListing): Promise<OntologyCandidate[]> {
  const files = [...entries.values()].filter(
    (e) => formatFromFilename(e.path) && e.mode !== SYMLINK_MODE && e.mode !== SUBMODULE_MODE && e.path.split("/")[0] !== ".git",
  );
  const declares = await mapLimit(files, SNIFF_CONCURRENCY, async (e, i) =>
    i < MAX_SNIFFED_FILES ? DECLARES_ONTOLOGY.test(await readBlobPrefix(dir, e.oid, SNIFF_BYTES)) : false,
  );
  const out: OntologyCandidate[] = [];
  files.forEach((e, i) => {
    if (GENERIC_EXTENSIONS.has(extensionOf(e.path)) && !declares[i]) return;
    out.push({ path: e.path, format: formatFromFilename(e.path)!, size_bytes: e.size, declares_ontology: declares[i] });
  });
  return out.sort(compareCandidates);
}

/** Files tracked by git at `ref` that look like RDF, best candidate first. */
export async function findOntologyCandidates(dir: string, ref = "HEAD"): Promise<OntologyCandidate[]> {
  return candidatesFromTree(dir, await listTree(dir, ref));
}

function rank(c: OntologyCandidate): number[] {
  return [
    c.path === DEFAULT_ONTOLOGY_FILE ? 0 : 1,
    c.declares_ontology ? 0 : 1,
    UNLIKELY_DIRS.test(c.path) ? 1 : 0,
    c.size_bytes > MAX_ONTOLOGY_FILE_SIZE ? 1 : 0,
    c.format === "turtle" ? 0 : 1,
    c.path.split("/").length,
  ];
}

function compareCandidates(a: OntologyCandidate, b: OntologyCandidate): number {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
  return a.path.localeCompare(b.path);
}

/**
 * A repository-relative path from a request: no absolute paths, `..`, `.`, empty segments,
 * backslashes, control characters or the `.git` folder. Null when the field is absent.
 */
export function cleanRelativePath(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") httpError(422, `Field '${field}' must be a string`);
  const p = raw.trim().replace(/^\.\//, "");
  if (
    !p ||
    p.length > 1024 ||
    p.startsWith("/") ||
    p.includes("\\") ||
    /[\0-\x1f\x7f]/.test(p) ||
    p.split("/").some((s) => s === ".." || s === "." || s === "") ||
    p.split("/")[0].toLowerCase() === ".git"
  ) {
    httpError(422, `Field '${field}' must be a path inside the repository, like 'src/ontology/pizza.ttl'`);
  }
  return p;
}

function onBranch(branch: string | null): string {
  return branch ? ` on branch '${branch}'` : "";
}

/**
 * A file the request names, checked against the tree: it must be a tracked, regular RDF file.
 * Files that automatic discovery skipped (a `.xml` or `.json` file that doesn't mention
 * owl:Ontology near the top) are accepted when named.
 */
export function requireTreeCandidate(
  dir: string,
  entries: TreeListing,
  rel: string,
  candidates: OntologyCandidate[],
  branch: string | null,
): OntologyCandidate {
  const known = candidates.find((x) => x.path === rel);
  if (known) return known;
  const entry = entries.get(rel);
  if (!entry) {
    let untracked = false;
    try {
      untracked = fs.lstatSync(path.join(dir, rel)).isFile();
    } catch {
    }
    if (untracked) {
      httpError(
        422,
        `${rel} is in the project folder but isn't committed${onBranch(branch)}. Commit it first, then choose it.`,
      );
    }
    httpError(
      422,
      `${rel} isn't in the repository${onBranch(branch)}.` +
        (candidates.length ? ` RDF files found: ${candidates.slice(0, 10).map((x) => x.path).join(", ")}.` : ""),
    );
  }
  if (entry.mode === SYMLINK_MODE) httpError(422, `${rel} is a symbolic link. Choose the file it points to instead.`);
  if (entry.mode === SUBMODULE_MODE) httpError(422, `${rel} is a git submodule, not a file.`);
  const format = formatFromFilename(rel);
  if (!format) {
    httpError(422, `${rel} isn't an RDF file OntoBuilder can read. Supported extensions: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
  }
  return { path: rel, format, size_bytes: entry.size, declares_ontology: false };
}

export type ParsedStore = ReturnType<typeof parseTurtle>["store"];

export interface LoadedCandidate {
  candidate: OntologyCandidate;
  original: string;
  /** Turtle to commit when the file is converted; null when it is Turtle already. */
  converted: { turtle: string; report: ImportNormalizationReport } | null;
  store: ParsedStore;
}

/** Reads and parses a candidate at `ref`, converting it to Turtle when it is in another format. */
export async function loadCandidate(dir: string, ref: string, c: OntologyCandidate): Promise<LoadedCandidate> {
  if (c.size_bytes > MAX_ONTOLOGY_FILE_SIZE) {
    throw new RdfParseError(`it is larger than ${MAX_ONTOLOGY_FILE_SIZE / (1024 * 1024)} MB`);
  }
  const original = await readTreeFile(dir, ref, c.path);
  if (c.format === "turtle") {
    return { candidate: c, original, converted: null, store: parseTurtle(original).store };
  }
  const normalized = await normalizeToTurtle(original, c.path);
  return {
    candidate: c,
    original,
    converted: { turtle: normalized.turtle, report: importNormalizationReport(original, c.path, normalized) },
    store: normalized.store,
  };
}

export function countLanguageTags(store: ParsedStore): number {
  let n = 0;
  for (const q of store.getQuads(null, null, null, null)) {
    if (q.object.termType === "Literal" && (q.object as unknown as { language: string }).language) n++;
  }
  return n;
}

export function languageTagWarning(count: number, file: string): string {
  return `${count} literal(s) in ${file} have language tags. OntoBuilder stores plain strings, so the tags are dropped the next time it saves the ontology.`;
}

const CONVERSION_SUFFIX = " to Turtle for OntoBuilder";

/** The commit message of a conversion; its first line also finds the conversion again later. */
export function conversionMessage(source: string, target: string, formatName: string): string {
  return (
    `Convert ${source}${CONVERSION_SUFFIX}\n\n` +
    `OntoBuilder edits Turtle, so the ontology was converted from ${formatName} ` +
    `and saved as ${target}. ${source} is left unchanged.`
  );
}

/** A Turtle file a conversion wrote, and the commit that wrote it. */
interface Conversion {
  path: string;
  commit: string;
}

/**
 * The Turtle files conversions made, by the file they were converted from: the latest conversion
 * of each (a first conversion adds the file, converting again modifies it).
 */
async function previousConversions(dir: string, ref: string, entries: TreeListing): Promise<Map<string, Conversion>> {
  const found = new Map<string, Conversion>();
  let log: string;
  try {
    log = await runGit(dir, ["log", "--format=%H%x1f%s", "--fixed-strings", `--grep=${CONVERSION_SUFFIX}`, ref]);
  } catch {
    return found;
  }
  for (const line of log.split("\n")) {
    const [sha, subject] = line.split("\x1f");
    const m = subject && /^Convert (.+) to Turtle for OntoBuilder$/.exec(subject);
    if (!m || found.has(m[1])) continue;
    try {
      const written = await runGit(dir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--diff-filter=AM", sha]);
      const ttl = written.split("\0").find((p) => p.toLowerCase().endsWith(".ttl") && entries.has(p));
      if (ttl) found.set(m[1], { path: ttl, commit: sha });
    } catch {
    }
  }
  return found;
}

/** The Turtle file next to a non-Turtle one: `src/pizza.owl` → `src/pizza.ttl`. */
export function siblingTurtlePath(source: string): string {
  return source.replace(/\.[^./]+$/, "") + ".ttl";
}

interface TurtleTarget {
  path: string;
  exists: boolean;
  /** The commit of the earlier OntoBuilder conversion that wrote `path`, or null. */
  conversionCommit: string | null;
}

/**
 * The Turtle file that choosing a non-Turtle file uses: the one an earlier conversion of it made,
 * else `<name>.ttl` next to it (which may exist already, or is created by converting).
 */
function turtleTarget(source: string, entries: TreeListing, conversions: Map<string, Conversion>): TurtleTarget {
  const earlier = conversions.get(source);
  if (earlier) return { path: earlier.path, exists: true, conversionCommit: earlier.commit };
  const sibling = siblingTurtlePath(source);
  return { path: sibling, exists: entries.has(sibling), conversionCommit: null };
}

/** The graph a Turtle file gives the editor: its triples, without language tags (OntoBuilder drops them). */
function editorGraph(turtle: string): ParsedStore {
  const store = parseTurtle(turtle).store;
  stripLanguageTags(store);
  return store;
}

/**
 * Whether an existing Turtle target still matches the file it stands for. Null when it does;
 * otherwise why not.
 * - Made by an earlier OntoBuilder conversion: it is out of date when the source's triples
 *   changed since that conversion (the Turtle file may have been edited since, which is fine).
 * - Otherwise (the repository's own copy): it is out of date when converting the source now
 *   would give different triples. Blank nodes are compared by structure, and language tags are
 *   ignored since a conversion drops them.
 * Throws RdfParseError when a file can't be read or parsed.
 */
async function turtleStaleness(
  dir: string,
  ref: string,
  source: OntologyCandidate,
  sourceEntry: TreeEntry,
  target: TurtleTarget,
): Promise<string | null> {
  if (target.conversionCommit) {
    const at = target.conversionCommit;
    let oldOid: string | null = null;
    try {
      oldOid = (await runGit(dir, ["rev-parse", "--verify", "--quiet", `${at}:${source.path}`])).trim() || null;
    } catch {
    }
    if (oldOid === sourceEntry.oid) return null;
    const changed = `${source.path} has changed since it was converted to ${target.path} in commit ${at.slice(0, 8)}`;
    if (!oldOid) return changed;
    const [before, now] = await Promise.all([
      loadCandidate(dir, at, source),
      loadCandidate(dir, ref, source),
    ]);
    return (await sameGraph(before.store, now.store)) ? null : changed;
  }
  const [now, existing] = await Promise.all([loadCandidate(dir, ref, source), readTreeFile(dir, ref, target.path)]);
  let existingGraph: ParsedStore;
  try {
    existingGraph = editorGraph(existing);
  } catch (e) {
    if (e instanceof RdfParseError) throw new RdfParseError(`${target.path}: ${e.message}`);
    throw e;
  }
  return (await sameGraph(now.store, existingGraph))
    ? null
    : `${target.path} doesn't have the same triples as ${source.path}`;
}

// ---------------------------------------------------------------------------
// The project's ontology file
// ---------------------------------------------------------------------------

export interface OntologyFileInfo extends OntologyCandidate {
  /** This is the project's ontology file. */
  active: boolean;
  /**
   * For a file that isn't Turtle: the Turtle file choosing it makes the ontology. Null for
   * Turtle files, which are edited in place.
   */
  turtle_path: string | null;
  /** For a file that isn't Turtle: true when `turtle_path` exists already and is used as it is. */
  turtle_exists: boolean;
}

export interface OntologyFileList {
  project_id: string;
  branch: string;
  /** The project's ontology file, or null when it has none. */
  active_path: string | null;
  /** Whether the active file exists on this branch. */
  active_exists: boolean;
  files: OntologyFileInfo[];
  /** A free name for a new ontology file: `ontology.ttl`, or `ontology-2.ttl` and so on. */
  suggested_file_name: string;
}

function activePath(project: ProjectRow): string | null {
  return project.source_file_path ? ontologyFilePath(project) : null;
}

/**
 * The branch to work on: the one named (which must exist), else the default branch. A
 * repository without commits yet has no branches; then it is the branch HEAD names.
 */
async function targetBranch(projectId: string, branch: unknown): Promise<string> {
  if (branch !== undefined && branch !== null && branch !== "" && typeof branch !== "string") {
    httpError(422, "Field 'branch' must be a string");
  }
  const named = typeof branch === "string" && branch.trim() ? branch.trim() : null;
  if (git.repoExists(projectId) && !(await git.listBranchNames(projectId)).length) {
    const head = (await git.checkedOutBranch(projectId)) ?? git.DEFAULT_BRANCH;
    if (named && named !== head) httpError(404, `Branch not found: ${named}`);
    return head;
  }
  return requireBranch(projectId, named);
}

function suggestedFileName(entries: TreeListing, dir: string): string {
  const taken = (p: string) => entries.has(p) || fs.existsSync(path.join(dir, p));
  if (!taken(DEFAULT_ONTOLOGY_FILE)) return DEFAULT_ONTOLOGY_FILE;
  for (let i = 2; ; i++) {
    const name = `ontology-${i}.ttl`;
    if (!taken(name)) return name;
  }
}

export async function listOntologyFiles(projectId: string, branchParam?: string | null): Promise<OntologyFileList> {
  const project = requireProject(projectId);
  const dir = git.workTreePath(projectId);
  const branch = await targetBranch(projectId, branchParam);
  const ref = `refs/heads/${branch}`;
  const entries = git.repoExists(projectId) ? await listTree(dir, ref) : new Map<string, TreeEntry>();
  const candidates = await candidatesFromTree(dir, entries);
  const active = activePath(project);
  // The active file is listed even when discovery would skip it (a .xml without owl:Ontology near the top).
  if (active && entries.has(active) && !candidates.some((c) => c.path === active)) {
    const format = formatFromFilename(active);
    if (format) candidates.unshift({ path: active, format, size_bytes: entries.get(active)!.size, declares_ontology: false });
  }
  const conversions = candidates.some((c) => c.format !== "turtle")
    ? await previousConversions(dir, ref, entries)
    : new Map<string, Conversion>();
  return {
    project_id: projectId,
    branch,
    active_path: active,
    active_exists: !!active && entries.has(active),
    files: candidates.map((c) => {
      const target = c.format === "turtle" ? null : turtleTarget(c.path, entries, conversions);
      return { ...c, active: c.path === active, turtle_path: target?.path ?? null, turtle_exists: target?.exists ?? false };
    }),
    suggested_file_name: suggestedFileName(entries, dir),
  };
}

export interface OntologyFileChange {
  project: ReturnType<typeof projectToResponse>;
  branch: string;
  /** The Turtle file the project now edits. */
  path: string;
  /** The file that was chosen: `path`, or the non-Turtle file it was converted from. */
  source_path: string;
  /** The chosen file was converted to Turtle and committed as `path`. */
  converted: boolean;
  /** The chosen file isn't Turtle and `path` already existed, so it was used without converting again. */
  reused: boolean;
  /**
   * The chosen file isn't Turtle, `path` existed already and was overwritten by converting the
   * chosen file again (`reconvert: true`).
   */
  replaced: boolean;
  /** The ontology file before the change, or null when the project had none. */
  previous_path: string | null;
  /** The commit made (a conversion or a new file), or null when nothing was committed. */
  commit_hash: string | null;
  warnings: string[];
}

/**
 * Point the project at another ontology file and drop everything worked out from the old one:
 * cached parses, the search index, lint, consistency and duplicate results, the normalization
 * check and import caches (see the "ontology-file-changed" listeners). Label preferences are
 * project settings and are kept.
 */
async function setActiveFile(
  project: ProjectRow,
  opts: { path: string; ontologyIri: string | null; report: ImportNormalizationReport | null },
): Promise<void> {
  const previousPath = activePath(project);
  update(
    "projects",
    {
      source_file_path: `projects/${project.id}/${opts.path}`,
      git_ontology_path: opts.path,
      ontology_iri: opts.ontologyIri,
      normalization_report: opts.report ? toJson(opts.report) : null,
      updated_at: nowIso(),
    },
    { id: project.id },
  );
  invalidateOntologyCache(project.id);
  await emitOntologyEvent({ type: "ontology-file-changed", projectId: project.id, path: opts.path, previousPath });
}

async function commitAndAnnounce(
  projectId: string,
  branch: string,
  file: { path: string; content: string },
  message: string,
  origin: string,
): Promise<string> {
  const parent = await git.resolveRef(projectId, `refs/heads/${branch}`).catch(() => null);
  const commit = await git.commitFiles(projectId, {
    branch,
    files: [file],
    message,
    author: { name: LOCAL_USER.name, email: LOCAL_USER.email },
  });
  await emitOntologyEvent({
    type: "commit",
    projectId,
    branch,
    commitHash: commit.hash,
    parentHash: parent,
    message,
    origin,
  });
  return commit.hash;
}

function requireRepo(projectId: string): void {
  if (!git.repoExists(projectId)) httpError(404, "No repository found for this project");
}

/** The 409 `code` when the Turtle file next to a chosen file is out of date and the request didn't say what to do. */
export const TURTLE_OUT_OF_DATE = "turtle_out_of_date";

/**
 * Makes a file in the project folder the project's ontology (see the module comment).
 *
 * `reconvert` matters only for a file that isn't Turtle whose Turtle file exists already:
 * - absent: the Turtle file is reused when it is up to date; when it isn't, nothing changes and
 *   the request fails with 409 and `code: "turtle_out_of_date"`, so the caller can ask the user.
 * - false: the Turtle file is used as it is, even when out of date (with a warning).
 * - true: the file is converted again and the result overwrites the Turtle file in a new commit.
 */
export async function switchOntologyFile(
  projectId: string,
  body: { path?: unknown; branch?: unknown; reconvert?: unknown },
): Promise<OntologyFileChange> {
  const project = requireProject(projectId);
  if (!body || typeof body !== "object" || Array.isArray(body)) httpError(422, "Expected a JSON object");
  const rel = cleanRelativePath(body.path, "path");
  if (!rel) httpError(422, "Field 'path' is required");
  if (body.reconvert !== undefined && body.reconvert !== null && typeof body.reconvert !== "boolean") {
    httpError(422, "Field 'reconvert' must be a boolean");
  }
  const reconvert = typeof body.reconvert === "boolean" ? body.reconvert : null;
  requireRepo(projectId);
  const branch = await targetBranch(projectId, body.branch);
  const dir = git.workTreePath(projectId);
  const ref = `refs/heads/${branch}`;
  const entries = await listTree(dir, ref);
  const candidates = await candidatesFromTree(dir, entries);
  const chosen = requireTreeCandidate(dir, entries, rel, candidates, branch);
  const previous = activePath(project);
  const warnings: string[] = [];

  const parseFailed = (file: string, e: unknown): never => {
    if (e instanceof RdfParseError) httpError(422, `Failed to parse ${file}: ${e.message.split("\n")[0]}`);
    throw e;
  };
  const result = (fields: Pick<OntologyFileChange, "path" | "converted" | "reused" | "replaced" | "commit_hash">): OntologyFileChange => ({
    project: projectToResponse(requireProject(projectId)),
    branch,
    source_path: rel,
    previous_path: previous,
    warnings,
    ...fields,
  });

  if (chosen.format === "turtle") {
    let loaded: LoadedCandidate;
    try {
      loaded = await loadCandidate(dir, ref, chosen);
    } catch (e) {
      return parseFailed(rel, e);
    }
    const tagged = countLanguageTags(loaded.store);
    if (tagged) warnings.push(languageTagWarning(tagged, rel));
    if (previous !== rel) {
      await setActiveFile(project, { path: rel, ontologyIri: ontologyMetadata(loaded.store).iri, report: null });
    }
    return result({ path: rel, converted: false, reused: false, replaced: false, commit_hash: null });
  }

  const target = turtleTarget(rel, entries, await previousConversions(dir, ref, entries));
  if (target.exists && reconvert !== true) {
    // Use the Turtle file that is already there (an earlier conversion, or the repository's own
    // copy) when it is up to date, or when the caller said so.
    const existing = requireTreeCandidate(dir, entries, target.path, candidates, branch);
    let loaded: LoadedCandidate;
    try {
      loaded = await loadCandidate(dir, ref, existing);
    } catch (e) {
      return parseFailed(target.path, e);
    }
    let stale: string | null;
    try {
      stale = await turtleStaleness(dir, ref, chosen, entries.get(rel)!, target);
    } catch (e) {
      if (!(e instanceof RdfParseError)) throw e;
      // The original can't be read, so it can't be converted again either: the Turtle file is all there is.
      stale = null;
      warnings.push(
        `${target.path} is used as it is: ${rel} couldn't be read to check that it is up to date (${e.message.split("\n")[0]}).`,
      );
    }
    if (stale && reconvert === null) {
      httpError(
        409,
        `${stale}, so ${target.path} may be out of date. Choose whether to use it as it is, or convert ${rel} again, which overwrites ${target.path} in a new commit.`,
        { code: TURTLE_OUT_OF_DATE, source_path: rel, turtle_path: target.path, reason: stale, branch },
      );
    }
    if (stale) warnings.push(`${target.path} is used as it is, although it may be out of date: ${stale}.`);
    if (previous !== target.path) {
      await setActiveFile(project, { path: target.path, ontologyIri: ontologyMetadata(loaded.store).iri, report: null });
    }
    return result({ path: target.path, converted: false, reused: true, replaced: false, commit_hash: null });
  }

  if (!target.exists && fs.existsSync(path.join(dir, target.path)) && (await git.checkedOutBranch(projectId)) === branch) {
    httpError(
      409,
      `Can't convert ${rel} to Turtle: ${target.path} is in the project folder but isn't committed. Commit or remove it first.`,
    );
  }
  let loaded: LoadedCandidate;
  try {
    loaded = await loadCandidate(dir, ref, chosen);
  } catch (e) {
    return parseFailed(rel, e);
  }
  const conversion = loaded.converted!;
  const ontologyIri = ontologyMetadata(loaded.store).iri;
  if (target.exists && (await readTreeFile(dir, ref, target.path)) === conversion.turtle) {
    // Converting again gives exactly the file that is there: nothing to commit.
    if (previous !== target.path) await setActiveFile(project, { path: target.path, ontologyIri, report: null });
    return result({ path: target.path, converted: false, reused: true, replaced: false, commit_hash: null });
  }
  const report: ImportNormalizationReport = {
    ...conversion.report,
    notes: [
      ...conversion.report.notes,
      `Saved as ${target.path}${target.exists ? ", replacing the earlier file" : ""}, committed on branch ${branch} (not pushed); ${rel} is unchanged`,
    ],
  };
  // The project row changes first, so the commit's listeners (the normalization history) see the new file.
  await setActiveFile(project, { path: target.path, ontologyIri, report });
  let commitHash: string;
  try {
    commitHash = await commitAndAnnounce(
      projectId,
      branch,
      { path: target.path, content: conversion.turtle },
      conversionMessage(rel, target.path, FORMAT_NAMES[chosen.format]),
      "import",
    );
  } catch (e) {
    // Put the project back on its previous file.
    restoreRow(project);
    throw e;
  }
  return result({ path: target.path, converted: true, reused: false, replaced: target.exists, commit_hash: commitHash });
}

function restoreRow(project: ProjectRow): void {
  run(
    "UPDATE projects SET source_file_path = ?, git_ontology_path = ?, ontology_iri = ?, normalization_report = ? WHERE id = ?",
    project.source_file_path,
    project.git_ontology_path,
    project.ontology_iri,
    project.normalization_report,
    project.id,
  );
  invalidateOntologyCache(project.id);
}

/** A minimal Turtle ontology: the owl:Ontology declaration with a title (and description). */
export function starterTurtle(iri: string, title: string, description?: string | null): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return [
    "@prefix dc: <http://purl.org/dc/elements/1.1/> .",
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
    "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
    "",
    `<${iri}> a owl:Ontology ;`,
    description ? `    dc:title "${esc(title)}" ;` : `    dc:title "${esc(title)}" .`,
    ...(description ? [`    dc:description "${esc(description)}" .`] : []),
    "",
  ].join("\n");
}

/** An absolute IRI that can be written between `<` and `>` in Turtle. */
export function isValidOntologyIri(iri: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/.test(iri)) return false;
  if (/^https?:/i.test(iri)) {
    try {
      return !!new URL(iri).host;
    } catch {
      return false;
    }
  }
  return true;
}

/** Creates an empty ontology file, commits it and makes it the project's ontology. */
export async function createOntologyFile(
  projectId: string,
  body: { file_name?: unknown; ontology_iri?: unknown; title?: unknown; branch?: unknown },
): Promise<OntologyFileChange> {
  const project = requireProject(projectId);
  if (!body || typeof body !== "object" || Array.isArray(body)) httpError(422, "Expected a JSON object");
  const rel = cleanRelativePath(body.file_name, "file_name");
  if (!rel) httpError(422, "Field 'file_name' is required");
  if (!rel.endsWith(".ttl") || rel.split("/").pop() === ".ttl") {
    httpError(422, "Field 'file_name' must end in .ttl (OntoBuilder writes Turtle), like 'ontology.ttl'");
  }
  if (typeof body.ontology_iri !== "string" || !body.ontology_iri.trim()) httpError(422, "Field 'ontology_iri' is required");
  const iri = body.ontology_iri.trim();
  if (iri.length > 2000 || !isValidOntologyIri(iri)) {
    httpError(422, "Field 'ontology_iri' must be an absolute IRI without spaces, like 'http://example.org/ontologies/pizza'");
  }
  if (typeof body.title !== "string" || !body.title.trim()) httpError(422, "Field 'title' is required");
  const title = body.title.trim();
  if (title.length > 255) httpError(422, "Field 'title' must be at most 255 characters");

  const branch = await targetBranch(projectId, body.branch);
  const dir = git.workTreePath(projectId);
  const entries = git.repoExists(projectId) ? await listTree(dir, `refs/heads/${branch}`) : new Map<string, TreeEntry>();
  if (entries.has(rel)) httpError(409, `${rel} already exists on branch '${branch}'. Choose another file name.`);
  const segments = rel.split("/");
  for (let i = 1; i < segments.length; i++) {
    const parent = segments.slice(0, i).join("/");
    if (entries.has(parent)) httpError(409, `${parent} is a file, so ${rel} can't be created inside it.`);
  }
  if ([...entries.keys()].some((p) => p.startsWith(rel + "/"))) httpError(409, `${rel} is a folder. Choose another file name.`);
  let onDisk = false;
  try {
    fs.lstatSync(path.join(dir, rel));
    onDisk = true;
  } catch {
  }
  if (onDisk) {
    httpError(409, `${rel} already exists in the project folder (not committed). Choose another file name.`);
  }

  const previous = activePath(project);
  const content = starterTurtle(iri, title);
  parseTurtle(content); // never fails for a valid IRI, but don't commit a file the editor can't read
  // The project row changes first, so the commit's listeners read the new file.
  await setActiveFile(project, { path: rel, ontologyIri: iri, report: null });
  let commitHash: string;
  try {
    commitHash = await commitAndAnnounce(
      projectId,
      branch,
      { path: rel, content },
      `Create ontology ${rel}\n\nA new, empty ontology (${iri}), made the project's ontology file in OntoBuilder.`,
      "create",
    );
  } catch (e) {
    restoreRow(project);
    throw e;
  }
  return {
    project: projectToResponse(requireProject(projectId)),
    branch,
    path: rel,
    source_path: rel,
    converted: false,
    reused: false,
    replaced: false,
    previous_path: previous,
    commit_hash: commitHash,
    warnings: [],
  };
}
