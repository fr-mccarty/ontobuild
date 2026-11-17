/**
 * Messages for failed API requests. Kept apart from ./client (and free of its imports) so code
 * that shows errors works when tests mock the client.
 *
 * An ApiError's `message` is the raw response body; for this API that is JSON such as
 * `{"detail": "Ontology file not found…"}`. Users should see the `detail` text, not the JSON.
 */

/** The JSON object in an error body, or null. */
export function errorBody(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A message to show for a failed request: an API error body's `detail` text, else the error's message, else `fallback`. */
export function apiErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof Error) {
    const detail = errorBody(error.message)?.detail;
    if (typeof detail === "string") return detail;
    return error.message || fallback;
  }
  return fallback;
}
