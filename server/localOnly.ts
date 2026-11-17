import type { MiddlewareHandler } from "hono";

/**
 * OntoKit has no login, and its API edits files and (soon) runs code. It must only be
 * reachable from OntoKit's own pages on this machine:
 *
 * - Host must be a loopback name. This blocks DNS rebinding, where a website points
 *   its own hostname at 127.0.0.1 so the browser treats our API as same-origin.
 * - A browser request must come from the same origin. This blocks other websites from
 *   sending requests to localhost (CSRF), including "simple" requests that skip CORS.
 *
 * Requests without Origin or Sec-Fetch-Site headers (curl, scripts, tests) are allowed:
 * a browser always sends at least one of them on cross-origin requests.
 *
 * ONTOKIT_ALLOWED_HOSTS and ONTOKIT_ALLOWED_ORIGINS (comma-separated) widen the lists,
 * for example to serve OntoKit behind a reverse proxy.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function envList(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = hostnameOf(host);
  if (LOOPBACK_HOSTS.has(name) || name.endsWith(".localhost")) return true;
  const allowed = envList("ONTOKIT_ALLOWED_HOSTS");
  return allowed.has(name) || allowed.has(host.trim().toLowerCase());
}

export function isAllowedOrigin(origin: string, host: string): boolean {
  if (origin === "null") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.host.toLowerCase() === host.trim().toLowerCase()) return true;
  return envList("ONTOKIT_ALLOWED_ORIGINS").has(url.origin.toLowerCase());
}

export function localOnly(): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (!isAllowedHost(host)) {
      return c.json({ detail: `Host '${host}' is not allowed. Set ONTOKIT_ALLOWED_HOSTS to allow it.` }, 403);
    }
    const origin = c.req.header("origin");
    if (origin !== undefined && !isAllowedOrigin(origin, host)) {
      return c.json({ detail: "Cross-origin requests are not allowed." }, 403);
    }
    if (origin === undefined && c.req.header("sec-fetch-site") === "cross-site") {
      return c.json({ detail: "Cross-origin requests are not allowed." }, 403);
    }
    await next();
  };
}
