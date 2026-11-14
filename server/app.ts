/**
 * The API: one Hono app mounted at /api/v1 and served by the Next catch-all route
 * app/api/v1/[[...path]]/route.ts.
 *
 * Each domain lives in server/routes/<domain>.ts and exports a Hono sub-app that is
 * registered below with `app.route("/", ...)` (sub-apps declare full paths such as
 * "/projects/:id/...").
 */
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

// pullRequests first: its global /projects/pull-requests/open-summary must win over /projects/:id/*
// lint first: its global /projects/lint/{rules,levels} must win over /projects/:id/... patterns
app.route("/", lint);
app.route("/", quality);
app.route("/", normalization);
app.route("/", pullRequests);
app.route("/", projects);
app.route("/", analytics);
app.route("/", userSettings);
app.route("/", ontology);

/** Minimal OpenAPI document generated from the registered routes (for /api-docs). */
app.get("/openapi.json", (c) => {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of app.routes) {
    if (r.method === "ALL" || r.path.endsWith("/openapi.json")) continue;
    const params: string[] = [];
    const p = r.path.replace(/:([A-Za-z_]+)(\{[^}]*\})?/g, (_m, name: string) => {
      params.push(name);
      return `{${name}}`;
    });
    const tag = p.split("/")[3] || "general";
    const tagName = tag.startsWith("{") ? "general" : tag;
    (paths[p] ??= {})[r.method.toLowerCase()] = {
      tags: [tagName.charAt(0).toUpperCase() + tagName.slice(1)],
      summary: `${r.method} ${p}`,
      parameters: params.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      responses: { "200": { description: "Successful response" } },
    };
  }
  return c.json({
    openapi: "3.1.0",
    info: { title: "OntoKit API", version: "1.0.0", description: "Local OntoKit API (no authentication)." },
    paths,
  });
});

export default app;
