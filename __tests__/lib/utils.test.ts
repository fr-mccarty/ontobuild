import { describe, expect, it } from "vitest";
import {
  getLocalName,
  getPreferredLabel,
  formatDate,
  formatDateTime,
  debounce,
} from "@/lib/utils";

describe("getLocalName", () => {
  it("extracts name after hash", () => {
    expect(getLocalName("http://example.org/ontology#Person")).toBe("Person");
  });

  it("extracts name after last slash", () => {
    expect(getLocalName("http://example.org/ontology/Person")).toBe("Person");
  });

  it("returns full string when no delimiter", () => {
    expect(getLocalName("Person")).toBe("Person");
  });

  it("handles hash with empty local name", () => {
    expect(getLocalName("http://example.org/ontology#")).toBe("");
  });

  it("prefers hash over slash", () => {
    expect(getLocalName("http://example.org/ontology#ns/Person")).toBe("ns/Person");
  });
});

describe("getPreferredLabel", () => {
  it("returns the first label", () => {
    expect(getPreferredLabel([{ value: "Person" }, { value: "Human" }])).toBe("Person");
  });

  it("skips empty labels", () => {
    expect(getPreferredLabel([{ value: "  " }, { value: "Person" }])).toBe("Person");
  });

  it("returns empty string for empty array", () => {
    expect(getPreferredLabel([])).toBe("");
  });
});


describe("formatDate", () => {
  it("formats a date string", () => {
    const result = formatDate("2024-01-15T10:30:00Z");
    expect(result).toContain("2024");
    expect(result).toContain("15");
  });
});

describe("formatDateTime", () => {
  it("formats a date string with time", () => {
    const result = formatDateTime("2024-01-15T10:30:00Z");
    expect(result).toContain("2024");
  });
});

describe("debounce", () => {
  it("delays function execution", async () => {
    let callCount = 0;
    const fn = debounce(() => {
      callCount++;
    }, 50);

    fn();
    fn();
    fn();

    expect(callCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(callCount).toBe(1);
  });
});
