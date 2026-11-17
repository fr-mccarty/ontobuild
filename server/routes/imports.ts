import { Hono } from "hono";
import { httpError, readJson } from "../http";
import { nowIso, update } from "../db";
import { requireBranch, requireProject } from "../ontology";
import { addImport, importCandidates, listImports, removeImport } from "../imports";

const r = new Hono();

r.get("/projects/:id/imports", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const branch = await requireBranch(projectId, c.req.query("branch"));
  return c.json(await listImports(projectId, branch));
});

r.post("/projects/:id/imports", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const body = await readJson<{ iri?: unknown; commit_message?: unknown }>(c);
  if (typeof body.iri !== "string" || !body.iri.trim()) httpError(422, "Field 'iri' is required");
  const message = body.commit_message;
  if (message !== undefined && message !== null && (typeof message !== "string" || message.length > 500)) {
    httpError(422, "commit_message must be a string of at most 500 characters");
  }
  const branch = await requireBranch(projectId, c.req.query("branch"));
  const result = await addImport(projectId, branch, body.iri.trim(), (message as string | null | undefined) || undefined);
  update("projects", { updated_at: nowIso() }, { id: projectId });
  return c.json(result);
});

r.delete("/projects/:id/imports", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const iri = c.req.query("iri");
  if (!iri) httpError(422, "Query parameter 'iri' is required");
  const message = c.req.query("commit_message");
  if (message && message.length > 500) httpError(422, "commit_message must be at most 500 characters");
  const branch = await requireBranch(projectId, c.req.query("branch"));
  const result = await removeImport(projectId, branch, iri, message || undefined);
  update("projects", { updated_at: nowIso() }, { id: projectId });
  return c.json(result);
});

r.post("/projects/:id/imports/refresh", async (c) => {
  const projectId = c.req.param("id");
  requireProject(projectId);
  const branch = await requireBranch(projectId, c.req.query("branch"));
  return c.json(await listImports(projectId, branch, { refresh: true }));
});

r.get("/import-candidates", async (c) => {
  const q = c.req.query("q") ?? "";
  if (q.length > 200) httpError(422, "Query parameter 'q' must be at most 200 characters");
  return c.json(await importCandidates(q));
});

export default r;
