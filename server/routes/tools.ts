import { Hono } from "hono";
import { requireProject } from "../ontology";
import { buildComponentTree } from "../tools/componentTree";
import { buildOrphanReport } from "../tools/orphans";

/** Meta tools that look at the code in a project's `code/` folder. */
const r = new Hono();

r.get("/projects/:id/tools/component-tree", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  return c.json(buildComponentTree(id));
});

r.get("/projects/:id/tools/orphans", (c) => {
  const id = c.req.param("id");
  requireProject(id);
  return c.json(buildOrphanReport(id));
});

export default r;
