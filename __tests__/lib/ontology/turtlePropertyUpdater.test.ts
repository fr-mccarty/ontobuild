import { describe, it, expect } from "vitest";
import { updatePropertyInTurtle } from "@/lib/ontology/turtlePropertyUpdater";
import { TURTLE_FIXTURE } from "./fixtures";

describe("updatePropertyInTurtle", () => {
  const baseData = {
    propertyType: "object" as const,
    labels: [{ value: "has part", lang: "en" }],
    comments: [],
    definitions: [],
    domainIris: ["http://example.org/ont#Animal"],
    rangeIris: ["http://example.org/ont#Animal"],
    parentIris: [],
    inverseOf: null,
    characteristics: [],
  };

  it("updates an object property", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      baseData,
    );
    expect(result).toContain("a owl:ObjectProperty");
    expect(result).toContain('rdfs:label "has part"@en');
    expect(result).toContain("rdfs:domain ex:Animal");
    expect(result).toContain("rdfs:range ex:Animal");
  });

  it("throws when property IRI is not found", () => {
    expect(() =>
      updatePropertyInTurtle(
        TURTLE_FIXTURE,
        "http://example.org/ont#NonExistent",
        baseData,
      ),
    ).toThrow(/Could not find property/);
  });

  it("generates a data property block", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasAge",
      {
        ...baseData,
        propertyType: "data",
        labels: [{ value: "has age", lang: "en" }],
        rangeIris: ["http://www.w3.org/2001/XMLSchema#integer"],
      },
    );
    expect(result).toContain("a owl:DatatypeProperty");
  });

  it("generates an annotation property block", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#note",
      {
        ...baseData,
        propertyType: "annotation",
        labels: [{ value: "note", lang: "en" }],
        domainIris: [],
        rangeIris: [],
      },
    );
    expect(result).toContain("a owl:AnnotationProperty");
  });

  it("adds characteristics to type line", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      {
        ...baseData,
        characteristics: [
          "http://www.w3.org/2002/07/owl#FunctionalProperty",
          "http://www.w3.org/2002/07/owl#TransitiveProperty",
        ],
      },
    );
    expect(result).toContain(
      "a owl:ObjectProperty, owl:FunctionalProperty, owl:TransitiveProperty",
    );
  });

  it("adds inverseOf", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      {
        ...baseData,
        inverseOf: "http://example.org/ont#isPartOf",
      },
    );
    expect(result).toContain("owl:inverseOf ex:isPartOf");
  });

  it("adds parent properties", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      {
        ...baseData,
        parentIris: ["http://example.org/ont#relatedTo"],
      },
    );
    expect(result).toContain("rdfs:subPropertyOf");
  });

  it("adds deprecated flag", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      {
        ...baseData,
        deprecated: true,
      },
    );
    expect(result).toContain("owl:deprecated true");
  });

  it("adds equivalent properties", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      {
        ...baseData,
        equivalentIris: ["http://example.org/ont#hasPiece"],
      },
    );
    expect(result).toContain("owl:equivalentProperty");
  });

  it("adds disjoint properties", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      {
        ...baseData,
        disjointIris: ["http://example.org/ont#hasWhole"],
      },
    );
    expect(result).toContain("owl:propertyDisjointWith");
  });

  it("adds seeAlso and isDefinedBy", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      {
        ...baseData,
        seeAlsoIris: ["http://example.org/ont#composition"],
        isDefinedByIris: ["http://example.org/ont"],
      },
    );
    expect(result).toContain("rdfs:seeAlso");
    expect(result).toContain("rdfs:isDefinedBy");
  });

  it("adds definitions", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      {
        ...baseData,
        definitions: [{ value: "Relates a whole to its parts", lang: "en" }],
      },
    );
    expect(result).toContain("skos:definition");
  });

  it("adds annotations with literal values", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      {
        ...baseData,
        annotations: [
          {
            property_iri:
              "http://www.w3.org/2004/02/skos/core#editorialNote",
            values: [{ value: "Review needed", lang: "en" }],
          },
        ],
      },
    );
    expect(result).toContain("skos:editorialNote");
  });

  it("preserves other blocks when updating a property", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      baseData,
    );
    expect(result).toContain("ex:Animal a owl:Class");
    expect(result).toContain("ex:Dog a owl:Class");
    expect(result).toContain("ex:fido a owl:NamedIndividual");
  });

  it("generates single-line block when only type present", () => {
    const result = updatePropertyInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#hasPart",
      {
        propertyType: "object",
        labels: [],
        comments: [],
        definitions: [],
        domainIris: [],
        rangeIris: [],
        parentIris: [],
        inverseOf: null,
        characteristics: [],
      },
    );
    expect(result).toContain("ex:hasPart a owl:ObjectProperty .");
  });
});

describe("updatePropertyInTurtle with plain rdf:Property", () => {
  const RDFS_ONLY = `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix ex: <http://ex.org/> .

ex:birthDate a rdf:Property, ex:AuditedTerm ;
    rdfs:label "birth date" .
`;
  const data = {
    propertyType: "other" as const,
    labels: [{ value: "date of birth", lang: "" }],
    comments: [],
    definitions: [],
    domainIris: [],
    rangeIris: [],
    parentIris: [],
    inverseOf: null,
    characteristics: [],
  };

  it("keeps rdf:Property and other existing types instead of rewriting to owl:ObjectProperty", () => {
    const result = updatePropertyInTurtle(RDFS_ONLY, "http://ex.org/birthDate", data);
    expect(result).toContain("ex:birthDate a rdf:Property, ex:AuditedTerm ;");
    expect(result).toContain('rdfs:label "date of birth"');
    expect(result).not.toContain("ObjectProperty");
  });

  it("writes full IRIs for vocabulary terms whose prefix is not declared", () => {
    const result = updatePropertyInTurtle(RDFS_ONLY, "http://ex.org/birthDate", {
      ...data,
      propertyType: "data",
      characteristics: ["http://www.w3.org/2002/07/owl#FunctionalProperty"],
      definitions: [{ value: "When the person was born", lang: "en" }],
    });
    expect(result).toContain(
      "a <http://www.w3.org/2002/07/owl#DatatypeProperty>, <http://www.w3.org/2002/07/owl#FunctionalProperty>, rdf:Property, ex:AuditedTerm ;",
    );
    expect(result).toContain('<http://www.w3.org/2004/02/skos/core#definition> "When the person was born"@en');
    expect(result).not.toMatch(/\bowl:/);
    expect(result).not.toMatch(/\bskos:/);
  });

  it("falls back to rdf:Property when an untyped property is saved", () => {
    const untyped = `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix ex: <http://ex.org/> .

ex:note rdfs:label "note" .
`;
    const result = updatePropertyInTurtle(untyped, "http://ex.org/note", { ...data, labels: [] });
    expect(result).toContain("ex:note a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> .");
  });

  it("drops a characteristic that was unchecked while keeping unmanaged types", () => {
    const src = `@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix ex: <http://ex.org/> .

ex:knows a owl:ObjectProperty, owl:SymmetricProperty, ex:SocialTerm .
`;
    const result = updatePropertyInTurtle(src, "http://ex.org/knows", {
      ...data,
      propertyType: "object",
      labels: [],
    });
    expect(result).toContain("ex:knows a owl:ObjectProperty, ex:SocialTerm .");
  });
});
