import { describe, expect, it } from "vitest";
import type { Rule } from "@/lib/api/rules";
import { emptyRuleForm, formToInput, ruleToForm } from "@/lib/rules/ruleForm";

const CLASS_IRI = "http://example.org/Book";

const fullRule: Rule = {
  iri: "http://example.org/rule-Book-isbn",
  applies_to_iri: CLASS_IRI,
  property_iri: "http://example.org/isbn",
  min_count: 1,
  max_count: 1,
  value_class_iri: "http://example.org/Isbn",
  value_datatype_iri: "http://www.w3.org/2001/XMLSchema#string",
  allowed_values: [
    { value: "a", type: "literal", datatype: "http://www.w3.org/2001/XMLSchema#string" },
    { value: "http://example.org/b", type: "iri" },
  ],
  pattern: "^[0-9]{13}$",
  min_length: 13,
  max_length: 13,
  closed: true,
  severity: "warning",
  label: "ISBN",
  message: "Needs an ISBN",
  read_only: false,
  imported_from: null,
};

describe("formToInput", () => {
  it("sends only what is filled in, because a rule is replaced whole", () => {
    const form = { ...emptyRuleForm(), propertyIri: "http://example.org/isbn", minCount: "1", message: "  ", pattern: "" };
    expect(formToInput(CLASS_IRI, form)).toEqual({
      applies_to_iri: CLASS_IRI,
      property_iri: "http://example.org/isbn",
      min_count: 1,
      closed: false,
      severity: "error",
    });
  });

  it("keeps a zero count and drops blank allowed values", () => {
    const form = {
      ...emptyRuleForm(),
      propertyIri: "http://example.org/isbn",
      maxCount: "0",
      allowedValues: [
        { value: "  ", type: "literal" as const },
        { value: "x", type: "literal" as const },
      ],
    };
    const input = formToInput(CLASS_IRI, form);
    expect(input.max_count).toBe(0);
    expect(input.allowed_values).toEqual([{ value: "x", type: "literal" }]);
  });

  it("round-trips a rule through the form without losing a field", () => {
    const { iri, read_only, imported_from, ...fields } = fullRule;
    void iri;
    void read_only;
    void imported_from;
    expect(formToInput(CLASS_IRI, ruleToForm(fullRule))).toEqual(fields);
  });
});
