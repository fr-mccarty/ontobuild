import { Hono } from "hono";
import type { Context } from "hono";
import { get, nowIso, run, toJson, fromJson } from "../db";
import { httpError } from "../http";
import { getJob, startJob } from "../jobs";
import { loadOntology, requireProject, resolveBranch } from "../ontology";
import {
  findDuplicates,
  indexedEntities,
  runConsistencyCheck,
  type ConsistencyCheckResult,
  type DuplicateDetectionResult,
} from "../quality";

const r = new Hono();

const CONSISTENCY_JOB = "quality_consistency";
const DUPLICATES_JOB = "quality_duplicates";

function saveResult(projectId: string, branch: string, kind: string, result: unknown) {
  run(
    `INSERT INTO quality_results (project_id, branch, kind, result, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id, branch, kind) DO UPDATE SET result = excluded.result, created_at = excluded.created_at`,
    projectId,
    branch,
    kind,
    toJson(result),
    nowIso(),
  );
}

function loadResult<T>(projectId: string, branch: string, kind: string): T | null {
  const row = get<{ result: string }>(
    "SELECT result FROM quality_results WHERE project_id = ? AND branch = ? AND kind = ?",
    projectId,
    branch,
    kind,
  );
  return row ? fromJson<T | null>(row.result, null) : null;
}

function queryThreshold(c: Context): number {
  const raw = c.req.query("threshold");
  if (raw === undefined || raw === "") return 0.85;
  const n = Number(raw);
  if (!Number.isFinite(n)) httpError(422, "Query parameter 'threshold' must be a number");
  if (n < 0.5) httpError(422, "Query parameter 'threshold' must be >= 0.5");
  if (n > 1) httpError(422, "Query parameter 'threshold' must be <= 1.0");
  return n;
}

function jobResult(c: Context, kind: string) {
  const projectId = c.req.param("id")!;
  requireProject(projectId);
  const jobId = c.req.param("jobId")!;
  const job = getJob(jobId);
  if (!job || job.kind !== kind || job.project_id !== projectId) {
    httpError(404, "Job result not found or expired");
  }
  if (job.status === "pending" || job.status === "running") {
    return c.json({ job_id: jobId, status: "pending" }, 202);
  }
  if (job.status === "failed") httpError(500, `Job failed: ${job.error || "Unknown error"}`);
  return c.json(job.result as object);
}

function errorDetail(e: unknown): string {
  if (e && typeof e === "object" && "detail" in e) return String((e as { detail: unknown }).detail);
  return e instanceof Error ? e.message : String(e);
}

r.post("/projects/:id/quality/check", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const branch = await resolveBranch(projectId, c.req.query("branch"));
  const jobId = startJob(CONSISTENCY_JOB, { projectId, branch }, async () => {
    try {
      const loaded = await loadOntology(projectId, branch);
      const result = runConsistencyCheck(loaded.store, projectId, branch);
      saveResult(projectId, branch, "consistency", result);
      return result;
    } catch (e) {
      throw new Error(errorDetail(e));
    }
  });
  return c.json({ job_id: jobId });
});

r.get("/projects/:id/quality/jobs/:jobId", (c) => jobResult(c, CONSISTENCY_JOB));

r.get("/projects/:id/quality/issues", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const branch = await resolveBranch(projectId, c.req.query("branch"));
  const cached = loadResult<ConsistencyCheckResult>(projectId, branch, "consistency");
  if (cached) return c.json(cached);
  return c.json({ project_id: projectId, branch, issues: [], checked_at: nowIso(), duration_ms: 0 });
});

r.post("/projects/:id/quality/duplicates", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const branch = await resolveBranch(projectId, c.req.query("branch"));
  const threshold = queryThreshold(c);
  const jobId = startJob(DUPLICATES_JOB, { projectId, branch }, async () => {
    try {
      const loaded = await loadOntology(projectId, branch);
      const result = findDuplicates(loaded.store, indexedEntities(loaded.store), threshold);
      saveResult(projectId, branch, "duplicates", result);
      return result;
    } catch (e) {
      throw new Error(errorDetail(e));
    }
  });
  return c.json({ job_id: jobId });
});

r.get("/projects/:id/quality/duplicates/jobs/:jobId", (c) => jobResult(c, DUPLICATES_JOB));

r.get("/projects/:id/quality/duplicates/latest", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const branch = await resolveBranch(projectId, c.req.query("branch"));
  const cached = loadResult<DuplicateDetectionResult>(projectId, branch, "duplicates");
  if (cached) return c.json(cached);
  return c.json({ clusters: [], threshold: 0.85, checked_at: nowIso() });
});

export default r;
