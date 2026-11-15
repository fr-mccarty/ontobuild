import { describe, expect, it } from "vitest";
import { validateJson, type JsonSchema } from "@/server/agent/validate";

const schema: JsonSchema = {
  type: "object",
  properties: {
    iri: { type: "string", minLength: 1 },
    kind: { type: "string", enum: ["class", "individual"] },
    limit: { type: "integer", minimum: 1, maximum: 10 },
    ratio: { type: "number" },
    flag: { type: "boolean" },
    inverse: { type: ["string", "null"] },
    labels: {
      type: "array",
      items: {
        type: "object",
        properties: { value: { type: "string" }, lang: { type: "string" } },
        required: ["value"],
      },
    },
  },
  required: ["iri"],
};

describe("validateJson", () => {
  it("accepts valid input", () => {
    expect(
      validateJson(schema, {
        iri: "http://x#A",
        kind: "class",
        limit: 3,
        ratio: 0.5,
        flag: true,
        inverse: null,
        labels: [{ value: "A", lang: "en" }],
      }),
    ).toEqual([]);
  });

  it("reports missing required fields", () => {
    expect(validateJson(schema, {})).toEqual(["iri is required"]);
  });

  it("reports type mismatches", () => {
    const errors = validateJson(schema, { iri: 5, flag: "yes", ratio: "1" });
    expect(errors).toContain("iri must be string, got integer");
    expect(errors).toContain("flag must be boolean, got string");
    expect(errors).toContain("ratio must be number, got string");
  });

  it("distinguishes integer from number", () => {
    expect(validateJson(schema, { iri: "a", limit: 2.5 })).toEqual(["limit must be integer, got number"]);
    expect(validateJson(schema, { iri: "a", ratio: 2 })).toEqual([]);
  });

  it("checks enums and numeric bounds", () => {
    expect(validateJson(schema, { iri: "a", kind: "property" })[0]).toMatch(/kind must be one of "class", "individual"/);
    expect(validateJson(schema, { iri: "a", limit: 0 })).toEqual(["limit must be >= 1"]);
    expect(validateJson(schema, { iri: "a", limit: 11 })).toEqual(["limit must be <= 10"]);
  });

  it("validates array items and nested objects with paths", () => {
    const errors = validateJson(schema, { iri: "a", labels: [{ value: "ok" }, { lang: "en" }, "x"] });
    expect(errors).toEqual(["labels[1].value is required", "labels[2] must be object, got string"]);
  });

  it("supports union types", () => {
    expect(validateJson(schema, { iri: "a", inverse: "http://x#p" })).toEqual([]);
    expect(validateJson(schema, { iri: "a", inverse: 1 })).toEqual(["inverse must be string or null, got integer"]);
  });

  it("rejects non-objects and empty strings", () => {
    expect(validateJson(schema, [])).toEqual(["input must be object, got array"]);
    expect(validateJson(schema, null)).toEqual(["input must be object, got null"]);
    expect(validateJson(schema, { iri: "" })).toEqual(["iri must be at least 1 characters"]);
  });

  it("rejects additional properties only when disallowed", () => {
    expect(validateJson(schema, { iri: "a", extra: 1 })).toEqual([]);
    expect(validateJson({ ...schema, additionalProperties: false }, { iri: "a", extra: 1 })).toEqual([
      "extra is not an allowed property",
    ]);
  });
});
