/**
 * In-process background jobs (replaces ARQ/Redis). A job is an async function run on
 * the next tick; its status/progress/result are tracked in the `jobs` table so status
 * endpoints can be polled. Jobs do not survive a server restart (running jobs are
 * marked failed on startup).
 */
import { all, fromJson, get, insert, newId, nowIso, run, toJson, update } from "./db";

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface Job<R = unknown> {
  id: string;
  kind: string;
  project_id: string | null;
  branch: string | null;
  status: JobStatus;
  progress: number | null;
  message: string | null;
  result: R | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobContext {
  id: string;
  /** Update progress (0..1 or any number you like) and an optional message. */
  setProgress(progress: number | null, message?: string): void;
}

interface JobRow extends Omit<Job, "result"> {
  result: string | null;
}

function toJob<R>(r: JobRow): Job<R> {
  return { ...r, result: fromJson<R | null>(r.result, null) };
}

const g = globalThis as typeof globalThis & { __ontokitJobsInit?: boolean };
function init() {
  if (g.__ontokitJobsInit) return;
  g.__ontokitJobsInit = true;
  run(
    "UPDATE jobs SET status = 'failed', error = 'Server restarted', finished_at = ? WHERE status IN ('pending','running')",
    nowIso(),
  );
}

/**
 * Start a job. Returns the job id immediately; `fn` runs asynchronously.
 * Its resolved value is stored as JSON `result`; a thrown error marks it failed.
 */
export function startJob<R>(
  kind: string,
  opts: { projectId?: string | null; branch?: string | null; id?: string },
  fn: (ctx: JobContext) => Promise<R>,
): string {
  init();
  const id = opts.id ?? newId();
  insert("jobs", {
    id,
    kind,
    project_id: opts.projectId ?? null,
    branch: opts.branch ?? null,
    status: "pending",
    created_at: nowIso(),
  });
  const ctx: JobContext = {
    id,
    setProgress(progress, message) {
      update("jobs", { progress, message: message ?? null }, { id });
    },
  };
  setImmediate(async () => {
    update("jobs", { status: "running", started_at: nowIso() }, { id });
    try {
      const result = await fn(ctx);
      update("jobs", { status: "completed", result: toJson(result), finished_at: nowIso() }, { id });
    } catch (e) {
      console.warn(`[ontokit] job ${kind} ${id} failed:`, e);
      update(
        "jobs",
        { status: "failed", error: e instanceof Error ? e.message : String(e), finished_at: nowIso() },
        { id },
      );
    }
  });
  return id;
}

export function getJob<R = unknown>(id: string): Job<R> | null {
  const r = get<JobRow>("SELECT * FROM jobs WHERE id = ?", id);
  return r ? toJob<R>(r) : null;
}

/** Most recent job of a kind for a project (optionally a branch). */
export function latestJob<R = unknown>(kind: string, projectId: string, branch?: string | null): Job<R> | null {
  const r =
    branch === undefined
      ? get<JobRow>("SELECT * FROM jobs WHERE kind = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1", kind, projectId)
      : get<JobRow>(
          "SELECT * FROM jobs WHERE kind = ? AND project_id = ? AND branch IS ? ORDER BY created_at DESC LIMIT 1",
          kind,
          projectId,
          branch,
        );
  return r ? toJob<R>(r) : null;
}

export function listJobs<R = unknown>(filter: { kind?: string; projectId?: string; limit?: number } = {}): Job<R>[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.kind) {
    where.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.projectId) {
    where.push("project_id = ?");
    params.push(filter.projectId);
  }
  const sql = `SELECT * FROM jobs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ${filter.limit ?? 50}`;
  return all<JobRow>(sql, ...params).map((r) => toJob<R>(r));
}

/** True if a job of this kind is pending/running for the project (and branch, if given). */
export function isJobActive(kind: string, projectId: string, branch?: string | null): boolean {
  const j = latestJob(kind, projectId, branch);
  return !!j && (j.status === "pending" || j.status === "running");
}
