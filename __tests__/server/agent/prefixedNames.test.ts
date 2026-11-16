import { describe, expect, it } from "vitest";
import { expandPrefixedIris, hasPrefixedIris, isIriField } from "@/server/agent/prefixedNames";

const declared = { "": "http://example.org/pizza#", ex: "http://example.org/other/" };
const wellKnown = { owl: "http://www.w3.org/2002/07/owl#", xsd: "http://www.w3.org/2001/XMLSchema#" };

describe("prefixed names in agent tool inputs", () => {
  it("knows which fields hold IRIs", () => {
    for (const k of ["iri", "parent_iri", "type_iris", "inverse_of", "characteristics", "datatype", "property_iri"]) {
      expect(isIriField(k)).toBe(true);
    }
    for (const k of ["label", "labels", "comment", "values", "value", "query", "name", "commit_message"]) {
      expect(isIriField(k)).toBe(false);
    }
  });

  it("expands the empty prefix, declared prefixes and well-known ones", () => {
    const { input, errors } = expandPrefixedIris(
      {
        iri: ":Margherita",
        parent_iris: [":Pizza", "ex:Thing"],
        characteristics: ["owl:FunctionalProperty"],
        data_assertions: [{ property_iri: ":hasCalories", value: "250", datatype: "xsd:integer" }],
      },
      declared,
      wellKnown,
    );
    expect(errors).toEqual([]);
    expect(input).toEqual({
      iri: "http://example.org/pizza#Margherita",
      parent_iris: ["http://example.org/pizza#Pizza", "http://example.org/other/Thing"],
      characteristics: ["http://www.w3.org/2002/07/owl#FunctionalProperty"],
      data_assertions: [
        { property_iri: "http://example.org/pizza#hasCalories", value: "250", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
      ],
    });
  });

  it("lets a declared prefix override a well-known one", () => {
    const { input } = expandPrefixedIris({ iri: "owl:Thing" }, { owl: "http://custom/owl#" }, wellKnown);
    expect(input.iri).toBe("http://custom/owl#Thing");
  });

  it("leaves full IRIs and other URI schemes alone, and unwraps <...>", () => {
    const { input, errors } = expandPrefixedIris(
      {
        iri: "http://example.org/pizza#Pizza",
        same_as_iris: ["urn:isbn:0451450523", "mailto:chef@example.org", "<http://example.org/pizza#Crust>"],
      },
      declared,
    );
    expect(errors).toEqual([]);
    expect(input).toEqual({
      iri: "http://example.org/pizza#Pizza",
      same_as_iris: ["urn:isbn:0451450523", "mailto:chef@example.org", "http://example.org/pizza#Crust"],
    });
  });

  it("never rewrites labels, comments or annotation values", () => {
    const original = {
      labels: [{ value: "ex:NotAnIri" }],
      comment: "see :Pizza",
      annotations: [{ property_iri: "ex:note", values: [{ value: "ex:literal" }] }],
    };
    const { input } = expandPrefixedIris(original, declared);
    expect(input.labels).toEqual([{ value: "ex:NotAnIri" }]);
    expect(input.comment).toBe("see :Pizza");
    expect(input.annotations).toEqual([{ property_iri: "http://example.org/other/note", values: [{ value: "ex:literal" }] }]);
  });

  it("reports an unknown prefix instead of guessing", () => {
    const { errors } = expandPrefixedIris({ parent_iri: "piza:Pizza" }, declared, wellKnown);
    expect(errors).toEqual([
      'parent_iri: unknown prefix "piza:" in "piza:Pizza". Use a prefix declared in the ontology file or a full IRI.',
    ]);
  });

  it("only asks for the file's prefixes when an IRI field needs them", () => {
    expect(hasPrefixedIris({ iri: "http://example.org/pizza#Pizza", label: "a:b" })).toBe(false);
    expect(hasPrefixedIris({ iri: ":Pizza" })).toBe(true);
    expect(hasPrefixedIris({ object_assertions: [{ property_iri: "http://x/p", target_iri: "ex:t" }] })).toBe(true);
  });
});
