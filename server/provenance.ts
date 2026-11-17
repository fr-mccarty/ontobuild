/**
 * Provenance of a text value in the ontology: which commit introduced it, and whether it
 * reached the default branch through an approved pull request.
 *
 * - approved: on the default branch, and the commit that introduced it was merged by a
 *   pull request with at least one approving review (and as many as the project requires).
 * - direct:   on the default branch, but committed without such a pull request.
 * - pending:  not on the default branch yet, only on another branch (with its open PR, if any).
 * - unknown:  not found in the ontology (for example, an unsaved edit).
 *
 * The introducing commit is found with git's pickaxe (`git log -S`) on the Turtle-escaped
 * literal, so it is an approximation: the same text elsewhere in the file can blur it.
 */
import crypto from "node:crypto";
import { all, get } from "./db";
import * as git from "./git";
import { getObjects, loadOntology, ontologyFilePath, requireProject } from "./ontology";

export type ProvenanceStatus = "approved" | "direct" | "pending" | "unknown";

export interface ProvenanceCommit {
  hash: string;
  short_hash: string;
  message: string;
  author_name: string;
  timestamp: string;
}

export interface ProvenancePullRequest {
  number: number;
  title: string;
  status: string;
  merged_at: string | null;
  merged_by: string | null;
  approvals: { reviewer: string; at: string }[];
}

export interface Provenance {
  iri: string;
  property: string;
  value: string;
  status: ProvenanceStatus;
  introduced_in: ProvenanceCommit | null;
  pull_request: ProvenancePullRequest | null;
  on_default_branch: boolean;
}

export interface ProvenanceItem {
  iri: string;
  property: string;
  value: string;
}

interface PRRow {
  id: string;
  pr_number: number;
  title: string;
  status: string;
  source_branch: string;
  target_branch: string;
  merged_by: string | null;
  merged_at: string | null;
  merge_commit_hash: string | null;
  base_commit_hash: string | null;
  head_commit_hash: string | null;
}

type Cache = Map<string, Provenance>;
const g = globalThis as typeof globalThis & { __ontokitProvenanceCache?: Cache };
const cache: Cache = (g.__ontokitProvenanceCache ??= new Map());
const CACHE_SIZE = 2000;

/** Turtle spellings of a literal, most likely first, as the serializer and hand-written files use them. */
export function literalNeedles(value: string): string[] {
  const single =
    '"' +
    value.replace(/[\\"\n\r\t]/g, (c) => ({ "\\": "\\\\", '"': '\\"', "\n": "\\n", "\r": "\\r", "\t": "\\t" })[c]!) +
    '"';
  const triple = '"""' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r") + '"""';
  const out = value.includes("\n") ? [triple, single] : [single, triple];
  out.push(`'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
  if (value.length >= 3) out.push(value);
  return [...new Set(out)];
}

function count(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

async function hasValue(projectId: string, branch: string, item: ProvenanceItem): Promise<boolean> {
  try {
    const loaded = await loadOntology(projectId, branch);
    return getObjects(loaded.store, item.iri, item.property).some(
      (t) => t.termType === "Literal" && t.value === item.value,
    );
  } catch {
    return false;
  }
}

async function fileAt(projectId: string, sha: string, filePath: string): Promise<string> {
  return (await git.readFileOrNull(projectId, sha, filePath)) ?? "";
}

/** The newest commit on `ref` that added an occurrence of the literal to the ontology file. */
async function introducingCommit(
  projectId: string,
  ref: string,
  filePath: string,
  value: string,
): Promise<git.CommitInfo | null> {
  const head = await fileAt(projectId, ref, filePath);
  const needle = literalNeedles(value).find((n) => head.includes(n));
  if (!needle) return null;
  let out: string;
  try {
    out = await git.git(projectId, ["log", "--format=%H %P", `-S${needle}`, ref, "--", filePath]);
  } catch {
    return null;
  }
  const lines = out.split("\n").filter(Boolean);
  for (const line of lines) {
    const [sha, parent] = line.split(" ");
    const now = count(await fileAt(projectId, sha, filePath), needle);
    const before = parent ? count(await fileAt(projectId, parent, filePath), needle) : 0;
    if (now > before) return git.getCommit(projectId, sha);
  }
  return null;
}

async function inRange(projectId: string, commit: string, base: string | null, head: string): Promise<boolean> {
  try {
    const out = await git.git(projectId, ["rev-list", base ? `${base}..${head}` : head]);
    return out.split("\n").includes(commit);
  } catch {
    return false;
  }
}

function approvalsFor(prId: string) {
  return all<{ reviewer_name: string | null; reviewer_id: string; created_at: string }>(
    "SELECT reviewer_name, reviewer_id, created_at FROM pull_request_reviews WHERE pull_request_id = ? AND status = 'approved' ORDER BY created_at ASC",
    prId,
  ).map((r) => ({ reviewer: r.reviewer_name || r.reviewer_id, at: r.created_at }));
}

function toPr(pr: PRRow): ProvenancePullRequest {
  return {
    number: pr.pr_number,
    title: pr.title,
    status: pr.status,
    merged_at: pr.merged_at,
    merged_by: pr.merged_by,
    approvals: approvalsFor(pr.id),
  };
}

function toCommit(c: git.CommitInfo | null): ProvenanceCommit | null {
  if (!c) return null;
  return {
    hash: c.hash,
    short_hash: c.short_hash,
    message: c.message,
    author_name: c.author_name,
    timestamp: c.timestamp,
  };
}

/** A signature of the project's pull request state, so cached answers expire on reviews and merges. */
function prSignature(projectId: string): string {
  const row = get<{ n: number; u: string | null; r: number; ru: string | null }>(
    `SELECT COUNT(*) AS n, MAX(COALESCE(updated_at, created_at)) AS u,
       (SELECT COUNT(*) FROM pull_request_reviews rv JOIN pull_requests p ON p.id = rv.pull_request_id WHERE p.project_id = ?) AS r,
       (SELECT MAX(rv.created_at) FROM pull_request_reviews rv JOIN pull_requests p ON p.id = rv.pull_request_id WHERE p.project_id = ?) AS ru
     FROM pull_requests WHERE project_id = ?`,
    projectId,
    projectId,
    projectId,
  );
  return row ? `${row.n}:${row.u}:${row.r}:${row.ru}` : "";
}

async function headOf(projectId: string, branch: string): Promise<string | null> {
  try {
    return await git.resolveRef(projectId, `refs/heads/${branch}`);
  } catch {
    return null;
  }
}

interface Ctx {
  projectId: string;
  filePath: string;
  defaultBranch: string;
  branch: string;
  required: number;
  keyPrefix: string;
}

async function context(projectId: string, branch?: string | null): Promise<Ctx> {
  const project = requireProject(projectId);
  const defaultBranch = await git.getDefaultBranch(projectId);
  const b = branch || defaultBranch;
  const filePath = ontologyFilePath(project);
  const keyPrefix = [
    projectId,
    b,
    await headOf(projectId, b),
    await headOf(projectId, defaultBranch),
    prSignature(projectId),
    filePath,
  ].join("|");
  return { projectId, filePath, defaultBranch, branch: b, required: Number(project.pr_approval_required) || 0, keyPrefix };
}

async function compute(ctx: Ctx, item: ProvenanceItem): Promise<Provenance> {
  const { projectId, filePath, defaultBranch } = ctx;
  const base = { iri: item.iri, property: item.property, value: item.value };

  if (await hasValue(projectId, defaultBranch, item)) {
    const commit = await introducingCommit(projectId, `refs/heads/${defaultBranch}`, filePath, item.value);
    let pr: PRRow | null = null;
    if (commit) {
      const merged = all<PRRow>(
        "SELECT * FROM pull_requests WHERE project_id = ? AND status = 'merged' AND target_branch = ? ORDER BY merged_at ASC, pr_number ASC",
        projectId,
        defaultBranch,
      );
      for (const candidate of merged) {
        const head = candidate.head_commit_hash;
        if (!head) continue;
        if (await inRange(projectId, commit.hash, candidate.base_commit_hash, head)) {
          pr = candidate;
          break;
        }
      }
    }
    const pull_request = pr ? toPr(pr) : null;
    const approved = !!pull_request && pull_request.approvals.length >= Math.max(1, ctx.required);
    return {
      ...base,
      status: approved ? "approved" : "direct",
      introduced_in: toCommit(commit),
      pull_request,
      on_default_branch: true,
    };
  }

  // Not on the default branch: look on the requested branch, then on open pull requests' branches.
  const open = all<PRRow>(
    "SELECT * FROM pull_requests WHERE project_id = ? AND status = 'open' ORDER BY pr_number DESC",
    projectId,
  );
  const branches: string[] = [];
  if (ctx.branch !== defaultBranch) branches.push(ctx.branch);
  for (const pr of open) if (!branches.includes(pr.source_branch)) branches.push(pr.source_branch);
  for (const branch of branches) {
    if (!(await hasValue(projectId, branch, item))) continue;
    const commit = await introducingCommit(projectId, `refs/heads/${branch}`, filePath, item.value);
    const pr =
      open.find((p) => p.source_branch === branch && p.target_branch === defaultBranch) ??
      open.find((p) => p.source_branch === branch) ??
      null;
    return {
      ...base,
      status: "pending",
      introduced_in: toCommit(commit),
      pull_request: pr ? toPr(pr) : null,
      on_default_branch: false,
    };
  }
  return { ...base, status: "unknown", introduced_in: null, pull_request: null, on_default_branch: false };
}

function cacheKey(ctx: Ctx, item: ProvenanceItem): string {
  const h = crypto.createHash("sha1").update(item.value).digest("hex");
  return `${ctx.keyPrefix}|${item.iri}|${item.property}|${h}`;
}

async function lookup(ctx: Ctx, item: ProvenanceItem): Promise<Provenance> {
  const key = cacheKey(ctx, item);
  const hit = cache.get(key);
  if (hit) return hit;
  const result = await compute(ctx, item);
  cache.set(key, result);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return result;
}

export async function getProvenance(projectId: string, item: ProvenanceItem, branch?: string | null): Promise<Provenance> {
  if (!git.repoExists(projectId)) {
    return { ...item, status: "unknown", introduced_in: null, pull_request: null, on_default_branch: false };
  }
  return lookup(await context(projectId, branch), item);
}

export async function getProvenanceBatch(
  projectId: string,
  items: ProvenanceItem[],
  branch?: string | null,
): Promise<Provenance[]> {
  if (!git.repoExists(projectId)) {
    return items.map((item) => ({ ...item, status: "unknown", introduced_in: null, pull_request: null, on_default_branch: false }));
  }
  const ctx = await context(projectId, branch);
  const out: Provenance[] = [];
  for (const item of items) out.push(await lookup(ctx, item));
  return out;
}
