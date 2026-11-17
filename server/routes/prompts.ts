import { Hono } from "hono";
import { httpError, readJson } from "../http";
import { requireProject } from "../ontology";
import { getProvenance, getProvenanceBatch, type ProvenanceItem } from "../provenance";

const r = new Hono();

const MAX_BATCH = 200;

function item(raw: unknown, where: string): ProvenanceItem {
  const o = (raw ?? {}) as Record<string, unknown>;
  for (const f of ["iri", "property", "value"] as const) {
    if (typeof o[f] !== "string") httpError(422, `${where}: field '${f}' must be a string`);
  }
  if (!(o.iri as string)) httpError(422, `${where}: field 'iri' must not be empty`);
  if (!(o.property as string)) httpError(422, `${where}: field 'property' must not be empty`);
  return { iri: o.iri as string, property: o.property as string, value: o.value as string };
}

r.get("/projects/:id/provenance", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const q = { iri: c.req.query("iri"), property: c.req.query("property"), value: c.req.query("value") ?? "" };
  return c.json(await getProvenance(id, item(q, "Query"), c.req.query("branch") || null));
});

r.post("/projects/:id/provenance/batch", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const body = await readJson<Record<string, unknown>>(c);
  if (!Array.isArray(body.items)) httpError(422, "Field 'items' must be an array");
  if (body.items.length > MAX_BATCH) httpError(422, `At most ${MAX_BATCH} items per request`);
  if (body.branch !== undefined && body.branch !== null && typeof body.branch !== "string")
    httpError(422, "Field 'branch' must be a string");
  const items = body.items.map((it, i) => item(it, `items[${i}]`));
  return c.json({ items: await getProvenanceBatch(id, items, (body.branch as string | undefined) || null) });
});

export default r;
