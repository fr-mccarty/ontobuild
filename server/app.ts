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
import { buildOpenApiSpec } from "./openapi";

const app = new Hono().basePath("/api/v1");

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ detail: err.detail }, err.status as ContentfulStatusCode);
  }
  if (err instanceof HTTPException) {
    return c.json({ detail: err.message }, err.status);
  }
  if (err instanceof GitError) {
    console.warn("[ontokit] git error:", err.message);
    return c.json({ detail: err.message }, 400);
  }
  console.error("[ontokit] unhandled error:", err);
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
app.route("/", createAgentRoutes(() => app));

app.get("/openapi.json", (c) => c.json(buildOpenApiSpec(app.routes)));

export default app;
