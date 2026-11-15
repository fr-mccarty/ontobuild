import { describe, it, expect } from "vitest";
import { updateClassInTurtle } from "@/lib/ontology/turtleClassUpdater";
import { TURTLE_FIXTURE } from "./fixtures";

describe("updateClassInTurtle", () => {
  const baseData = {
    labels: [{ value: "Dog" }],
    comments: [{ value: "A domesticated canine" }],
    parent_iris: ["http://example.org/ont#Animal"],
  };

  it("updates a class and preserves other blocks", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      baseData,
    );
    expect(result).toContain("ex:Dog");
    expect(result).toContain('rdfs:label "Dog"');
    expect(result).toContain("rdfs:subClassOf ex:Animal");

    expect(result).toContain('rdfs:label "Animal"');
    expect(result).toContain('rdfs:comment "A living organism"');
  });

  it("throws when class IRI is not found", () => {
    expect(() =>
      updateClassInTurtle(
        TURTLE_FIXTURE,
        "http://example.org/ont#NonExistent",
        baseData,
      ),
    ).toThrow(/Could not find class/);
  });

  it("updates labels", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      {
        labels: [
          { value: "Dog" },
          { value: "Hund" },
        ],
        comments: [],
        parent_iris: [],
      },
    );
    expect(result).toContain('"Dog"');
    expect(result).toContain('"Hund"');
  });

  it("removes comments when given empty array", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      {
        labels: [{ value: "Dog" }],
        comments: [],
        parent_iris: ["http://example.org/ont#Animal"],
      },
    );
    const dogBlockStart = result.indexOf("ex:Dog");
    const dogBlockEnd = result.indexOf(".", dogBlockStart);
    const dogBlock = result.slice(dogBlockStart, dogBlockEnd + 1);
    expect(dogBlock).not.toContain("rdfs:comment");
    expect(result).toContain("A living organism");
  });

  it("removes parent classes when given empty array", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      {
        labels: [{ value: "Dog" }],
        comments: [],
        parent_iris: [],
      },
    );
    const dogBlockStart = result.indexOf("ex:Dog");
    const dogBlockEnd = result.indexOf(".", dogBlockStart);
    const dogBlock = result.slice(dogBlockStart, dogBlockEnd + 1);
    expect(dogBlock).not.toContain("rdfs:subClassOf");
  });

  it("adds deprecated flag", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      {
        ...baseData,
        deprecated: true,
      },
    );
    expect(result).toContain("owl:deprecated true");
  });

  it("adds equivalent classes", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      {
        ...baseData,
        equivalent_iris: ["http://example.org/ont#Canine"],
      },
    );
    expect(result).toContain("owl:equivalentClass");
  });

  it("adds disjoint classes", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      {
        ...baseData,
        disjoint_iris: ["http://example.org/ont#Cat"],
      },
    );
    expect(result).toContain("owl:disjointWith");
  });

  it("adds annotations", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      {
        ...baseData,
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            values: [{ value: "Dog" }],
          },
        ],
      },
    );
    expect(result).toContain("skos:prefLabel");
    expect(result).toContain('"Dog"');
  });

  it("handles annotation with IRI value", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      {
        ...baseData,
        annotations: [
          {
            property_iri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
            values: [{ value: "http://example.org/ont#Canine" }],
          },
        ],
      },
    );
    expect(result).toContain("rdfs:seeAlso");
  });

  it("skips empty label values", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      {
        labels: [
          { value: "Dog" },
          { value: "   " },
        ],
        comments: [],
        parent_iris: [],
      },
    );
    const dogBlockStart = result.indexOf("ex:Dog");
    const dogBlockEnd = result.indexOf(".", dogBlockStart);
    const dogBlock = result.slice(dogBlockStart, dogBlockEnd + 1);
    expect((dogBlock.match(/rdfs:label/g) || []).length).toBe(1);
  });

  it("generates single-line block when only type is present", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      {
        labels: [],
        comments: [],
        parent_iris: [],
      },
    );
    expect(result).toContain("ex:Dog a owl:Class .");
  });

  it("preserves prefix declarations", () => {
    const result = updateClassInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#Dog",
      baseData,
    );
    expect(result).toContain("@prefix ex:");
    expect(result).toContain("@prefix owl:");
    expect(result).toContain("@prefix rdfs:");
  });
});
