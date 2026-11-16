import { describe, it, expect } from "vitest";
import { DataFactory, Parser, Store } from "n3";
import { updateIndividualInTurtle } from "@/lib/ontology/turtleIndividualUpdater";
import { TURTLE_FIXTURE } from "./fixtures";

const { namedNode } = DataFactory;

describe("updateIndividualInTurtle", () => {
  const baseData = {
    labels: [{ value: "Fido" }],
    comments: [{ value: "A specific dog" }],
    definitions: [],
    typeIris: ["http://example.org/ont#Dog"],
    sameAsIris: [],
    differentFromIris: [],
    objectPropertyAssertions: [],
    dataPropertyAssertions: [],
  };

  it("updates an individual and preserves other blocks", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      baseData,
    );
    expect(result).toContain("a owl:NamedIndividual, ex:Dog");
    expect(result).toContain('rdfs:label "Fido"');
    expect(result).toContain('rdfs:comment "A specific dog"');

    expect(result).toContain("ex:Animal a owl:Class");
    expect(result).toContain("ex:Dog a owl:Class");
  });

  it("throws when individual IRI is not found", () => {
    expect(() =>
      updateIndividualInTurtle(
        TURTLE_FIXTURE,
        "http://example.org/ont#NonExistent",
        baseData,
      ),
    ).toThrow(/Could not find individual/);
  });

  it("adds multiple type IRIs", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        typeIris: [
          "http://example.org/ont#Dog",
          "http://example.org/ont#Pet",
        ],
      },
    );
    expect(result).toContain("a owl:NamedIndividual, ex:Dog, ex:Pet");
  });

  it("adds sameAs assertions", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        sameAsIris: ["http://example.org/ont#fidoClone"],
      },
    );
    expect(result).toContain("owl:sameAs");
  });

  it("adds differentFrom assertions", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        differentFromIris: ["http://example.org/ont#rex"],
      },
    );
    expect(result).toContain("owl:differentFrom");
  });

  it("adds object property assertions", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        objectPropertyAssertions: [
          {
            propertyIri: "http://example.org/ont#hasPart",
            targetIri: "http://example.org/ont#tail",
          },
        ],
      },
    );
    expect(result).toContain("ex:hasPart ex:tail");
  });

  it("adds data property assertions with datatype", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        dataPropertyAssertions: [
          {
            propertyIri: "http://example.org/ont#hasAge",
            value: "5",
            datatype: "http://www.w3.org/2001/XMLSchema#integer",
          },
        ],
      },
    );
    expect(result).toContain('"5"^^xsd:integer');
  });

  it("adds plain data property assertions", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        dataPropertyAssertions: [
          {
            propertyIri: "http://example.org/ont#hasCode",
            value: "ABC123",
          },
        ],
      },
    );
    expect(result).toContain('"ABC123"');
  });

  it("adds deprecated flag", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        deprecated: true,
      },
    );
    expect(result).toContain("owl:deprecated true");
  });

  it("adds definitions", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        definitions: [{ value: "A particular dog named Fido" }],
      },
    );
    expect(result).toContain("skos:definition");
  });

  it("adds seeAlso and isDefinedBy", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        seeAlsoIris: ["http://example.org/ont#dogs"],
        isDefinedByIris: ["http://example.org/ont"],
      },
    );
    expect(result).toContain("rdfs:seeAlso");
    expect(result).toContain("rdfs:isDefinedBy");
  });

  it("adds annotations with literal values", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        annotations: [
          {
            property_iri:
              "http://www.w3.org/2004/02/skos/core#editorialNote",
            values: [{ value: "Needs review" }],
          },
        ],
      },
    );
    expect(result).toContain("skos:editorialNote");
  });

  it("adds annotations with IRI values", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        annotations: [
          {
            property_iri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
            values: [
              { value: "http://example.org/ont#dogs" },
            ],
          },
        ],
      },
    );
    expect(result).toContain("rdfs:seeAlso");
  });

  it("skips object property assertions without targetIri", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        objectPropertyAssertions: [
          {
            propertyIri: "http://example.org/ont#hasPart",
          },
        ],
      },
    );
    const fidoBlock = result.slice(
      result.indexOf("ex:fido"),
      result.indexOf(".", result.indexOf("ex:fido")) + 1,
    );
    expect(fidoBlock).not.toContain("ex:hasPart");
  });

  it("skips data property assertions without value", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        ...baseData,
        dataPropertyAssertions: [
          {
            propertyIri: "http://example.org/ont#hasAge",
          },
        ],
      },
    );
    const fidoBlock = result.slice(
      result.indexOf("ex:fido"),
      result.indexOf(".", result.indexOf("ex:fido")) + 1,
    );
    expect(fidoBlock).not.toContain("ex:hasAge");
  });

  it("generates single-line block when only type present", () => {
    const result = updateIndividualInTurtle(
      TURTLE_FIXTURE,
      "http://example.org/ont#fido",
      {
        labels: [],
        comments: [],
        definitions: [],
        typeIris: [],
        sameAsIris: [],
        differentFromIris: [],
        objectPropertyAssertions: [],
        dataPropertyAssertions: [],
      },
    );
    expect(result).toContain("ex:fido a owl:NamedIndividual .");
  });
});

describe("updateIndividualInTurtle block boundaries", () => {
  const P = "http://example.org/pizza#";
  const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const HEADER = `@prefix : <${P}> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <${RDFS}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

`;
  const NEXT = `:NextClass a owl:Class ; rdfs:label "Next" .
`;
  const update = {
    labels: [{ value: "Updated pizza" }],
    comments: [{ value: "crispy" }],
    definitions: [],
    typeIris: [`${P}Pizza`],
    sameAsIris: [],
    differentFromIris: [],
    objectPropertyAssertions: [],
    dataPropertyAssertions: [],
  };

  /** Updates :myPizza in `before + block + after` and checks the surroundings are untouched. */
  function check(block: string, before: string, after: string) {
    const source = before + block + after;
    const result = updateIndividualInTurtle(source, `${P}myPizza`, update);
    expect(result.startsWith(before)).toBe(true);
    expect(result.endsWith(after)).toBe(true);

    const store = new Store(new Parser().parse(result));
    const subject = namedNode(`${P}myPizza`);
    const values = (pred: string) => store.getObjects(subject, namedNode(pred), null).map((o) => o.value);
    expect(values(`${RDFS}label`)).toEqual(["Updated pizza"]);
    expect(values(`${RDFS}comment`)).toEqual(["crispy"]);
    expect(values(RDF_TYPE).sort()).toEqual([`${P}Pizza`, "http://www.w3.org/2002/07/owl#NamedIndividual"]);
    expect(result.slice(before.length, result.length - after.length)).not.toContain("My pizza");
    return { result, store };
  }

  it("keeps the next entity when `a` is repeated with a full IRI, as generateTurtleSnippet writes it", () => {
    // Regression: the `#` inside <...#Pizza> was read as a comment, hiding the `.` and
    // swallowing :NextClass into the individual's block.
    const block = `<${P}myPizza> a owl:NamedIndividual ;
    rdfs:label "My pizza" ;
    a <${P}Pizza> .`;
    const { store } = check(block, HEADER, `\n\n<${P}NextClass> a owl:Class ;\n    rdfs:label "Next Class" .\n`);
    expect(store.getObjects(namedNode(`${P}NextClass`), namedNode(`${RDFS}label`), null).map((o) => o.value)).toEqual([
      "Next Class",
    ]);
  });

  it("handles `a` repeated mid-list with prefixed names", () => {
    check(`:myPizza a owl:NamedIndividual ;\n    a :Pizza ;\n    rdfs:label "My pizza" .`, HEADER, `\n\n${NEXT}`);
  });

  it("ignores `.`, `;`, `#` and ` a ` inside literals", () => {
    check(
      `:myPizza a owl:NamedIndividual ;\n    rdfs:label "My pizza" ;\n    rdfs:comment "Ends. Then ; a :Pizza . # not a comment" ;\n    rdfs:seeAlso "it's \\"quoted\\" ." .`,
      HEADER,
      `\n\n${NEXT}`,
    );
  });

  it("ignores terminators inside long strings, including escaped and trailing quotes", () => {
    check(
      `:myPizza a owl:NamedIndividual ;\n    rdfs:label "My pizza" ;\n    rdfs:comment """Line one.\n:Fake a owl:Class .\nsay \\"""hi\\""" and "quoted\"""" ;\n    rdfs:seeAlso '''single . quoted''' .`,
      HEADER,
      `\n\n${NEXT}`,
    );
  });

  it("updates an individual that is last in the file", () => {
    check(`:myPizza a owl:NamedIndividual, :Pizza ;\n    rdfs:label "My pizza" .`, `${HEADER}${NEXT}\n`, "\n");
  });

  it("updates an individual without a trailing newline at the end of the file", () => {
    check(`:myPizza a owl:NamedIndividual, :Pizza ;\n    rdfs:label "My pizza" .`, `${HEADER}${NEXT}\n`, "");
  });

  it("keeps a comment that follows the individual, on the same line or the next", () => {
    check(
      `:myPizza a owl:NamedIndividual, :Pizza ; # types\n    rdfs:label "My pizza" .`,
      HEADER,
      ` # trailing . comment ;\n# Next section. a :Pizza ;\n${NEXT}`,
    );
  });

  it("handles blank nodes and collections inside the individual", () => {
    check(
      `:myPizza a owl:NamedIndividual, :Pizza ;\n    rdfs:label "My pizza" ;\n    :hasBase [ a :Base ; rdfs:label "thin. crust" ] ;\n    :toppings ( :Cheese [ rdfs:label "x" ] ) .`,
      HEADER,
      `\n\n${NEXT}`,
    );
  });

  it("does not stop at the dot in decimals or prefixed names", () => {
    check(
      `:myPizza a owl:NamedIndividual, :Pizza ;\n    :weight 1.5 ;\n    :ratio .25 ;\n    :size 1.2e3 ;\n    rdfs:seeAlso :v1.2 ;\n    rdfs:label "My pizza" ;\n    :price "9.99"^^xsd:decimal .`,
      HEADER,
      `\n\n${NEXT}`,
    );
  });

  it("does not select a statement that only references the individual", () => {
    const source = `${HEADER}:Other rdfs:seeAlso :myPizza .\n\n:myPizza a owl:NamedIndividual ;\n    rdfs:label "My pizza" .\n`;
    const result = updateIndividualInTurtle(source, `${P}myPizza`, update);
    expect(result).toContain(":Other rdfs:seeAlso :myPizza .");
    expect(() =>
      updateIndividualInTurtle(`${HEADER}:Other rdfs:seeAlso :ghost .\n`, `${P}ghost`, update),
    ).toThrow(/Could not find individual/);
  });

  it("keeps another statement on the same line", () => {
    check(`:myPizza a owl:NamedIndividual, :Pizza ; rdfs:label "My pizza" .`, HEADER, ` ${NEXT}`);
  });
});
