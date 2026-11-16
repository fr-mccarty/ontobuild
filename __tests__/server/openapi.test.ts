import { describe, expect, it } from "vitest";
import app from "@/server/app";
import { buildOpenApiSpec, componentSchemas, operationDocs, schemaSources, tagFor, tags, toDocPath } from "@/server/openapi";

const routeKeys = app.routes
  .filter((r) => r.method !== "ALL" && !r.path.endsWith("/openapi.json"))
  .map((r) => `${r.method} ${toDocPath(r.path).path}`);

function collectRefs(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") out.add(v.replace("#/components/schemas/", ""));
      else collectRefs(v, out);
    }
  }
}

describe("OpenAPI documentation", () => {
  it("documents every route", () => {
    expect(routeKeys.filter((k) => !operationDocs[k])).toEqual([]);
  });

  it("has no docs for routes that no longer exist", () => {
    const live = new Set(routeKeys);
    expect(Object.keys(operationDocs).filter((k) => !live.has(k))).toEqual([]);
  });

  it("gives every operation a summary and a success response", () => {
    for (const [key, doc] of Object.entries(operationDocs)) {
      expect(doc.summary, key).toBeTruthy();
      expect(Object.keys(doc.responses).some((s) => s.startsWith("2")), key).toBe(true);
    }
  });

  it("does not define the same schema name in two domain files", () => {
    const names = schemaSources.flatMap((m) => Object.keys(m));
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it("only references schemas that exist", () => {
    const refs = new Set<string>();
    collectRefs({ operationDocs, componentSchemas }, refs);
    expect([...refs].filter((r) => !componentSchemas[r])).toEqual([]);
  });

  it("assigns every operation to a declared tag", () => {
    const declared = new Set(tags.map((t) => t.name));
    expect([...new Set(routeKeys.map((k) => tagFor(k.split(" ")[1])))].filter((t) => !declared.has(t))).toEqual([]);
  });

  it("serves the spec", async () => {
    const res = await app.request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as ReturnType<typeof buildOpenApiSpec>;
    expect(spec.paths["/api/v1/agent/settings"]).toHaveProperty("get.summary", "Get agent settings");
  });
});
