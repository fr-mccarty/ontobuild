import { Hono } from "hono";
import { noContent, readJson } from "../http";
import { requireProject } from "../ontology";
import {
  createGitHubRepo,
  fetchRemote,
  pullRemote,
  pushRemote,
  remoteInfo,
  removeRemote,
  setRemote,
} from "../github";

const r = new Hono();

r.get("/projects/:id/github", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  return c.json(await remoteInfo(id));
});

r.put("/projects/:id/github", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const body = await readJson<Record<string, unknown>>(c);
  return c.json(await setRemote(id, body.remote_url));
});

r.delete("/projects/:id/github", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  await removeRemote(id);
  return noContent(c);
});

r.post("/projects/:id/github/fetch", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const { output } = await fetchRemote(id);
  return c.json({ ...(await remoteInfo(id)), output });
});

r.post("/projects/:id/github/push", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const body = await readJson<Record<string, unknown>>(c);
  const { output } = await pushRemote(id, { all: body.all === true });
  return c.json({ ...(await remoteInfo(id)), output });
});

r.post("/projects/:id/github/pull", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const { output } = await pullRemote(id);
  return c.json({ ...(await remoteInfo(id)), output });
});

r.post("/projects/:id/github/create", async (c) => {
  const id = c.req.param("id");
  requireProject(id);
  const body = await readJson<Record<string, unknown>>(c);
  const { output } = await createGitHubRepo(id, {
    name: body.name,
    private: body.private,
    description: body.description,
  });
  return c.json({ ...(await remoteInfo(id)), output });
});

export default r;
