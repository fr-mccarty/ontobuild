/**
 * Small HTTP helpers shared by all route modules.
 *
 * Errors are reported like FastAPI: `{"detail": ...}` with the matching status code.
 * Throw `httpError(404, "Project not found")` (or `new ApiError(...)`) anywhere inside
 * a handler; the error handler in server/app.ts turns it into the JSON response.
 */
import type { Context } from "hono";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.name = "ApiError";
  }
}

/** Throw an HTTP error with a FastAPI-style `detail`. */
export function httpError(status: number, detail: unknown): never {
  throw new ApiError(status, detail);
}

/** Parse a JSON body; 422 on invalid JSON. Returns `{}` for an empty body. */
export async function readJson<T = Record<string, unknown>>(c: Context): Promise<T> {
  const text = await c.req.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    httpError(422, "Invalid JSON body");
  }
}

/** Integer query param with default and optional bounds (422 when out of range). */
export function queryInt(
  c: Context,
  name: string,
  def: number,
  opts: { min?: number; max?: number } = {},
): number {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) httpError(422, `Query parameter '${name}' must be an integer`);
  if (opts.min !== undefined && n < opts.min)
    httpError(422, `Query parameter '${name}' must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max)
    httpError(422, `Query parameter '${name}' must be <= ${opts.max}`);
  return n;
}

/** Boolean query param ("true"/"1"/"yes" are true). */
export function queryBool(c: Context, name: string, def = false): boolean {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return def;
  return ["true", "1", "yes", "on"].includes(raw.toLowerCase());
}

/** Require a non-empty string field in a parsed body (422 otherwise). */
export function requireString(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (typeof v !== "string" || v.length === 0) httpError(422, `Field '${field}' is required`);
  return v;
}

/** 204 No Content response. */
export function noContent(c: Context) {
  return c.body(null, 204);
}
