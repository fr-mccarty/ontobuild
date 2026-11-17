import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { apiErrorMessage } from "@/lib/api/errors";

describe("API error messages", () => {
  it("shows the detail of a JSON error body, not the JSON", () => {
    const err = new ApiError(404, "Not Found", JSON.stringify({ detail: "Ontology file not found in repository: a.ttl" }));
    expect(apiErrorMessage(err)).toBe("Ontology file not found in repository: a.ttl");
    expect(err.detail).toBe("Ontology file not found in repository: a.ttl");
    expect(err.code).toBeNull();
  });

  it("exposes a code and other fields of the body", () => {
    const err = new ApiError(409, "Conflict", JSON.stringify({ detail: "x", code: "turtle_out_of_date", turtle_path: "a.ttl" }));
    expect(err.code).toBe("turtle_out_of_date");
    expect(err.body).toMatchObject({ turtle_path: "a.ttl" });
  });

  it("falls back to the body, the message or the fallback", () => {
    expect(apiErrorMessage(new ApiError(502, "Bad Gateway", "upstream down"))).toBe("upstream down");
    expect(new ApiError(500, "Internal Server Error", "").detail).toBe("500 Internal Server Error");
    expect(apiErrorMessage(new ApiError(422, "Unprocessable", JSON.stringify({ detail: [{ loc: "x" }] })))).toBe('{"detail":[{"loc":"x"}]}');
    expect(apiErrorMessage(new Error("network down"))).toBe("network down");
    expect(apiErrorMessage("fail", "Failed to load")).toBe("Failed to load");
    expect(apiErrorMessage(undefined)).toBe("Something went wrong");
  });
});
