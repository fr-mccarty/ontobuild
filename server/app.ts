import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError } from "./http";
import { GitError } from "./git";
import { getDb } from "./db";
import projects from "./routes/projects";
import pullRequests from "./routes/pullRequests";
import analytics from "./routes/analytics";
import userSettings from "./routes/userSettings";
import ontology from "./routes/ontology";
import lint from "./routes/lint";
import quality from "./routes/quality";
import normalization from "./routes/normalization";
import { createAgentRoutes } from "./routes/agent";
import workspace from "./routes/workspace";
import imports from "./routes/imports";
import github from "./routes/github";
import prompts from "./routes/prompts";
import tools from "./routes/tools";
import { buildOpenApiSpec } from "./openapi";
import { localOnly } from "./localOnly";
import { ensureMigrated } from "./workspace";

const app = new Hono().basePath("/api/v1");

app.use("*", localOnly());
// Move projects stored before project folders existed (once per database).
app.use("*", async (_c, next) => {
  ensureMigrated();
  await next();
});

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ ...err.extra, detail: err.detail }, err.status as ContentfulStatusCode);
  }
  if (err instanceof HTTPException) {
    return c.json({ detail: err.message }, err.status);
  }
  if (err instanceof GitError) {
    console.warn("[ontobuilder] git error:", err.message);
    return c.json({ detail: err.message }, 400);
  }
  console.error("[ontobuilder] unhandled error:", err);
  return c.json({ detail: err instanceof Error ? err.message : "Internal Server Error" }, 500);
});

app.notFound((c) => c.json({ detail: "Not Found" }, 404));

app.get("/health", (c) => {
  getDb();
  return c.json({ status: "healthy" });
});

app.route("/", lint);
app.route("/", quality);
app.route("/", normalization);
app.route("/", pullRequests);
app.route("/", projects);
app.route("/", analytics);
app.route("/", userSettings);
app.route("/", ontology);
app.route("/", workspace);
app.route("/", imports);
app.route("/", github);
app.route("/", prompts);
app.route("/", tools);
app.route("/", createAgentRoutes(() => app));

app.get("/openapi.json", (c) => c.json(buildOpenApiSpec(app.routes)));

export default app;
