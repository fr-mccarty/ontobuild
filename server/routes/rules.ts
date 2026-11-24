import { Hono, type Context } from "hono";
import * as git from "../git";
import { fromJson, get, nowIso, run, toJson, update } from "../db";
import { httpError, iriParam, noContent, readJson } from "../http";
import { getJob, startJob } from "../jobs";
import {
  OWL_CLASS,
  RDFS_CLASS,
  commitOntology,
  findOntologyIri,
  getProjectRow,
  hasType,
  loadOntology,
  onOntologyEvent,
  ontologyFilePath,
  requireBranch,
  requireProject,
  type LoadedOntology,
} from "../ontology";
import {
  contentWithNewRule,
  contentWithUpdatedRule,
  contentWithoutRule,
  countViolations,
  deriveShapes,
  hasRulesOrImports,
  newRuleIri,
  parseRuleInput,
  rulesView,
  shapesTurtle,
  classAndAncestors,
  validateOntology,
  type Rule,
  type RuleCounts,
  type RuleValidation,
  type RuleViolation,
} from "../rules";
import { isRule } from "../rulesVocabulary";

const r = new Hono();

const VALIDATION_JOB = "rule_validation";

export interface RuleValidationResult {
  project_id: string;
  branch: string;
  commit_hash: string | null;
  checked_at: string | null;
  duration_ms: number | null;
  rule_count: number | null;
  counts: RuleCounts;
  violations: RuleViolation[];
}

function toResult(projectId: string, branch: string, validation: RuleValidation, checkedAt: string): RuleValidationResult {
  return {
    project_id: projectId,
    branch,
    commit_hash: validation.commit_hash,
    checked_at: checkedAt,
    duration_ms: validation.duration_ms,
    rule_count: validation.rule_count,
    counts: validation.counts,
    violations: validation.violations,
  };
}

function saveResult(projectId: string, branch: string, result: RuleValidationResult, filePath: string) {
  const project = getProjectRow(projectId);
  if (!project || ontologyFilePath(project) !== filePath) return;
  run(
    `INSERT INTO rule_validations (project_id, branch, commit_hash, file_path, result, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, branch) DO UPDATE SET commit_hash = excluded.commit_hash, file_path = excluded.file_path,
       result = excluded.result, created_at = excluded.created_at`,
    projectId,
    branch,
    result.commit_hash,
    filePath,
    toJson(result),
    result.checked_at,
  );
}

export function latestRuleValidation(projectId: string, branch: string): RuleValidationResult | null {
  const row = get<{ result: string }>(
    "SELECT result FROM rule_validations WHERE project_id = ? AND branch = ?",
    projectId,
    branch,
  );
  return row ? fromJson<RuleValidationResult | null>(row.result, null) : null;
}

function startValidation(projectId: string, branch: string): string {
  return startJob(VALIDATION_JOB, { projectId, branch }, async () => {
    try {
      const onto = await loadOntology(projectId, branch);
      const result = toResult(projectId, branch, await validateOntology(onto), nowIso());
      saveResult(projectId, branch, result, onto.filePath);
      return result;
    } catch (e) {
      throw new Error(errorDetail(e));
    }
  });
}

onOntologyEvent("rules:validate-after-commit", async (e) => {
  if (e.type !== "commit") return;
  let onto: LoadedOntology;
  try {
    onto = await loadOntology(e.projectId, e.commitHash);
  } catch {
    return;
  }
  if (hasRulesOrImports(onto.store) || latestRuleValidation(e.projectId, e.branch)) startValidation(e.projectId, e.branch);
});

onOntologyEvent("rules:forget", (e) => {
  if (e.type === "ontology-file-changed") run("DELETE FROM rule_validations WHERE project_id = ?", e.projectId);
  if (e.type === "branch-deleted") run("DELETE FROM rule_validations WHERE project_id = ? AND branch = ?", e.projectId, e.branch);
});

function errorDetail(e: unknown): string {
  if (e && typeof e === "object" && "detail" in e) return String((e as { detail: unknown }).detail);
  return e instanceof Error ? e.message : String(e);
}

async function requireTarget(c: Context): Promise<{ projectId: string; branch: string }> {
  const projectId = c.req.param("id")!;
  requireProject(projectId);
  if (!git.repoExists(projectId)) httpError(404, "No repository found for this project");
  const branch = await requireBranch(projectId, c.req.query("branch"));
  if (!(await git.branchExists(projectId, branch))) httpError(404, `Branch not found: ${branch}`);
  return { projectId, branch };
}

async function loadRules(c: Context) {
  const { projectId, branch } = await requireTarget(c);
  const onto = await loadOntology(projectId, branch);
  const { view, rules } = await rulesView(onto);
  return { projectId, branch, onto, view, rules };
}

function isClass(store: LoadedOntology["store"], iri: string): boolean {
  return hasType(store, iri, OWL_CLASS) || hasType(store, iri, RDFS_CLASS);
}

function requireOwnRule(rules: Rule[], onto: LoadedOntology, iri: string): Rule {
  const rule = rules.find((x) => x.iri === iri);
  if (!rule) httpError(404, `Rule not found: ${iri}`);
  if (!isRule(onto.store, iri)) httpError(403, `${iri} comes from ${rule.imported_from ?? "an imported ontology"} and is read-only here`);
  return rule;
}

function commitMessage(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") httpError(422, "Field 'commit_message' must be a string");
  if (value.length > 500) httpError(422, "commit_message must be at most 500 characters");
  return value;
}

function ruleName(fields: { label: string | null }, iri: string): string {
  return fields.label ?? (iri.includes("#") ? iri.split("#").pop()! : iri.slice(iri.lastIndexOf("/") + 1));
}

async function committedRule(projectId: string, branch: string, iri: string): Promise<Rule> {
  const { rules } = await rulesView(await loadOntology(projectId, branch));
  return rules.find((x) => x.iri === iri)!;
}

async function commitRuleChange(projectId: string, branch: string, content: string, message: string) {
  const commit = await commitOntology({ projectId, branch, content, message, origin: "rules" });
  update("projects", { updated_at: nowIso() }, { id: projectId });
  return commit;
}

r.get("/projects/:id/rules", async (c) => {
  const { view, rules } = await loadRules(c);
  const cls = c.req.query("class");
  if (!cls) return c.json({ rules });
  const classes = classAndAncestors(view.store, cls);
  return c.json({ rules: rules.filter((x) => classes.has(x.applies_to_iri)) });
});

r.post("/projects/:id/rules", async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const input = parseRuleInput(body);
  const { projectId, branch, onto, view } = await loadRules(c);
  if (!isClass(view.store, input.applies_to_iri)) httpError(422, `Not a class in this ontology or its imports: ${input.applies_to_iri}`);
  const iri = input.iri ?? newRuleIri(onto, view.store, input);
  if (view.store.countQuads(iri, null, null, null) > 0) httpError(409, `Something with IRI ${iri} already exists`);
  const project = requireProject(projectId);
  const fallback = findOntologyIri(onto.store) ?? project.ontology_iri ?? "http://example.org/ontology";
  const content = await contentWithNewRule(onto, iri, input, fallback);
  const commit = await commitRuleChange(projectId, branch, content, commitMessage(body.commit_message, `Add rule ${ruleName(input, iri)}`));
  return c.json({ rule: await committedRule(projectId, branch, iri), commit_hash: commit.hash, branch }, 201);
});

r.post("/projects/:id/rules/validate", async (c) => {
  const { projectId, branch } = await requireTarget(c);
  return c.json({ job_id: startValidation(projectId, branch) }, 202);
});

r.get("/projects/:id/rules/jobs/:jobId", (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const jobId = c.req.param("jobId");
  const job = getJob(jobId);
  if (!job || job.kind !== VALIDATION_JOB || job.project_id !== projectId) httpError(404, "Job result not found or expired");
  if (job.status === "pending" || job.status === "running") return c.json({ job_id: jobId, status: "pending" }, 202);
  if (job.status === "failed") httpError(500, `Job failed: ${job.error || "Unknown error"}`);
  return c.json(job.result as object);
});

r.get("/projects/:id/rules/violations", async (c) => {
  const { projectId, branch } = await requireTarget(c);
  const head = await git.resolveRef(projectId, branch);
  const latest = latestRuleValidation(projectId, branch);
  const cls = c.req.query("class");
  const entity = c.req.query("entity");
  if (!latest) {
    return c.json({
      project_id: projectId,
      branch,
      commit_hash: null,
      checked_at: null,
      duration_ms: null,
      rule_count: null,
      counts: countViolations([]),
      violations: [],
      stale: false,
    });
  }
  const violations = latest.violations.filter(
    (v) => (!cls || v.applies_to_iri === cls) && (!entity || v.focus_node === entity),
  );
  return c.json({ ...latest, counts: countViolations(violations), violations, stale: latest.commit_hash !== head });
});

r.get("/projects/:id/rules/shacl", async (c) => {
  const { view, rules } = await loadRules(c);
  const turtle = await shapesTurtle(deriveShapes(rules, view.store));
  return c.body(turtle, 200, { "Content-Type": "text/turtle; charset=utf-8" });
});

r.get("/projects/:id/rules/:iri{.+}", async (c) => {
  const { rules } = await loadRules(c);
  const iri = iriParam(c);
  const rule = rules.find((x) => x.iri === iri);
  if (!rule) httpError(404, `Rule not found: ${iri}`);
  return c.json(rule);
});

r.put("/projects/:id/rules/:iri{.+}", async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const input = parseRuleInput(body);
  const { projectId, branch, onto, view, rules } = await loadRules(c);
  const iri = iriParam(c);
  requireOwnRule(rules, onto, iri);
  if (!isClass(view.store, input.applies_to_iri)) httpError(422, `Not a class in this ontology or its imports: ${input.applies_to_iri}`);
  const content = await contentWithUpdatedRule(onto, iri, input);
  const commit = await commitRuleChange(projectId, branch, content, commitMessage(body.commit_message, `Update rule ${ruleName(input, iri)}`));
  return c.json({ rule: await committedRule(projectId, branch, iri), commit_hash: commit.hash, branch });
});

r.delete("/projects/:id/rules/:iri{.+}", async (c) => {
  const { projectId, branch, onto, rules } = await loadRules(c);
  const iri = iriParam(c);
  const rule = requireOwnRule(rules, onto, iri);
  const content = await contentWithoutRule(onto, iri);
  await commitRuleChange(projectId, branch, content, commitMessage(c.req.query("commit_message"), `Delete rule ${ruleName(rule, iri)}`));
  return noContent(c);
});

export default r;
