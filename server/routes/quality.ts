import { Hono } from "hono";
import type { Context } from "hono";
import * as git from "../git";
import { get, nowIso, run, toJson, fromJson } from "../db";
import { httpError } from "../http";
import { getJob, startJob } from "../jobs";
import { getProjectRow, loadOntology, onOntologyEvent, ontologyFilePath, requireProject, requireBranch } from "../ontology";
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

// Consistency and duplicate results describe one ontology file; drop them when the project switches files.
onOntologyEvent("quality:ontology-file-changed", (e) => {
  if (e.type !== "ontology-file-changed") return;
  run("DELETE FROM quality_results WHERE project_id = ?", e.projectId);
});

function saveResult(projectId: string, branch: string, kind: string, result: unknown, filePath: string) {
  // A check that started before the project switched ontology files doesn't save its stale result.
  const project = getProjectRow(projectId);
  if (!project || ontologyFilePath(project) !== filePath) return;
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

/**
 * Validates the project, its repository and the requested branch before a job
 * is queued, so a bad request fails with 404 here instead of as a failed job.
 */
async function requireCheckTarget(c: Context): Promise<{ projectId: string; branch: string }> {
  const projectId = c.req.param("id")!;
  requireProject(projectId);
  if (!git.repoExists(projectId)) httpError(404, "No repository found for this project");
  const branch = await requireBranch(projectId, c.req.query("branch"));
  if (!(await git.branchExists(projectId, branch))) httpError(404, `Branch not found: ${branch}`);
  return { projectId, branch };
}

function errorDetail(e: unknown): string {
  if (e && typeof e === "object" && "detail" in e) return String((e as { detail: unknown }).detail);
  return e instanceof Error ? e.message : String(e);
}

r.post("/projects/:id/quality/check", async (c) => {
  const { projectId, branch } = await requireCheckTarget(c);
  const jobId = startJob(CONSISTENCY_JOB, { projectId, branch }, async () => {
    try {
      const loaded = await loadOntology(projectId, branch);
      const result = runConsistencyCheck(loaded.store, projectId, branch);
      saveResult(projectId, branch, "consistency", result, loaded.filePath);
      return result;
    } catch (e) {
      throw new Error(errorDetail(e));
    }
  });
  return c.json({ job_id: jobId }, 202);
});

r.get("/projects/:id/quality/jobs/:jobId", (c) => jobResult(c, CONSISTENCY_JOB));

r.get("/projects/:id/quality/issues", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const branch = await requireBranch(projectId, c.req.query("branch"));
  const cached = loadResult<ConsistencyCheckResult>(projectId, branch, "consistency");
  if (cached) return c.json(cached);
  // Never checked: checked_at and duration_ms are null so this can't be mistaken for a clean result.
  return c.json({ project_id: projectId, branch, issues: [], checked_at: null, duration_ms: null });
});

r.post("/projects/:id/quality/duplicates", async (c) => {
  const { projectId, branch } = await requireCheckTarget(c);
  const threshold = queryThreshold(c);
  const jobId = startJob(DUPLICATES_JOB, { projectId, branch }, async () => {
    try {
      const loaded = await loadOntology(projectId, branch);
      const result = findDuplicates(loaded.store, indexedEntities(loaded.store), threshold);
      saveResult(projectId, branch, "duplicates", result, loaded.filePath);
      return result;
    } catch (e) {
      throw new Error(errorDetail(e));
    }
  });
  return c.json({ job_id: jobId }, 202);
});

r.get("/projects/:id/quality/duplicates/jobs/:jobId", (c) => jobResult(c, DUPLICATES_JOB));

r.get("/projects/:id/quality/duplicates/latest", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const branch = await requireBranch(projectId, c.req.query("branch"));
  const cached = loadResult<DuplicateDetectionResult>(projectId, branch, "duplicates");
  if (cached) return c.json(cached);
  // Never checked: threshold and checked_at are null so this can't be mistaken for a clean result.
  return c.json({ clusters: [], threshold: null, checked_at: null });
});

export default r;
