import { Hono } from "hono";
import * as git from "../git";
import { all, fromJson, get, getDb, insert, newId, nowIso, run, toJson, transaction, update } from "../db";
import { httpError, noContent, queryBool, queryInt, readJson } from "../http";
import { startJob } from "../jobs";
import { loadOntology, onOntologyEvent, requireProject, requireBranch } from "../ontology";
import {
  ALL_RULE_IDS,
  REMOVED_RULE_IDS,
  LINT_LEVEL_DEFINITIONS,
  getAvailableRules,
  getRulesForLevel,
  lintOntology,
} from "../linter";

const r = new Hono();

// Lint results describe one ontology file. When the project switches files they no longer apply,
// so the runs and their issues go (a run still in progress fails instead of saving them).
// The lint configuration is a project setting and is kept.
onOntologyEvent("lint:ontology-file-changed", (e) => {
  if (e.type !== "ontology-file-changed") return;
  run("DELETE FROM lint_runs WHERE project_id = ?", e.projectId);
});

interface LintRunRow {
  id: string;
  project_id: string;
  status: string;
  branch: string | null;
  started_at: string;
  completed_at: string | null;
  issues_found: number | null;
  error_message: string | null;
}

interface LintIssueRow {
  id: string;
  run_id: string;
  project_id: string;
  issue_type: string;
  rule_id: string;
  message: string;
  subject_iri: string | null;
  subject_type: string | null;
  details: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface LintConfigRow {
  project_id: string;
  lint_level: number | null;
  enabled_rules: string | null;
  updated_at: string;
}

const g = globalThis as typeof globalThis & { __ontobuildLintInit?: boolean };
function init() {
  if (g.__ontobuildLintInit) return;
  g.__ontobuildLintInit = true;
  run(
    "UPDATE lint_runs SET status = 'failed', error_message = 'Server restarted', completed_at = ? WHERE status IN ('pending','running')",
    nowIso(),
  );
}

function runToResponse(r: LintRunRow) {
  return {
    status: r.status,
    id: r.id,
    project_id: r.project_id,
    branch: r.branch,
    started_at: r.started_at,
    completed_at: r.completed_at,
    issues_found: r.issues_found,
    error_message: r.error_message,
  };
}

function issueToResponse(i: LintIssueRow) {
  return {
    issue_type: i.issue_type,
    rule_id: i.rule_id,
    message: i.message,
    subject_iri: i.subject_iri,
    subject_type: i.subject_type,
    details: fromJson<Record<string, unknown> | null>(i.details, null),
    id: i.id,
    run_id: i.run_id,
    project_id: i.project_id,
    created_at: i.created_at,
    resolved_at: i.resolved_at,
  };
}

const ISSUE_TYPES = ["error", "warning", "info"];
const SEVERITY_ORDER = "CASE issue_type WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END";
const KNOWN_RULES_SQL = `rule_id IN (${[...ALL_RULE_IDS].map((id) => `'${id.replace(/'/g, "''")}'`).join(",")})`;

function getConfigRow(projectId: string): LintConfigRow | undefined {
  return get<LintConfigRow>("SELECT * FROM project_lint_configs WHERE project_id = ?", projectId);
}

export function enabledRuleIds(cfg: LintConfigRow | undefined): Set<string> | null {
  if (!cfg) return null;
  if (cfg.lint_level !== null && cfg.lint_level !== undefined) return new Set(getRulesForLevel(cfg.lint_level));
  if (cfg.enabled_rules !== null && cfg.enabled_rules !== undefined) {
    return new Set(
      cfg.enabled_rules
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s && ALL_RULE_IDS.has(s)),
    );
  }
  return null;
}

function serializeConfig(projectId: string, cfg: LintConfigRow | undefined) {
  if (!cfg) {
    return {
      project_id: projectId,
      lint_level: null,
      enabled_rules: null,
      effective_rules: [...ALL_RULE_IDS].sort(),
      updated_at: null,
    };
  }
  const effective = enabledRuleIds(cfg);
  const enabledList =
    cfg.enabled_rules === null
      ? null
      : cfg.enabled_rules
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && ALL_RULE_IDS.has(s))
          .sort();
  return {
    project_id: projectId,
    lint_level: cfg.lint_level,
    enabled_rules: enabledList,
    effective_rules: effective ? [...effective].sort() : [...ALL_RULE_IDS].sort(),
    updated_at: cfg.updated_at,
  };
}

async function executeLintRun(projectId: string, runId: string, branch: string) {
  update("lint_runs", { status: "running" }, { id: runId });
  try {
    const loaded = await loadOntology(projectId, branch);
    const enabled = enabledRuleIds(getConfigRow(projectId));
    const results = lintOntology(loaded.store, { enabledRules: enabled, prefixes: loaded.prefixes });
    const now = nowIso();
    transaction(() => {
      const stmt = getDb().prepare(
        `INSERT INTO lint_issues (id, run_id, project_id, issue_type, rule_id, message, subject_iri, subject_type, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const i of results) {
        stmt.run(
          newId(),
          runId,
          projectId,
          i.issue_type,
          i.rule_id,
          i.message,
          i.subject_iri,
          i.subject_type,
          toJson(i.details),
          now,
        );
      }
      update(
        "lint_runs",
        { status: "completed", completed_at: nowIso(), issues_found: results.length },
        { id: runId },
      );
    });
    return { run_id: runId, issues_found: results.length, status: "completed" };
  } catch (e) {
    const detail =
      e && typeof e === "object" && "detail" in e ? String((e as { detail: unknown }).detail) : (e as Error)?.message;
    update(
      "lint_runs",
      { status: "failed", completed_at: nowIso(), error_message: detail || String(e) },
      { id: runId },
    );
    throw e;
  }
}

r.get("/projects/lint/levels", (c) =>
  c.json({
    levels: Object.entries(LINT_LEVEL_DEFINITIONS)
      .map(([lvl, d]) => ({ level: Number(lvl), name: d.name, description: d.description, rule_ids: [...d.rules].sort() }))
      .sort((a, b) => a.level - b.level),
  }),
);

r.get("/projects/lint/rules", (c) =>
  c.json({
    rules: getAvailableRules().map((rule) => ({
      rule_id: rule.rule_id,
      name: rule.name,
      description: rule.description,
      severity: rule.severity,
      scope: rule.scope,
    })),
  }),
);

r.post("/projects/:id/lint/run", async (c) => {
  init();
  const projectId = c.req.param("id");
  requireProject(projectId);
  if (!git.repoExists(projectId)) httpError(400, "Project has no ontology file to lint");
  const active = get(
    "SELECT id FROM lint_runs WHERE project_id = ? AND status IN ('pending','running') LIMIT 1",
    projectId,
  );
  if (active) httpError(409, "A lint run is already in progress for this project");

  const branch = await requireBranch(projectId, c.req.query("branch"));
  const runId = newId();
  insert("lint_runs", { id: runId, project_id: projectId, status: "pending", branch, started_at: nowIso() });
  const jobId = startJob("lint", { projectId, branch }, () => executeLintRun(projectId, runId, branch));
  return c.json(
    { job_id: jobId, run_id: runId, branch, status: "queued", message: "Lint job has been queued" },
    202,
  );
});

r.get("/projects/:id/lint/status", (c) => {
  init();
  const projectId = c.req.param("id");
  requireProject(projectId);
  const last = get<LintRunRow>(
    "SELECT * FROM lint_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1",
    projectId,
  );
  // Counts come from the latest completed run (the same run /lint/issues lists), so they
  // keep showing the previous results while a new run is pending, running or has failed.
  const lastCompleted =
    last?.status === "completed"
      ? last
      : get<LintRunRow>(
          "SELECT * FROM lint_runs WHERE project_id = ? AND status = 'completed' ORDER BY started_at DESC LIMIT 1",
          projectId,
        );
  let error = 0,
    warning = 0,
    info = 0;
  if (lastCompleted) {
    for (const row of all<{ issue_type: string; n: number }>(
      `SELECT issue_type, COUNT(*) AS n FROM lint_issues WHERE run_id = ? AND resolved_at IS NULL AND ${KNOWN_RULES_SQL} GROUP BY issue_type`,
      lastCompleted.id,
    )) {
      if (row.issue_type === "error") error = Number(row.n);
      else if (row.issue_type === "warning") warning = Number(row.n);
      else if (row.issue_type === "info") info = Number(row.n);
    }
  }
  return c.json({
    project_id: projectId,
    last_run: last ? runToResponse(last) : null,
    counts_run_id: lastCompleted ? lastCompleted.id : null,
    error_count: error,
    warning_count: warning,
    info_count: info,
    total_issues: error + warning + info,
  });
});

r.get("/projects/:id/lint/runs", (c) => {
  init();
  const projectId = c.req.param("id");
  requireProject(projectId);
  const skip = queryInt(c, "skip", 0, { min: 0 });
  const limit = queryInt(c, "limit", 20, { min: 1, max: 100 });
  const total = Number(get<{ n: number }>("SELECT COUNT(*) AS n FROM lint_runs WHERE project_id = ?", projectId)!.n);
  const items = all<LintRunRow>(
    "SELECT * FROM lint_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
    projectId,
    limit,
    skip,
  ).map(runToResponse);
  return c.json({ items, total, skip, limit });
});

r.get("/projects/:id/lint/runs/:runId", (c) => {
  init();
  const projectId = c.req.param("id");
  requireProject(projectId);
  const runRow = get<LintRunRow>(
    "SELECT * FROM lint_runs WHERE id = ? AND project_id = ?",
    c.req.param("runId"),
    projectId,
  );
  if (!runRow) httpError(404, "Lint run not found");
  const resolvedSql = queryBool(c, "include_resolved", false) ? "" : " AND resolved_at IS NULL";
  const issues = all<LintIssueRow>(
    `SELECT * FROM lint_issues WHERE run_id = ? AND ${KNOWN_RULES_SQL}${resolvedSql} ORDER BY ${SEVERITY_ORDER}, rule_id, subject_iri`,
    runRow.id,
  ).map(issueToResponse);
  return c.json({ ...runToResponse(runRow), issues });
});

r.get("/projects/:id/lint/issues", (c) => {
  init();
  const projectId = c.req.param("id");
  requireProject(projectId);
  const skip = queryInt(c, "skip", 0, { min: 0 });
  const limit = queryInt(c, "limit", 100, { min: 1, max: 500 });
  const issueType = c.req.query("issue_type");
  if (issueType && !ISSUE_TYPES.includes(issueType)) {
    httpError(422, `Query parameter 'issue_type' must be one of: ${ISSUE_TYPES.join(", ")}`);
  }
  const last = get<{ id: string }>(
    "SELECT id FROM lint_runs WHERE project_id = ? AND status = 'completed' ORDER BY started_at DESC LIMIT 1",
    projectId,
  );
  if (!last) return c.json({ items: [], total: 0, skip, limit });

  const where = ["run_id = ?", KNOWN_RULES_SQL];
  const params: (string | number)[] = [last.id];
  const ruleId = c.req.query("rule_id");
  const subjectIri = c.req.query("subject_iri");
  if (issueType) {
    where.push("issue_type = ?");
    params.push(issueType);
  }
  if (ruleId) {
    where.push("rule_id = ?");
    params.push(ruleId);
  }
  if (subjectIri) {
    where.push("subject_iri = ?");
    params.push(subjectIri);
  }
  if (!queryBool(c, "include_resolved", false)) where.push("resolved_at IS NULL");
  const w = where.join(" AND ");
  const total = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM lint_issues WHERE ${w}`, ...params)!.n);
  const items = all<LintIssueRow>(
    `SELECT * FROM lint_issues WHERE ${w} ORDER BY ${SEVERITY_ORDER}, rule_id, subject_iri LIMIT ? OFFSET ?`,
    ...params,
    limit,
    skip,
  ).map(issueToResponse);
  return c.json({ items, total, skip, limit });
});

r.delete("/projects/:id/lint/issues/:issueId", (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const row = get<LintIssueRow>(
    "SELECT * FROM lint_issues WHERE id = ? AND project_id = ?",
    c.req.param("issueId"),
    projectId,
  );
  if (!row) httpError(404, "Lint issue not found");
  if (row.resolved_at) httpError(400, "Issue is already resolved");
  update("lint_issues", { resolved_at: nowIso() }, { id: row.id });
  return noContent(c);
});

r.delete("/projects/:id/lint/results", (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  run("DELETE FROM lint_runs WHERE project_id = ? AND status IN ('completed','failed')", projectId);
  return noContent(c);
});

r.get("/projects/:id/lint/config", (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  return c.json(serializeConfig(projectId, getConfigRow(projectId)));
});

r.put("/projects/:id/lint/config", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const body = await readJson<{ lint_level?: unknown; enabled_rules?: unknown }>(c);
  const level = body.lint_level ?? null;
  const rules = body.enabled_rules ?? null;
  if (level !== null && (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 5)) {
    httpError(422, "lint_level must be an integer between 1 and 5");
  }
  if (rules !== null) {
    if (!Array.isArray(rules) || rules.some((x) => typeof x !== "string")) {
      httpError(422, "enabled_rules must be a list of rule IDs");
    }
    const invalid = [...new Set(rules as string[])].filter((x) => !ALL_RULE_IDS.has(x) && !REMOVED_RULE_IDS.has(x)).sort();
    if (invalid.length) httpError(422, `Unknown rule IDs: ${invalid.join(", ")}`);
  }
  if (level !== null && rules !== null) {
    httpError(422, "lint_level and enabled_rules are mutually exclusive — choose preset OR custom mode");
  }
  const enabledStr =
    rules === null ? null : [...new Set(rules as string[])].filter((x) => ALL_RULE_IDS.has(x)).sort().join(",");
  run(
    `INSERT INTO project_lint_configs (project_id, lint_level, enabled_rules, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET lint_level = excluded.lint_level, enabled_rules = excluded.enabled_rules, updated_at = excluded.updated_at`,
    projectId,
    level as number | null,
    enabledStr,
    nowIso(),
  );
  return c.json(serializeConfig(projectId, getConfigRow(projectId)));
});

export default r;
