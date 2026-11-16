import { describe, it, expect } from "vitest";
import { generateTurtleSnippet } from "@/lib/ontology/turtleSnippetGenerator";

describe("generateTurtleSnippet", () => {

  it("generates a class snippet", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Foo",
      label: "Foo",
      entityType: "class",
    });
    expect(snippet).toContain("a owl:Class");
    expect(snippet).toContain('rdfs:label "Foo"');
    expect(snippet).toMatch(/\.\s*$/);
  });

  it("generates an object property snippet", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#hasPart",
      label: "has part",
      entityType: "objectProperty",
    });
    expect(snippet).toContain("a owl:ObjectProperty");
    expect(snippet).toContain('rdfs:label "has part"');
  });

  it("generates a data property snippet", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#age",
      label: "age",
      entityType: "dataProperty",
    });
    expect(snippet).toContain("a owl:DatatypeProperty");
  });

  it("generates an annotation property snippet", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#note",
      label: "note",
      entityType: "annotationProperty",
    });
    expect(snippet).toContain("a owl:AnnotationProperty");
  });

  it("generates an individual snippet", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#john",
      label: "John",
      entityType: "individual",
    });
    expect(snippet).toContain("a owl:NamedIndividual");
  });

  it("adds rdfs:subClassOf for a class with parent", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Dog",
      label: "Dog",
      entityType: "class",
      parentIri: "http://example.org/ont#Animal",
    });
    expect(snippet).toContain("rdfs:subClassOf");
    expect(snippet).toContain("<http://example.org/ont#Animal>");
  });

  it("adds rdfs:subPropertyOf for a property with parent", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#hasDirectPart",
      label: "has direct part",
      entityType: "objectProperty",
      parentIri: "http://example.org/ont#hasPart",
    });
    expect(snippet).toContain("rdfs:subPropertyOf");
  });

  it("adds rdf:type for an individual with parent class", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#fido",
      label: "Fido",
      entityType: "individual",
      parentIri: "http://example.org/ont#Dog",
    });
    expect(snippet).toMatch(/\n\s+a \S+ \.\n$/);
  });

  it("uses prefixed names when prefix and namespace are available", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Foo",
      label: "Foo",
      entityType: "class",
      ontologyPrefix: "ex",
      ontologyNamespace: "http://example.org/ont#",
    });
    expect(snippet).toContain("ex:Foo a owl:Class");
    expect(snippet).not.toContain("<http://example.org/ont#Foo>");
  });

  it("uses prefixed names for parent when in same namespace", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Dog",
      label: "Dog",
      entityType: "class",
      parentIri: "http://example.org/ont#Animal",
      ontologyPrefix: "ex",
      ontologyNamespace: "http://example.org/ont#",
    });
    expect(snippet).toContain("rdfs:subClassOf ex:Animal");
  });

  it("falls back to full IRI when no prefix is available", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Foo",
      label: "Foo",
      entityType: "class",
    });
    expect(snippet).toContain("<http://example.org/ont#Foo>");
  });

  it("falls back to full IRI for parent in different namespace", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Dog",
      label: "Dog",
      entityType: "class",
      parentIri: "http://other.org/ont#Animal",
      ontologyPrefix: "ex",
      ontologyNamespace: "http://example.org/ont#",
    });
    expect(snippet).toContain("<http://other.org/ont#Animal>");
  });

  it("escapes double quotes in labels", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Test",
      label: 'He said "hello"',
      entityType: "class",
    });
    expect(snippet).toContain('rdfs:label "He said \\"hello\\""');
  });

  it("escapes backslashes in labels", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Test",
      label: "path\\to\\thing",
      entityType: "class",
    });
    expect(snippet).toContain('rdfs:label "path\\\\to\\\\thing"');
  });

  it("starts with a blank line for separation", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Foo",
      label: "Foo",
      entityType: "class",
    });
    expect(snippet.startsWith("\n")).toBe(true);
  });

  it("ends with a newline", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Foo",
      label: "Foo",
      entityType: "class",
    });
    expect(snippet.endsWith("\n")).toBe(true);
  });

  it("ends the triple block with a period", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Foo",
      label: "Foo",
      entityType: "class",
    });
    expect(snippet.trimEnd()).toMatch(/\.$/);
  });

  it("escapes newlines and tabs in labels so the snippet stays valid Turtle", () => {
    const snippet = generateTurtleSnippet({
      iri: "http://example.org/ont#Foo",
      label: "line one\nline\ttwo",
      entityType: "class",
    });
    expect(snippet).toContain('rdfs:label "line one\\nline\\ttwo"');
  });

  describe("with the file's declared prefixes", () => {
    const prefixes = {
      "": "http://example.org/pizza#",
      foaf: "http://xmlns.com/foaf/0.1/",
      owl: "http://www.w3.org/2002/07/owl#",
    };

    it("writes the subject and parent with the empty prefix", () => {
      const out = generateTurtleSnippet({
        iri: "http://example.org/pizza#Margherita",
        label: "Margherita",
        entityType: "individual",
        parentIri: "http://example.org/pizza#Pizza",
        prefixes,
      });
      expect(out).toBe('\n:Margherita a owl:NamedIndividual ;\n    rdfs:label "Margherita" ;\n    a :Pizza .\n');
    });

    it("uses any declared prefix for the parent, not only the ontology's", () => {
      const out = generateTurtleSnippet({
        iri: "http://example.org/pizza#Chef",
        label: "Chef",
        entityType: "class",
        parentIri: "http://xmlns.com/foaf/0.1/Person",
        prefixes,
      });
      expect(out).toContain(":Chef a owl:Class ;");
      expect(out).toContain("rdfs:subClassOf foaf:Person .");
    });

    it("keeps full IRIs that no declared prefix covers or that aren't safe local names", () => {
      const out = generateTurtleSnippet({
        iri: "http://example.org/pizza#123",
        label: "Odd",
        entityType: "class",
        parentIri: "http://other.org/Thing",
        prefixes,
      });
      expect(out).toContain("<http://example.org/pizza#123> a owl:Class ;");
      expect(out).toContain("rdfs:subClassOf <http://other.org/Thing> .");
    });
  });
});
