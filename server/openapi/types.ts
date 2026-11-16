/**
 * Hand-written OpenAPI documentation for the routes in server/routes.
 *
 * Each domain file exports a DocMap keyed by "METHOD /path", where the path is
 * relative to /api/v1 and uses OpenAPI {param} syntax, for example
 * "GET /projects/{id}/lint/runs/{runId}". The spec builder in ./index.ts merges
 * these with the live Hono route table; __tests__/server/openapi.test.ts fails
 * when a route has no entry or an entry has no route.
 */

/** A JSON Schema object (OpenAPI 3.1 dialect). Use { $ref: "#/components/schemas/Name" } for shared schemas. */
export type Schema = Record<string, unknown>;

export interface QueryParamDoc {
  name: string;
  description: string;
  schema: Schema;
  required?: boolean;
}

export interface ResponseDoc {
  description: string;
  /** Omit for responses with no body (204). */
  schema?: Schema;
  /** Defaults to application/json. */
  contentType?: string;
}

export interface OperationDoc {
  /** Short title shown in the sidebar, e.g. "List lint runs". */
  summary: string;
  /** One to three sentences of Markdown. */
  description?: string;
  /** Path parameter descriptions that override the shared ones in ./index.ts. */
  pathParams?: Record<string, string>;
  query?: QueryParamDoc[];
  body?: { schema: Schema; required?: boolean; contentType?: string; description?: string };
  /** Keyed by status code. Include the success response and the meaningful error ones. */
  responses: Record<string, ResponseDoc>;
}

export type DocMap = Record<string, OperationDoc>;

/** Shorthand for a reference to a shared schema in components.schemas. */
export const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

/** Shorthand for the standard { detail } error response. */
export const error = (description: string): ResponseDoc => ({ description, schema: ref("Error") });
