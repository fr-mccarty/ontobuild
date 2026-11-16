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

export function httpError(status: number, detail: unknown): never {
  throw new ApiError(status, detail);
}

export async function readJson<T = Record<string, unknown>>(c: Context): Promise<T> {
  const text = await c.req.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    httpError(422, "Invalid JSON body");
  }
}

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

export function queryBool(c: Context, name: string, def = false): boolean {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return def;
  return ["true", "1", "yes", "on"].includes(raw.toLowerCase());
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (typeof v !== "string" || v.length === 0) httpError(422, `Field '${field}' is required`);
  return v;
}

/** Reads an entity IRI path parameter, URL-decoding it (a malformed escape is returned as-is). */
export function iriParam(c: Context, name = "iri"): string {
  const raw = c.req.param(name) ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function noContent(c: Context) {
  return c.body(null, 204);
}
