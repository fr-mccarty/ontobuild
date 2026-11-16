import { Hono } from "hono";
import * as git from "../git";
import { all, bool, fromJson, get, insert, newId, nowIso, run, toJson } from "../db";
import { httpError, queryBool, queryInt, readJson } from "../http";
import { getJob, listJobs, startJob, type Job } from "../jobs";
import {
  commitOntology,
  getProjectRow,
  ontologyFilePath,
  onOntologyEvent,
  requireProject,
  requireBranch, resolveBranch,
  type ProjectRow,
} from "../ontology";
import { FORMAT_NAMES, formatFromFilename, normalizeToTurtle } from "../rdf";
import { LOCAL_USER } from "../user";

const r = new Hono();

const NORMALIZE_JOB = "normalization";
const CHECK_JOB = "normalization_check";

interface NormalizationReport {
  original_format: string;
  original_filename: string;
  original_size_bytes: number;
  normalized_size_bytes: number;
  triple_count: number;
  prefixes_before: string[];
  prefixes_after: string[];
  prefixes_removed: string[];
  prefixes_added: string[];
  format_converted: boolean;
  notes: string[];
}

interface RunRow {
  id: string;
  project_id: string;
  created_at: string;
  triggered_by: string | null;
  trigger_type: string;
  report_json: string;
  is_dry_run: number;
  commit_hash: string | null;
}

async function normalize(content: string, filename: string) {
  const format = formatFromFilename(filename) ?? "turtle";
  const n = await normalizeToTurtle(content, formatFromFilename(filename) ? filename : "ontology.ttl");
  const after = new Set(n.prefixesAfter);
  const before = new Set(n.prefixesBefore);
  const removed = n.prefixesBefore.filter((p) => !after.has(p));
  const added = n.prefixesAfter.filter((p) => !before.has(p));
  const originalSize = Buffer.byteLength(content);
  const normalizedSize = Buffer.byteLength(n.turtle);
  const notes: string[] = [];
  if (format !== "turtle") notes.push(`Converted from ${FORMAT_NAMES[format]} to Turtle format`);
  if (removed.length) notes.push(`Removed ${removed.length} unused prefix(es): ${removed.join(", ")}`);
  if (added.length) notes.push(`Added ${added.length} prefix(es): ${added.join(", ")}`);
  if (n.languageTagsRemoved > 0) notes.push(`Removed language tags from ${n.languageTagsRemoved} literal(s)`);
  const diff = normalizedSize - originalSize;
  if (diff < 0) notes.push(`File size reduced by ${Math.abs(diff).toLocaleString("en-US")} bytes`);
  else if (diff > 0) notes.push(`File size increased by ${diff.toLocaleString("en-US")} bytes`);
  notes.push("Triples reordered into canonical sequence");
  notes.push("Whitespace and formatting standardized");
  const report: NormalizationReport = {
    original_format: FORMAT_NAMES[format],
    original_filename: filename,
    original_size_bytes: originalSize,
    normalized_size_bytes: normalizedSize,
    triple_count: n.store.size,
    prefixes_before: n.prefixesBefore,
    prefixes_after: n.prefixesAfter,
    prefixes_removed: removed,
    prefixes_added: added,
    format_converted: format !== "turtle",
    notes,
  };
  return { normalized: n.turtle, report };
}

async function readSource(project: ProjectRow, branchName?: string | null) {
  if (!git.repoExists(project.id)) return null;
  const branch = await resolveBranch(project.id, branchName);
  let sha: string;
  try {
    sha = await git.resolveRef(project.id, branch);
  } catch {
    return null;
  }
  const filePath = ontologyFilePath(project);
  const content = await git.readFileOrNull(project.id, sha, filePath);
  if (content === null) return null;
  return { branch, sha, filePath, content };
}

const NO_ONTOLOGY_FILE = "Project has no ontology file";

/** Reads the branch's source for a normalization run, or fails with 400 when there is no ontology file. */
async function requireSource(project: ProjectRow, branch: string) {
  const src = await readSource(project, branch);
  if (!src) httpError(400, NO_ONTOLOGY_FILE);
  return src;
}

interface CheckRow {
  project_id: string;
  commit_hash: string;
  needs_normalization: number;
  report: string | null;
  checked_at: string;
}

async function checkStatus(project: ProjectRow, branch?: string | null): Promise<CheckRow | null> {
  const src = await readSource(project, branch);
  if (!src) return null;
  const cached = get<CheckRow>("SELECT * FROM normalization_checks WHERE project_id = ?", project.id);
  if (cached && cached.commit_hash === src.sha) return cached;
  const { normalized, report } = await normalize(src.content, src.filePath);
  const needs = normalized !== src.content;
  const row: CheckRow = {
    project_id: project.id,
    commit_hash: src.sha,
    needs_normalization: needs ? 1 : 0,
    report: needs ? toJson(report) : null,
    checked_at: nowIso(),
  };
  run(
    `INSERT INTO normalization_checks (project_id, commit_hash, needs_normalization, report, checked_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET commit_hash = excluded.commit_hash, needs_normalization = excluded.needs_normalization,
       report = excluded.report, checked_at = excluded.checked_at`,
    row.project_id,
    row.commit_hash,
    row.needs_normalization,
    row.report,
    row.checked_at,
  );
  return row;
}

function lastRealRun(projectId: string) {
  return get<RunRow>(
    "SELECT * FROM normalization_runs WHERE project_id = ? AND is_dry_run = 0 ORDER BY created_at DESC LIMIT 1",
    projectId,
  );
}

function recordRun(opts: {
  projectId: string;
  triggerType: string;
  report: NormalizationReport;
  dryRun: boolean;
  commitHash: string | null;
  triggeredBy?: string | null;
}): RunRow {
  const row = {
    id: newId(),
    project_id: opts.projectId,
    created_at: nowIso(),
    triggered_by: opts.triggeredBy === undefined ? LOCAL_USER.id : opts.triggeredBy,
    trigger_type: opts.triggerType,
    report_json: JSON.stringify(opts.report),
    original_format: opts.report.original_format,
    original_size_bytes: opts.report.original_size_bytes,
    normalized_size_bytes: opts.report.normalized_size_bytes,
    triple_count: opts.report.triple_count,
    prefixes_removed_count: opts.report.prefixes_removed.length,
    prefixes_added_count: opts.report.prefixes_added.length,
    format_converted: opts.report.format_converted,
    is_dry_run: opts.dryRun,
    commit_hash: opts.commitHash,
  };
  insert("normalization_runs", row);
  return get<RunRow>("SELECT * FROM normalization_runs WHERE id = ?", row.id)!;
}

function runToResponse(r: RunRow, extra: { original_content?: string | null; normalized_content?: string | null } = {}) {
  return {
    id: r.id,
    project_id: r.project_id,
    created_at: r.created_at,
    triggered_by: r.triggered_by,
    trigger_type: r.trigger_type,
    report: fromJson<NormalizationReport | null>(r.report_json, null),
    is_dry_run: bool(r.is_dry_run),
    commit_hash: r.commit_hash,
    original_content: extra.original_content ?? null,
    normalized_content: extra.normalized_content ?? null,
  };
}

async function runNormalization(projectId: string, dryRun: boolean, branch?: string | null, triggerType = "manual") {
  const project = requireProject(projectId);
  const src = await readSource(project, branch);
  if (!src) throw new NormalizationError(NO_ONTOLOGY_FILE);
  const { normalized, report } = await normalize(src.content, src.filePath);
  const changed = normalized !== src.content;
  let commitHash: string | null = null;
  if (!dryRun && changed) {
    let message = `Normalize ontology to canonical Turtle format\n\nTrigger: ${triggerType}\nTriple count: ${report.triple_count}\n`;
    if (report.prefixes_removed.length) message += `Prefixes removed: ${report.prefixes_removed.join(", ")}\n`;
    const commit = await commitOntology({
      projectId,
      branch: src.branch,
      content: normalized,
      message,
      origin: "normalization",
    });
    commitHash = commit.hash;
  }
  const runRow = recordRun({ projectId, triggerType, report, dryRun, commitHash });
  return { run: runRow, original: dryRun ? src.content : null, normalized: dryRun ? normalized : null };
}

class NormalizationError extends Error {}

function jobToStatus(job: Job) {
  const result = job.result && typeof job.result === "object" ? (job.result as Record<string, unknown>) : null;
  return {
    job_id: job.id,
    // Same vocabulary as the jobs table, lint runs and the job's own result: pending | running | completed | failed.
    status: job.status,
    result,
    error: job.error ?? (result && typeof result.error === "string" ? result.error : null),
  };
}

onOntologyEvent("normalization:import-run", (e) => {
  if (e.type !== "commit" || e.origin !== "import") return;
  const project = getProjectRow(e.projectId);
  const report = fromJson<NormalizationReport | null>(project?.normalization_report, null);
  if (!project || !report || typeof report.original_format !== "string") return;
  recordRun({
    projectId: e.projectId,
    triggerType: "import",
    report,
    dryRun: false,
    commitHash: e.commitHash,
  });
});

r.get("/projects/:id/normalization/status", async (c) => {
  const project = requireProject(c.req.param("id"));
  const branch = await requireBranch(project.id, c.req.query("branch"));
  const last = lastRealRun(project.id);
  const base = {
    last_run: last?.created_at ?? null,
    last_run_id: last?.id ?? null,
  };
  // When the status can't be determined, needs_normalization is null and error says why.
  const unknown = (error: string) =>
    c.json({ needs_normalization: null, ...base, last_check: null, preview_report: null, error });
  let check: CheckRow | null;
  try {
    check = await checkStatus(project, branch);
  } catch (e) {
    return unknown(e instanceof Error ? e.message : String(e));
  }
  if (!check) return unknown(NO_ONTOLOGY_FILE);
  return c.json({
    needs_normalization: bool(check.needs_normalization),
    ...base,
    last_check: check.checked_at,
    preview_report: fromJson<NormalizationReport | null>(check.report, null),
    error: null,
  });
});

r.post("/projects/:id/normalization/refresh", async (c) => {
  const project = requireProject(c.req.param("id"));
  const branch = await requireBranch(project.id, c.req.query("branch"));
  const jobId = startJob(CHECK_JOB, { projectId: project.id, branch }, async () => {
    const p = requireProject(project.id);
    const check = await checkStatus(p, branch);
    const last = lastRealRun(project.id);
    return {
      project_id: project.id,
      needs_normalization: check ? bool(check.needs_normalization) : null,
      last_run: last?.created_at ?? null,
      error: check ? null : NO_ONTOLOGY_FILE,
    };
  });
  return c.json({ message: "Normalization status check queued", job_id: jobId }, 202);
});

r.post("/projects/:id/normalization/queue", async (c) => {
  const project = requireProject(c.req.param("id"));
  const body = await readJson<{ dry_run?: boolean }>(c);
  const dryRun = body.dry_run === true;
  const branch = await requireBranch(project.id, c.req.query("branch"));
  await requireSource(project, branch);
  const jobId = startJob(NORMALIZE_JOB, { projectId: project.id, branch }, async () => {
    const res = await runNormalization(project.id, dryRun, branch);
    return {
      project_id: project.id,
      run_id: res.run.id,
      dry_run: dryRun,
      commit_hash: res.run.commit_hash,
      status: "completed",
    };
  });
  return c.json({ message: "Normalization job queued", job_id: jobId, status: "queued" }, 202);
});

r.get("/projects/:id/normalization/jobs/:jobId", (c) => {
  const project = requireProject(c.req.param("id"));
  const jobId = c.req.param("jobId");
  const job = getJob(jobId);
  if (!job || job.project_id !== project.id || (job.kind !== NORMALIZE_JOB && job.kind !== CHECK_JOB)) {
    httpError(404, "Job not found or expired");
  }
  return c.json(jobToStatus(job));
});

r.get("/projects/:id/normalization/jobs", (c) => {
  const project = requireProject(c.req.param("id"));
  const jobs = [
    ...listJobs({ kind: NORMALIZE_JOB, projectId: project.id, limit: 10 }),
    ...listJobs({ kind: CHECK_JOB, projectId: project.id, limit: 10 }),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return c.json(jobs.slice(0, 10).map((j) => jobToStatus(j)));
});

r.post("/projects/:id/normalization", async (c) => {
  const project = requireProject(c.req.param("id"));
  const body = await readJson<{ dry_run?: boolean }>(c);
  const branch = await requireBranch(project.id, c.req.query("branch"));
  await requireSource(project, branch);
  try {
    const res = await runNormalization(project.id, body.dry_run === true, branch);
    return c.json(runToResponse(res.run, { original_content: res.original, normalized_content: res.normalized }));
  } catch (e) {
    if (e instanceof NormalizationError) httpError(400, e.message);
    if (e && typeof e === "object" && "status" in e) throw e;
    httpError(500, `Normalization failed: ${e instanceof Error ? e.message : String(e)}`);
  }
});

r.get("/projects/:id/normalization/history", (c) => {
  const project = requireProject(c.req.param("id"));
  const limit = queryInt(c, "limit", 10, { min: 1, max: 50 });
  const includeDry = queryBool(c, "include_dry_runs", false);
  const rows = all<RunRow>(
    `SELECT * FROM normalization_runs WHERE project_id = ? ${includeDry ? "" : "AND is_dry_run = 0"} ORDER BY created_at DESC LIMIT ?`,
    project.id,
    limit,
  );
  const items = rows.map((r) => runToResponse(r));
  const total = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM normalization_runs WHERE project_id = ? ${includeDry ? "" : "AND is_dry_run = 0"}`,
    project.id,
  )!.n;
  return c.json({ items, total: Number(total) });
});

r.get("/projects/:id/normalization/runs/:runId", (c) => {
  const project = requireProject(c.req.param("id"));
  const row = get<RunRow>(
    "SELECT * FROM normalization_runs WHERE project_id = ? AND id = ?",
    project.id,
    c.req.param("runId"),
  );
  if (!row) httpError(404, "Normalization run not found");
  return c.json(runToResponse(row));
});

export default r;
