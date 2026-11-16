import { Hono } from "hono";
import type { Context } from "hono";
import * as git from "../git";
import { all, get, insert, newId, nowIso, run, transaction, update } from "../db";
import { httpError, noContent, queryInt, readJson } from "../http";
import { LOCAL_USER } from "../user";
import { emitOntologyEvent, enforcePlainLiterals, requireProject } from "../ontology";

const r = new Hono();

const AUTHOR = { name: LOCAL_USER.name, email: LOCAL_USER.email };
const REVIEW_STATUSES = ["approved", "changes_requested", "commented"] as const;

interface PRRow {
  id: string;
  project_id: string;
  pr_number: number;
  title: string;
  description: string | null;
  source_branch: string;
  target_branch: string;
  status: string;
  author_id: string;
  author_name: string | null;
  author_email: string | null;
  merged_by: string | null;
  merged_at: string | null;
  merge_commit_hash: string | null;
  base_commit_hash: string | null;
  head_commit_hash: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ReviewRow {
  id: string;
  pull_request_id: string;
  reviewer_id: string;
  reviewer_name: string | null;
  reviewer_email: string | null;
  status: string;
  body: string | null;
  created_at: string;
}

interface CommentRow {
  id: string;
  pull_request_id: string;
  author_id: string;
  author_name: string | null;
  author_email: string | null;
  body: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string | null;
}

function prNumberParam(c: Context): number {
  const raw = c.req.param("prNumber") ?? "";
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n)) httpError(422, "pr_number must be an integer");
  return n;
}

/**
 * Resolves the project and pull request named in the path, in that order: an unknown
 * project is 404 before a malformed PR number is 422.
 */
function loadPr(c: Context) {
  const id = c.req.param("id")!;
  const project = requireProject(id);
  const n = prNumberParam(c);
  const pr = requirePr(id, n);
  return { id, project, n, pr };
}

const PR_STATUSES = ["open", "closed", "merged"];

function requirePr(projectId: string, prNumber: number): PRRow {
  const pr = get<PRRow>("SELECT * FROM pull_requests WHERE project_id = ? AND pr_number = ?", projectId, prNumber);
  if (!pr) httpError(404, "Pull request not found");
  return pr;
}

function user(id: string | null, name?: string | null, email?: string | null) {
  if (!id) return null;
  if (id === LOCAL_USER.id) return { id, name: name ?? LOCAL_USER.name, email: email ?? LOCAL_USER.email };
  return { id, name: name ?? null, email: email ?? null };
}

async function commitsAhead(projectId: string, pr: PRRow): Promise<number> {
  if (!git.repoExists(projectId)) return 0;
  return (await git.getCommitsBetween(projectId, `refs/heads/${pr.target_branch}`, `refs/heads/${pr.source_branch}`))
    .length;
}

async function toPrResponse(pr: PRRow, approvalRequired: number) {
  const counts = get<{ review_count: number; approval_count: number }>(
    `SELECT COUNT(*) AS review_count, COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0) AS approval_count
     FROM pull_request_reviews WHERE pull_request_id = ?`,
    pr.id,
  )!;
  const commentCount = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM pull_request_comments WHERE pull_request_id = ?",
    pr.id,
  )!.n;
  const approvalCount = Number(counts.approval_count);
  const ahead = await commitsAhead(pr.project_id, pr);
  return {
    id: pr.id,
    project_id: pr.project_id,
    pr_number: pr.pr_number,
    title: pr.title,
    description: pr.description,
    source_branch: pr.source_branch,
    target_branch: pr.target_branch,
    status: pr.status,
    author_id: pr.author_id,
    author: user(pr.author_id, pr.author_name, pr.author_email),
    merged_by: pr.merged_by,
    merged_by_user: user(pr.merged_by),
    merged_at: pr.merged_at,
    merge_commit_hash: pr.merge_commit_hash,
    base_commit_hash: pr.base_commit_hash,
    head_commit_hash: pr.head_commit_hash,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    review_count: Number(counts.review_count),
    approval_count: approvalCount,
    comment_count: Number(commentCount),
    commits_ahead: ahead,
    can_merge: pr.status === "open" && ahead > 0 && approvalCount >= approvalRequired,
  };
}

async function prResponse(projectId: string, prNumber: number) {
  const project = requireProject(projectId);
  return toPrResponse(requirePr(projectId, prNumber), Number(project.pr_approval_required) || 0);
}

function toReviewResponse(r: ReviewRow) {
  return {
    id: r.id,
    pull_request_id: r.pull_request_id,
    reviewer_id: r.reviewer_id,
    reviewer: user(r.reviewer_id, r.reviewer_name, r.reviewer_email),
    status: r.status,
    body: r.body,
    created_at: r.created_at,
  };
}

type CommentResponse = ReturnType<typeof commentBase> & { replies: CommentResponse[] };

function commentBase(c: CommentRow) {
  return {
    id: c.id,
    pull_request_id: c.pull_request_id,
    author_id: c.author_id,
    author: user(c.author_id, c.author_name, c.author_email),
    body: c.body,
    parent_id: c.parent_id,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

function toCommentResponse(c: CommentRow, byParent?: Map<string, CommentRow[]>): CommentResponse {
  const children =
    byParent?.get(c.id) ??
    (byParent
      ? []
      : all<CommentRow>(
          "SELECT * FROM pull_request_comments WHERE parent_id = ? ORDER BY created_at ASC",
          c.id,
        ));
  return { ...commentBase(c), replies: children.map((ch) => toCommentResponse(ch, byParent)) };
}

function requireComment(prId: string, commentId: string): CommentRow {
  const row = get<CommentRow>(
    "SELECT * FROM pull_request_comments WHERE id = ? AND pull_request_id = ?",
    commentId,
    prId,
  );
  if (!row) httpError(404, "Comment not found");
  return row;
}

function optionalString(body: Record<string, unknown>, field: string, opts: { min?: number; max?: number } = {}) {
  const v = body[field];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") httpError(422, `Field '${field}' must be a string`);
  if (opts.min !== undefined && v.length < opts.min)
    httpError(422, `Field '${field}' must be at least ${opts.min} characters`);
  if (opts.max !== undefined && v.length > opts.max)
    httpError(422, `Field '${field}' must be at most ${opts.max} characters`);
  return v;
}

/** Like optionalString, but distinguishes an explicit null (returned as null, meaning "clear") from absent (undefined). */
function nullableString(body: Record<string, unknown>, field: string) {
  if (body[field] === null) return null;
  return optionalString(body, field);
}

function prRefs(pr: PRRow): [string, string] {
  if (pr.status === "merged" && pr.base_commit_hash && pr.head_commit_hash)
    return [pr.base_commit_hash, pr.head_commit_hash];
  return [pr.target_branch, pr.source_branch];
}

const CHANGE_TYPES: Record<string, string> = { A: "added", M: "modified", D: "deleted", R: "renamed" };

r.get("/projects/pull-requests/open-summary", (c) => {
  const rows = all<{ project_id: string; project_name: string; open_count: number }>(
    `SELECT pr.project_id AS project_id, p.name AS project_name, COUNT(*) AS open_count
     FROM pull_requests pr JOIN projects p ON p.id = pr.project_id
     WHERE pr.status = 'open'
     GROUP BY pr.project_id, p.name
     ORDER BY p.name`,
  );
  const byProject = rows.map((row) => ({ ...row, open_count: Number(row.open_count) }));
  return c.json({ total_open: byProject.reduce((s, p) => s + p.open_count, 0), by_project: byProject });
});

r.get("/projects/:id/pull-requests", async (c) => {
  const id = c.req.param("id");
  const project = requireProject(id);
  const status = c.req.query("status");
  if (status && !PR_STATUSES.includes(status))
    httpError(422, `Query parameter 'status' must be one of: ${PR_STATUSES.join(", ")}`);
  const authorId = c.req.query("author_id");
  const skip = queryInt(c, "skip", 0, { min: 0 });
  const limit = queryInt(c, "limit", 20, { min: 1, max: 100 });

  const where = ["project_id = ?"];
  const params: string[] = [id];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (authorId) {
    where.push("author_id = ?");
    params.push(authorId);
  }
  const total = Number(
    get<{ n: number }>(`SELECT COUNT(*) AS n FROM pull_requests WHERE ${where.join(" AND ")}`, ...params)!.n,
  );
  const rows = all<PRRow>(
    `SELECT * FROM pull_requests WHERE ${where.join(" AND ")} ORDER BY created_at DESC, pr_number DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    skip,
  );
  const required = Number(project.pr_approval_required) || 0;
  const items = [];
  for (const pr of rows) items.push(await toPrResponse(pr, required));
  return c.json({ items, total, skip, limit });
});

r.post("/projects/:id/pull-requests", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const body = await readJson<Record<string, unknown>>(c);
  const title = optionalString(body, "title", { min: 1, max: 500 });
  if (title === undefined) httpError(422, "Field 'title' is required");
  const description = nullableString(body, "description") ?? null;
  const source = optionalString(body, "source_branch", { min: 1, max: 255 });
  if (source === undefined) httpError(422, "Field 'source_branch' is required");
  const target = optionalString(body, "target_branch", { min: 1, max: 255 }) ?? "main";

  const branchNames = git.repoExists(id) ? await git.listBranchNames(id) : [];
  if (!branchNames.includes(source)) httpError(400, `Source branch '${source}' does not exist`);
  if (!branchNames.includes(target)) httpError(400, `Target branch '${target}' does not exist`);
  if (source === target) httpError(400, "Source and target branches must be different");

  const prId = newId();
  transaction(() => {
    const next =
      Number(get<{ n: number | null }>("SELECT MAX(pr_number) AS n FROM pull_requests WHERE project_id = ?", id)!.n ?? 0) +
      1;
    insert("pull_requests", {
      id: prId,
      project_id: id,
      pr_number: next,
      title,
      description,
      source_branch: source,
      target_branch: target,
      status: "open",
      author_id: LOCAL_USER.id,
      author_name: LOCAL_USER.name,
      author_email: LOCAL_USER.email,
      created_at: nowIso(),
    });
  });
  const pr = get<PRRow>("SELECT * FROM pull_requests WHERE id = ?", prId)!;
  return c.json(await prResponse(id, pr.pr_number), 201);
});

r.get("/projects/:id/pull-requests/:prNumber", async (c) => {
  const { project, pr } = loadPr(c);
  return c.json(await toPrResponse(pr, Number(project.pr_approval_required) || 0));
});

r.patch("/projects/:id/pull-requests/:prNumber", async (c) => {
  const { id, n, pr } = loadPr(c);
  const body = await readJson<Record<string, unknown>>(c);
  const title = optionalString(body, "title", { min: 1, max: 500 });
  const description = nullableString(body, "description");
  if (pr.status !== "open") httpError(409, "Cannot update a closed or merged pull request");
  const set: Record<string, string | null> = { updated_at: nowIso() };
  if (title !== undefined) set.title = title;
  if (description !== undefined) set.description = description;
  update("pull_requests", set, { id: pr.id });
  return c.json(await prResponse(id, n));
});

r.post("/projects/:id/pull-requests/:prNumber/close", async (c) => {
  const { id, n, pr } = loadPr(c);
  if (pr.status !== "open") httpError(409, "Pull request is already closed or merged");
  update("pull_requests", { status: "closed", updated_at: nowIso() }, { id: pr.id });
  return c.json(await prResponse(id, n));
});

r.post("/projects/:id/pull-requests/:prNumber/reopen", async (c) => {
  const { id, n, pr } = loadPr(c);
  if (pr.status !== "closed") httpError(409, "Only closed pull requests can be reopened");
  update("pull_requests", { status: "open", updated_at: nowIso() }, { id: pr.id });
  return c.json(await prResponse(id, n));
});

r.post("/projects/:id/pull-requests/:prNumber/merge", async (c) => {
  const { id, n, project, pr } = loadPr(c);
  const body = await readJson<Record<string, unknown>>(c);
  const mergeMessage = optionalString(body, "merge_message") || `Merge pull request #${n}: ${pr.title}`;
  const deleteSource = body.delete_source_branch === true;

  if (!git.repoExists(id)) httpError(404, "No repository found for this project");
  if (pr.status !== "open") httpError(409, "Pull request is not open");
  const required = Number(project.pr_approval_required) || 0;
  const approvals = Number(
    get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM pull_request_reviews WHERE pull_request_id = ? AND status = 'approved'",
      pr.id,
    )!.n,
  );
  if (approvals < required)
    httpError(400, `Pull request requires ${required} approvals, but has ${approvals}`);

  const branches = new Map((await git.listBranches(id)).map((b) => [b.name, b]));
  const base = branches.get(pr.target_branch);
  const head = branches.get(pr.source_branch);
  if (!base) httpError(400, `Target branch '${pr.target_branch}' does not exist`);
  if (!head) httpError(400, `Source branch '${pr.source_branch}' does not exist`);
  // Refuse rather than mark the PR merged with no merge commit: the PR stays open
  // (and can be closed) when the target already contains every source commit.
  if ((await commitsAhead(id, pr)) === 0) {
    httpError(409, `Nothing to merge: '${pr.target_branch}' already contains all commits from '${pr.source_branch}'`);
  }

  const result = await git.mergeBranch(id, pr.source_branch, pr.target_branch, {
    message: mergeMessage,
    author: AUTHOR,
  });
  if (!result.success) {
    const files = result.conflicts.length ? ` (conflicting files: ${result.conflicts.join(", ")})` : "";
    httpError(409, `Merge failed: ${result.message}${files}`);
  }

  const mergedAt = nowIso();
  update(
    "pull_requests",
    {
      status: "merged",
      merged_by: LOCAL_USER.id,
      merged_at: mergedAt,
      merge_commit_hash: result.merge_commit_hash,
      base_commit_hash: base.commit_hash,
      head_commit_hash: head.commit_hash,
      updated_at: mergedAt,
    },
    { id: pr.id },
  );
  update("projects", { updated_at: mergedAt }, { id });

  if (result.merge_commit_hash && result.merge_commit_hash !== base.commit_hash) {
    await emitOntologyEvent({
      type: "commit",
      projectId: id,
      branch: pr.target_branch,
      commitHash: result.merge_commit_hash,
      parentHash: base.commit_hash,
      message: mergeMessage,
      origin: "merge",
    });
    try {
      await enforcePlainLiterals(id, pr.target_branch);
    } catch (e) {
      console.warn("[ontokit] failed to strip language tags after merge:", e);
    }
  }

  if (deleteSource) {
    try {
      await git.deleteBranch(id, pr.source_branch);
      run("DELETE FROM branch_metadata WHERE project_id = ? AND branch_name = ?", id, pr.source_branch);
      if (project.preferred_branch === pr.source_branch) update("projects", { preferred_branch: null }, { id });
      await emitOntologyEvent({ type: "branch-deleted", projectId: id, branch: pr.source_branch });
    } catch (e) {
      console.warn("[ontokit] failed to delete source branch after merge:", e);
    }
  }

  return c.json({
    success: true,
    message: "Pull request merged successfully",
    merged_at: mergedAt,
    merge_commit_hash: result.merge_commit_hash,
  });
});

r.get("/projects/:id/pull-requests/:prNumber/reviews", (c) => {
  const { pr } = loadPr(c);
  const items = all<ReviewRow>(
    "SELECT * FROM pull_request_reviews WHERE pull_request_id = ? ORDER BY created_at ASC",
    pr.id,
  ).map(toReviewResponse);
  return c.json({ items, total: items.length });
});

r.post("/projects/:id/pull-requests/:prNumber/reviews", async (c) => {
  const { pr } = loadPr(c);
  const body = await readJson<Record<string, unknown>>(c);
  const status = body.status;
  if (typeof status !== "string" || !(REVIEW_STATUSES as readonly string[]).includes(status))
    httpError(422, `Field 'status' must be one of: ${REVIEW_STATUSES.join(", ")}`);
  const text = optionalString(body, "body") ?? null;
  if (pr.status !== "open") httpError(409, "Cannot review a closed or merged pull request");
  const reviewId = newId();
  insert("pull_request_reviews", {
    id: reviewId,
    pull_request_id: pr.id,
    reviewer_id: LOCAL_USER.id,
    reviewer_name: LOCAL_USER.name,
    reviewer_email: LOCAL_USER.email,
    status,
    body: text,
    created_at: nowIso(),
  });
  update("pull_requests", { updated_at: nowIso() }, { id: pr.id });
  return c.json(toReviewResponse(get<ReviewRow>("SELECT * FROM pull_request_reviews WHERE id = ?", reviewId)!), 201);
});

r.get("/projects/:id/pull-requests/:prNumber/comments", (c) => {
  const { pr } = loadPr(c);
  const rows = all<CommentRow>(
    "SELECT * FROM pull_request_comments WHERE pull_request_id = ? ORDER BY created_at ASC",
    pr.id,
  );
  const byParent = new Map<string, CommentRow[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const list = byParent.get(row.parent_id) ?? [];
    list.push(row);
    byParent.set(row.parent_id, list);
  }
  const items = rows.filter((row) => !row.parent_id).map((row) => toCommentResponse(row, byParent));
  // total counts replies too, matching the PR's comment_count; items holds only top-level threads.
  return c.json({ items, total: rows.length });
});

// Comments are a discussion and stay open on closed and merged PRs (unlike reviews, which need an open PR).
r.post("/projects/:id/pull-requests/:prNumber/comments", async (c) => {
  const { pr } = loadPr(c);
  const body = await readJson<Record<string, unknown>>(c);
  const text = optionalString(body, "body", { min: 1 });
  if (text === undefined) httpError(422, "Field 'body' is required");
  const parentId = optionalString(body, "parent_id") ?? null;
  if (parentId) requireCommentOr404Parent(pr.id, parentId);
  const commentId = newId();
  insert("pull_request_comments", {
    id: commentId,
    pull_request_id: pr.id,
    author_id: LOCAL_USER.id,
    author_name: LOCAL_USER.name,
    author_email: LOCAL_USER.email,
    body: text,
    parent_id: parentId,
    created_at: nowIso(),
  });
  return c.json(toCommentResponse(requireComment(pr.id, commentId)), 201);
});

function requireCommentOr404Parent(prId: string, parentId: string) {
  const row = get("SELECT id FROM pull_request_comments WHERE id = ? AND pull_request_id = ?", parentId, prId);
  if (!row) httpError(404, "Parent comment not found");
}

r.patch("/projects/:id/pull-requests/:prNumber/comments/:commentId", async (c) => {
  const { pr } = loadPr(c);
  const comment = requireComment(pr.id, c.req.param("commentId"));
  const body = await readJson<Record<string, unknown>>(c);
  const text = optionalString(body, "body", { min: 1 });
  if (text === undefined) httpError(422, "Field 'body' is required");
  update("pull_request_comments", { body: text, updated_at: nowIso() }, { id: comment.id });
  return c.json(toCommentResponse(requireComment(pr.id, comment.id)));
});

r.delete("/projects/:id/pull-requests/:prNumber/comments/:commentId", (c) => {
  const { pr } = loadPr(c);
  const comment = requireComment(pr.id, c.req.param("commentId"));
  run("DELETE FROM pull_request_comments WHERE id = ?", comment.id);
  return noContent(c);
});

r.get("/projects/:id/pull-requests/:prNumber/commits", async (c) => {
  const { id, pr } = loadPr(c);
  const [from, to] = prRefs(pr);
  const commits = git.repoExists(id) ? await git.getCommitsBetween(id, from, to) : [];
  const items = commits.map((cm) => ({
    hash: cm.hash,
    short_hash: cm.short_hash,
    message: cm.message,
    author_name: cm.author_name,
    author_email: cm.author_email,
    timestamp: cm.timestamp,
  }));
  return c.json({ items, total: items.length });
});

r.get("/projects/:id/pull-requests/:prNumber/diff", async (c) => {
  const { id, pr } = loadPr(c);
  const [from, to] = prRefs(pr);
  let info: git.DiffInfo;
  try {
    if (!git.repoExists(id)) throw new Error("No repository found for this project");
    info = await git.diff(id, from, to);
  } catch (e) {
    if (pr.status === "merged") return c.json({ files: [], total_additions: 0, total_deletions: 0, files_changed: 0 });
    httpError(400, `Cannot compute diff: ${(e as Error).message}`);
  }
  return c.json({
    files: info.changes.map((ch) => ({
      path: ch.path,
      change_type: CHANGE_TYPES[ch.change_type] ?? "modified",
      old_path: ch.old_path,
      additions: ch.additions,
      deletions: ch.deletions,
      patch: ch.patch,
    })),
    total_additions: info.total_additions,
    total_deletions: info.total_deletions,
    files_changed: info.files_changed,
  });
});

r.get("/projects/:id/pr-settings", (c) => {
  const project = requireProject(c.req.param("id"));
  return c.json({ pr_approval_required: Number(project.pr_approval_required) || 0 });
});

r.patch("/projects/:id/pr-settings", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const body = await readJson<Record<string, unknown>>(c);
  const v = body.pr_approval_required;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
    httpError(422, "pr_approval_required must be an integer >= 0");
  update("projects", { pr_approval_required: v, updated_at: nowIso() }, { id });
  return c.json({ pr_approval_required: v });
});

export default r;
