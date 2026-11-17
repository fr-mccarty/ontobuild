import { Hono } from "hono";
import { DataFactory } from "n3";
import * as git from "../git";
import { CODE_DIR, allocateFolder } from "../workspace";
import { killProjectTerminals } from "../terminals";
import { importFromGit, type GitImportRequest } from "../gitImport";
import { createOntologyFile, listOntologyFiles, starterTurtle, switchOntologyFile } from "../ontologyFiles";
import { all, get, insert, newId, nowIso, run, toJson, transaction, update } from "../db";
import { ApiError, httpError, noContent, queryBool, queryInt, readJson } from "../http";
import { LOCAL_USER } from "../user";
import {
  DEFAULT_ONTOLOGY_FILE,
  commitOntology,
  emitOntologyEvent,
  invalidateOntologyCache,
  missingOntologyFileMessage,
  normalizeLabelPreferences,
  ontologyFilePath,
  openPullRequestBranches,
  projectToResponse,
  requireProject,
  requireBranch,
  type ProjectRow,
} from "../ontology";
import {
  NS,
  RdfParseError,
  SUPPORTED_EXTENSIONS,
  findOntologyIri,
  formatFromFilename,
  extensionOf,
  importNormalizationReport,
  normalizeToTurtle,
  ontologyMetadata,
  stripLanguageTagsFromTurtle,
  parseTurtle,
  serializeTurtle,
} from "../rdf";

const r = new Hono();

const MAX_IMPORT_FILE_SIZE = 50 * 1024 * 1024;
/** Allowance for the multipart envelope and the small text fields around the file. */
const MAX_IMPORT_BODY_OVERHEAD = 1024 * 1024;
const AUTHOR = { name: LOCAL_USER.name, email: LOCAL_USER.email };

const TITLE_PROPS: [string, string][] = [
  [NS.dc + "title", "dc:title"],
  [NS.dcterms + "title", "dcterms:title"],
  [NS.rdfs + "label", "rdfs:label"],
];
const DESC_PROPS: [string, string][] = [
  [NS.dc + "description", "dc:description"],
  [NS.dcterms + "description", "dcterms:description"],
  [NS.rdfs + "comment", "rdfs:comment"],
];

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "ontology"
  );
}

async function updateMetadataTurtle(
  content: string,
  newTitle: string | null,
  newDescription: string | null,
): Promise<{ turtle: string; changes: string[] } | null> {
  const parsed = parseTurtle(content);
  const store = parsed.store;
  const ontIri = findOntologyIri(store);
  if (!ontIri) return null;
  const subj = DataFactory.namedNode(ontIri);
  const changes: string[] = [];

  const apply = (props: [string, string][], value: string, kind: "Title" | "Description") => {
    for (const [p, curie] of props) {
      const existing = store.getObjects(subj, p, null);
      if (existing.length) {
        const old = existing[0].value || "(empty)";
        for (const o of existing) store.removeQuad(subj, DataFactory.namedNode(p), o as never);
        store.addQuad(subj, DataFactory.namedNode(p), DataFactory.literal(value));
        changes.push(kind === "Title" ? `Title (${curie}): "${old}" → "${value}"` : `Description (${curie}): updated`);
        return;
      }
    }
    const [p, curie] = props[0];
    store.addQuad(subj, DataFactory.namedNode(p), DataFactory.literal(value));
    changes.push(kind === "Title" ? `Title (${curie}): added "${value}"` : `Description (${curie}): added`);
  };
  if (newTitle !== null) apply(TITLE_PROPS, newTitle, "Title");
  if (newDescription !== null) apply(DESC_PROPS, newDescription, "Description");
  if (!changes.length) return null;
  return { turtle: await serializeTurtle(store, parsed.prefixes), changes };
}

function requireRepo(projectId: string, detail = "No repository found for this project") {
  if (!git.repoExists(projectId)) httpError(404, detail);
}

async function createProjectWithContent(opts: {
  name: string;
  description: string | null;
  isPublic: boolean;
  ontologyIri: string | null;
  normalizationReport: unknown;
  content: string;
  commitMessage: string;
  origin: string;
}): Promise<ProjectRow> {
  const id = newId();
  const now = nowIso();
  insert("projects", {
    id,
    name: opts.name,
    description: opts.description,
    is_public: opts.isPublic,
    owner_id: LOCAL_USER.id,
    created_at: now,
    updated_at: now,
    source_file_path: `projects/${id}/${DEFAULT_ONTOLOGY_FILE}`,
    git_ontology_path: DEFAULT_ONTOLOGY_FILE,
    folder: allocateFolder(opts.name),
    ontology_iri: opts.ontologyIri,
    normalization_report: toJson(opts.normalizationReport),
  });
  let commit: git.CommitInfo;
  try {
    await git.initRepo(id);
    commit = await git.commitFiles(id, {
      branch: git.DEFAULT_BRANCH,
      files: [
        { path: DEFAULT_ONTOLOGY_FILE, content: (await stripLanguageTagsFromTurtle(opts.content)).content },
        // Keeps the (otherwise empty) code folder in the repository and in clones of it.
        { path: `${CODE_DIR}/.gitkeep`, content: "" },
      ],
      message: opts.commitMessage,
      author: AUTHOR,
    });
  } catch (e) {
    await git.deleteRepo(id).catch(() => undefined);
    run("DELETE FROM projects WHERE id = ?", id);
    throw e;
  }
  await emitOntologyEvent({
    type: "commit",
    projectId: id,
    branch: git.DEFAULT_BRANCH,
    commitHash: commit.hash,
    parentHash: null,
    message: opts.commitMessage,
    origin: opts.origin,
  });
  return requireProject(id);
}

function branchInfoResponse(
  b: git.BranchInfo,
  extra: Partial<{
    created_by_id: string | null;
    created_by_name: string | null;
    can_delete: boolean;
    has_open_pr: boolean;
    has_delete_permission: boolean;
  }> = {},
) {
  return {
    name: b.name,
    is_current: b.is_current,
    is_default: b.is_default,
    commit_hash: b.commit_hash,
    commit_message: b.commit_message,
    commit_date: b.commit_date,
    commits_ahead: b.commits_ahead,
    commits_behind: b.commits_behind,
    created_by_id: extra.created_by_id ?? null,
    created_by_name: extra.created_by_name ?? null,
    can_delete: extra.can_delete ?? false,
    has_open_pr: extra.has_open_pr ?? false,
    has_delete_permission: extra.has_delete_permission ?? false,
  };
}

r.get("/projects", (c) => {
  const skip = queryInt(c, "skip", 0, { min: 0 });
  const limit = queryInt(c, "limit", 20, { min: 1, max: 100 });
  const search = c.req.query("search") || null;
  if (search && search.length > 200) httpError(422, "search must be at most 200 characters");

  const where: string[] = [];
  const params: string[] = [];
  if (search) {
    const escaped = search.replace(/[\\%_]/g, (m) => "\\" + m);
    where.push("(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
    params.push(`%${escaped}%`, `%${escaped}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM projects ${whereSql}`, ...params)!.n;
  const unfiltered = get<{ n: number }>("SELECT COUNT(*) AS n FROM projects")!.n;
  const rows = all<ProjectRow>(
    `SELECT * FROM projects ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    skip,
  );
  return c.json({
    items: rows.map(projectToResponse),
    total,
    unfiltered_total: unfiltered,
    skip,
    limit,
  });
});

r.post("/projects", async (c) => {
  const body = await readJson<{ name?: string; description?: string | null; is_public?: boolean }>(c);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 255) httpError(422, "name must be between 1 and 255 characters");
  if (body.description && body.description.length > 5000) httpError(422, "description too long");
  const iri = `http://example.org/ontologies/${slugify(name)}`;
  const project = await createProjectWithContent({
    name,
    description: body.description ?? null,
    isPublic: !!body.is_public,
    ontologyIri: iri,
    normalizationReport: null,
    content: starterTurtle(iri, name, body.description),
    commitMessage: `Initial import of ${name}`,
    origin: "create",
  });
  return c.json(projectToResponse(project), 201);
});

r.post("/projects/import", async (c) => {
  // Reject an oversized upload from its Content-Length before reading the body. The
  // per-file check below still applies when the header is absent (chunked uploads).
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMPORT_FILE_SIZE + MAX_IMPORT_BODY_OVERHEAD) {
    httpError(413, `File too large. Maximum size is ${MAX_IMPORT_FILE_SIZE / (1024 * 1024)} MB`);
  }
  let form: Record<string, string | File | (string | File)[]>;
  try {
    form = await c.req.parseBody();
  } catch {
    httpError(422, "Expected multipart/form-data");
  }
  const file = form.file;
  if (!(file instanceof File)) httpError(422, "Field 'file' is required");
  const isPublic = String(form.is_public).toLowerCase() === "true";
  const nameOverride = typeof form.name === "string" && form.name.trim() ? form.name.trim() : null;
  const descOverride = typeof form.description === "string" && form.description ? form.description : null;

  if (file.size > MAX_IMPORT_FILE_SIZE) {
    httpError(413, `File too large. Maximum size is ${MAX_IMPORT_FILE_SIZE / (1024 * 1024)} MB`);
  }
  const filename = file.name || "ontology.owl";
  const format = formatFromFilename(filename);
  if (!format) {
    httpError(
      400,
      `Unsupported file format: ${extensionOf(filename)}. Supported formats: ${[...SUPPORTED_EXTENSIONS].sort().join(", ")}`,
    );
  }
  const original = await file.text();
  let normalized: Awaited<ReturnType<typeof normalizeToTurtle>>;
  try {
    normalized = await normalizeToTurtle(original, filename);
  } catch (e) {
    if (e instanceof RdfParseError) httpError(422, `Failed to parse ontology: ${e.message}`);
    throw e;
  }
  const { iri: ontologyIri, title, description } = ontologyMetadata(normalized.store);
  const report = importNormalizationReport(original, filename, normalized);

  const projectName = (nameOverride || title || filename.replace(/\.[^.]+$/, "")).slice(0, 255);
  const project = await createProjectWithContent({
    name: projectName,
    description: descOverride || description,
    isPublic,
    ontologyIri,
    normalizationReport: report,
    content: normalized.turtle,
    commitMessage: `Initial import of ${projectName}`,
    origin: "import",
  });
  return c.json({ ...projectToResponse(project), file_path: project.source_file_path }, 201);
});

r.post("/projects/clone", async (c) => {
  const body = await readJson<GitImportRequest>(c);
  const { project, summary } = await importFromGit(body);
  return c.json({ ...projectToResponse(project), file_path: project.source_file_path, git_import: summary }, 201);
});

r.get("/projects/:id/ontology-files", async (c) => {
  return c.json(await listOntologyFiles(c.req.param("id"), c.req.query("branch")));
});

r.put("/projects/:id/ontology-file", async (c) => {
  const body = await readJson<{ path?: unknown; branch?: unknown; reconvert?: unknown }>(c);
  return c.json(await switchOntologyFile(c.req.param("id"), body));
});

r.post("/projects/:id/ontology-file", async (c) => {
  const body = await readJson<{ file_name?: unknown; ontology_iri?: unknown; title?: unknown; branch?: unknown }>(c);
  return c.json(await createOntologyFile(c.req.param("id"), body), 201);
});

r.get("/projects/:id", (c) => {
  return c.json(projectToResponse(requireProject(c.req.param("id"))));
});

r.patch("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const project = requireProject(id);
  const body = await readJson<{
    name?: string | null;
    description?: string | null;
    is_public?: boolean | null;
    label_preferences?: string[] | null;
  }>(c);
  // name: omitted/null leaves it unchanged; otherwise it is trimmed like on create.
  let name: string | undefined;
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== "string") httpError(422, "name must be a string");
    name = body.name.trim();
    if (name.length < 1 || name.length > 255) httpError(422, "name must be between 1 and 255 characters");
  }
  // description: omitted leaves it unchanged; null (or "") clears it.
  if (body.description !== undefined && body.description !== null && typeof body.description !== "string")
    httpError(422, "description must be a string or null");
  if (typeof body.description === "string" && body.description.length > 5000) httpError(422, "description too long");
  const description = body.description === undefined ? undefined : body.description || null;

  const nameChanged = name !== undefined && name !== project.name;
  // Only a new non-empty description is synced into the RDF; clearing it only affects the project record.
  const descChanged = typeof description === "string" && description !== project.description;
  const set: Record<string, string | boolean | null> = {};
  if (name !== undefined) set.name = name;
  if (description !== undefined) set.description = description;
  if (body.is_public != null) set.is_public = !!body.is_public;
  if (body.label_preferences != null) set.label_preferences = toJson(normalizeLabelPreferences(Array.isArray(body.label_preferences) ? body.label_preferences : []));
  set.updated_at = nowIso();
  update("projects", set, { id });

  if ((nameChanged || descChanged) && project.source_file_path && git.repoExists(id)) {
    try {
      const branch = await git.getDefaultBranch(id);
      const content = await git.readFile(id, branch, ontologyFilePath(project));
      const updated = await updateMetadataTurtle(
        content,
        nameChanged ? name! : null,
        descChanged ? (description as string) : null,
      );
      if (updated) {
        const lines = updated.changes.map((ch) => `- ${ch}`).join("\n");
        await commitOntology({
          projectId: id,
          branch,
          content: updated.turtle,
          message: `Update ontology metadata\n\n${lines}\n\nAutomated sync from project settings.`,
          origin: "metadata",
          validate: false,
        });
      }
    } catch (e) {
      console.warn(`[ontobuilder] failed to sync metadata to RDF for project ${id}:`, e);
    }
  }
  return c.json(projectToResponse(requireProject(id)));
});

r.delete("/projects/:id", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  // Stop the project's terminals and dev server, then delete the folder first: its location is
  // looked up from the project row.
  await killProjectTerminals(id).catch((e) => console.warn(`[ontobuilder] failed to stop terminals for ${id}:`, e));
  await git.deleteRepo(id).catch((e) => console.warn(`[ontobuilder] failed to delete project folder ${id}:`, e));
  run("DELETE FROM projects WHERE id = ?", id);
  invalidateOntologyCache(id);
  await emitOntologyEvent({ type: "project-deleted", projectId: id });
  return noContent(c);
});

r.get("/projects/:id/source", async (c) => {
  const id = c.req.param("id");
  const project = requireProject(id);
  requireRepo(id);
  const branch = await requireBranch(id, c.req.query("branch"));
  let sha: string;
  try {
    sha = await git.resolveRef(id, branch);
  } catch {
    httpError(404, `Branch not found: ${branch}`);
  }
  const filename = ontologyFilePath(project);
  const content = await git.readFileOrNull(id, sha, filename);
  if (content === null) httpError(404, missingOntologyFileMessage(filename, branch));
  if ((c.req.header("accept") || "").includes("text/turtle")) {
    return c.body(content, 200, { "Content-Type": "text/turtle; charset=utf-8" });
  }
  return c.json({ project_id: id, branch, commit_hash: sha, filename, content });
});

r.put("/projects/:id/source", async (c) => {
  const id = c.req.param("id");
  const project = requireProject(id);
  const body = await readJson<{ content?: string; commit_message?: string }>(c);
  if (typeof body.content !== "string") httpError(422, "Field 'content' is required");
  const message = body.commit_message;
  if (typeof message !== "string" || message.length < 1 || message.length > 500)
    httpError(422, "commit_message must be between 1 and 500 characters");
  if (!project.source_file_path) httpError(400, "Project does not have an ontology file");
  try {
    parseTurtle(body.content);
  } catch (e) {
    httpError(422, `Invalid Turtle syntax: ${(e as Error).message}`);
  }
  requireRepo(id);
  const branch = await requireBranch(id, c.req.query("branch"));
  let commit;
  try {
    commit = await commitOntology({
      projectId: id,
      branch,
      content: body.content,
      message,
      origin: "source",
      validate: false,
    });
  } catch (e) {
    if (e instanceof ApiError || e instanceof git.GitError) throw e;
    httpError(500, `Failed to commit changes: ${(e as Error).message}`);
  }
  update("projects", { updated_at: nowIso() }, { id });
  return c.json({ success: true, commit_hash: commit.hash, commit_message: commit.message, branch });
});

r.get("/projects/:id/revisions", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const limit = queryInt(c, "limit", 50, { min: 1, max: 200 });
  // A project without a repository simply has no history yet: list endpoints return an
  // empty collection (the history panel and branch selector render that as "nothing yet"),
  // while endpoints that address one revision (file, diff) return 404.
  if (!git.repoExists(id)) return c.json({ project_id: id, commits: [], total: 0, refs: {} });
  const commits = await git.getHistory(id, { limit, allBranches: true });
  const unresolved = commits.filter((cm) => cm.is_merge && !cm.merged_branch);
  if (unresolved.length) {
    const bySha = new Map(
      all<{ merge_commit_hash: string; source_branch: string }>(
        "SELECT merge_commit_hash, source_branch FROM pull_requests WHERE project_id = ? AND merge_commit_hash IS NOT NULL",
        id,
      ).map((p) => [p.merge_commit_hash, p.source_branch]),
    );
    for (const cm of unresolved) cm.merged_branch = bySha.get(cm.hash) ?? null;
  }
  const refs: Record<string, string[]> = {};
  try {
    for (const b of await git.listBranches(id)) {
      if (b.commit_hash) (refs[b.commit_hash] ??= []).push(b.name);
    }
  } catch {
  }
  return c.json({ project_id: id, commits, total: commits.length, refs });
});

r.get("/projects/:id/revisions/file", async (c) => {
  const id = c.req.param("id");
  const project = requireProject(id);
  const version = c.req.query("version");
  if (!version) httpError(422, "Query parameter 'version' is required");
  let filename = c.req.query("filename") || "ontology.ttl";
  requireRepo(id, "No revision history found for this project");
  if (filename === "ontology.ttl") filename = ontologyFilePath(project);
  let content: string;
  try {
    content = await git.readFile(id, version, filename);
  } catch (e) {
    httpError(404, `Could not retrieve file at revision: ${(e as Error).message}`);
  }
  return c.json({ project_id: id, version, filename, content });
});

r.get("/projects/:id/revisions/diff", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const from = c.req.query("from_version");
  if (!from) httpError(422, "Query parameter 'from_version' is required");
  const to = c.req.query("to_version") || "HEAD";
  requireRepo(id, "No revision history found for this project");
  let d: git.DiffInfo;
  try {
    d = await git.diff(id, from, to);
  } catch (e) {
    httpError(400, `Could not compute diff: ${(e as Error).message}`);
  }
  return c.json({
    project_id: id,
    from_version: d.from_version,
    to_version: d.to_version,
    files_changed: d.files_changed,
    total_additions: d.total_additions,
    total_deletions: d.total_deletions,
    changes: d.changes,
  });
});

r.get("/projects/:id/branches", async (c) => {
  const id = c.req.param("id");
  const project = requireProject(id);
  const preferred = project.preferred_branch;
  if (!git.repoExists(id)) {
    return c.json({
      items: [],
      current_branch: git.DEFAULT_BRANCH,
      default_branch: git.DEFAULT_BRANCH,
      preferred_branch: preferred,
    });
  }
  const branches = await git.listBranches(id);
  const meta = new Map(
    all<{ branch_name: string; created_by_id: string | null; created_by_name: string | null }>(
      "SELECT branch_name, created_by_id, created_by_name FROM branch_metadata WHERE project_id = ?",
      id,
    ).map((m) => [m.branch_name, m]),
  );
  const openPr = openPullRequestBranches(id);
  const def = await git.getDefaultBranch(id);
  return c.json({
    items: branches.map((b) => {
      const m = meta.get(b.name);
      const hasOpenPr = openPr.has(b.name);
      return branchInfoResponse(b, {
        created_by_id: m?.created_by_id ?? null,
        created_by_name: m?.created_by_name ?? null,
        has_open_pr: hasOpenPr,
        has_delete_permission: true,
        can_delete: !hasOpenPr && !b.is_default,
      });
    }),
    current_branch: def,
    default_branch: def,
    preferred_branch: preferred,
  });
});

r.put("/projects/:id/branch-preference", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const branch = c.req.query("branch");
  if (!branch) httpError(422, "Query parameter 'branch' is required");
  await requireBranch(id, branch);
  update("projects", { preferred_branch: branch }, { id });
  return noContent(c);
});

r.post("/projects/:id/branches", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const body = await readJson<{ name?: string; from_branch?: string | null }>(c);
  if (typeof body.name !== "string" || body.name.length < 1 || body.name.length > 255)
    httpError(422, "name must be between 1 and 255 characters");
  requireRepo(id);
  let b: git.BranchInfo;
  try {
    b = await git.createBranch(id, body.name, body.from_branch || "HEAD");
  } catch (e) {
    httpError(400, `Could not create branch: ${(e as Error).message}`);
  }
  transaction(() => {
    run("DELETE FROM branch_metadata WHERE project_id = ? AND branch_name = ?", id, b.name);
    insert("branch_metadata", {
      project_id: id,
      branch_name: b.name,
      created_by_id: LOCAL_USER.id,
      created_by_name: LOCAL_USER.name,
      created_at: nowIso(),
    });
  });
  await emitOntologyEvent({ type: "branch-created", projectId: id, branch: b.name, commitHash: b.commit_hash });
  return c.json(
    branchInfoResponse(b, {
      created_by_id: LOCAL_USER.id,
      created_by_name: LOCAL_USER.name,
      can_delete: true,
      has_open_pr: false,
      has_delete_permission: true,
    }),
    201,
  );
});

r.delete("/projects/:id/branches/:name{.+}", async (c) => {
  const id = c.req.param("id");
  const name = c.req.param("name");
  requireProject(id);
  requireRepo(id);
  const force = queryBool(c, "force", false);
  if (!(await git.branchExists(id, name))) httpError(404, `Branch not found: ${name}`);
  if (openPullRequestBranches(id).has(name)) httpError(409, "Cannot delete branch: it has an open pull request");
  try {
    await git.deleteBranch(id, name, force);
  } catch (e) {
    httpError(400, (e as Error).message);
  }
  run("DELETE FROM branch_metadata WHERE project_id = ? AND branch_name = ?", id, name);
  const project = requireProject(id);
  if (project.preferred_branch === name) update("projects", { preferred_branch: null }, { id });
  await emitOntologyEvent({ type: "branch-deleted", projectId: id, branch: name });
  return noContent(c);
});

export default r;
