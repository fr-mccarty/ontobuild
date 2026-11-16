import { describe, it, expect } from "vitest";
import {
  parseDeclarations,
  reverseMap,
  toTurtle,
  iriTurtleForms,
  findBlock,
  findBlockSpan,
  scanToBlockEnd,
  literal,
  isIriValue,
  escapeRegex,
  esc,
} from "@/lib/ontology/turtleUtils";
import {
  TURTLE_FIXTURE,
  TURTLE_WITH_BASE,
  TURTLE_SPARQL_PREFIX,
  TURTLE_DEFAULT_PREFIX,
} from "./fixtures";

describe("parseDeclarations", () => {
  it("parses @prefix declarations", () => {
    const { prefixes } = parseDeclarations(TURTLE_FIXTURE);
    expect(prefixes["ex"]).toBe("http://example.org/ont#");
    expect(prefixes["owl"]).toBe("http://www.w3.org/2002/07/owl#");
    expect(prefixes["rdfs"]).toBe("http://www.w3.org/2000/01/rdf-schema#");
    expect(prefixes["rdf"]).toBe(
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    );
  });

  it("parses SPARQL-style PREFIX declarations", () => {
    const { prefixes } = parseDeclarations(TURTLE_SPARQL_PREFIX);
    expect(prefixes["ex"]).toBe("http://example.org/ont#");
    expect(prefixes["owl"]).toBe("http://www.w3.org/2002/07/owl#");
  });

  it("parses @base declarations", () => {
    const { base } = parseDeclarations(TURTLE_WITH_BASE);
    expect(base).toBe("http://example.org/ont#");
  });

  it("returns undefined base when none declared", () => {
    const { base } = parseDeclarations(TURTLE_FIXTURE);
    expect(base).toBeUndefined();
  });

  it("parses default (empty) prefix", () => {
    const { prefixes } = parseDeclarations(TURTLE_DEFAULT_PREFIX);
    expect(prefixes[""]).toBe("http://example.org/ont#");
  });

  it("handles source with no declarations", () => {
    const { prefixes, base } = parseDeclarations("# just a comment\n");
    expect(Object.keys(prefixes)).toHaveLength(0);
    expect(base).toBeUndefined();
  });

  it("handles empty string", () => {
    const { prefixes, base } = parseDeclarations("");
    expect(Object.keys(prefixes)).toHaveLength(0);
    expect(base).toBeUndefined();
  });
});

describe("reverseMap", () => {
  it("creates namespace-to-alias mapping", () => {
    const rev = reverseMap({ ex: "http://example.org/ont#" });
    expect(rev.get("http://example.org/ont#")).toBe("ex");
  });

  it("prefers shorter alias when multiple map to same namespace", () => {
    const rev = reverseMap({
      e: "http://example.org/ont#",
      example: "http://example.org/ont#",
    });
    expect(rev.get("http://example.org/ont#")).toBe("e");
  });
});

describe("toTurtle", () => {
  const rev = reverseMap({ ex: "http://example.org/ont#" });

  it("converts IRI to prefixed form", () => {
    expect(toTurtle("http://example.org/ont#Dog", rev)).toBe("ex:Dog");
  });

  it("falls back to full IRI when no prefix matches", () => {
    expect(toTurtle("http://other.org/Foo", rev)).toBe(
      "<http://other.org/Foo>",
    );
  });

  it("uses the empty prefix as a bare colon", () => {
    const withDefault = reverseMap({ "": "http://example.org/ont#" });
    expect(toTurtle("http://example.org/ont#Dog", withDefault)).toBe(":Dog");
  });

  it("prefers the longest matching namespace", () => {
    const nested = reverseMap({ ex: "http://example.org/", exo: "http://example.org/ont/" });
    expect(toTurtle("http://example.org/ont/Dog", nested)).toBe("exo:Dog");
    expect(toTurtle("http://example.org/Cat", nested)).toBe("ex:Cat");
  });

  it("falls back to full IRI when local name is not valid QName", () => {
    expect(toTurtle("http://example.org/ont#123invalid", rev)).toBe(
      "<http://example.org/ont#123invalid>",
    );
  });

  it("handles empty prefix (default namespace)", () => {
    const revDefault = reverseMap({ "": "http://example.org/ont#" });
    expect(toTurtle("http://example.org/ont#Foo", revDefault)).toBe(":Foo");
  });

  it("handles IRI with no local name part", () => {
    expect(toTurtle("http://example.org/ont#", rev)).toBe(
      "<http://example.org/ont#>",
    );
  });
});

describe("iriTurtleForms", () => {
  it("always includes full IRI form", () => {
    const forms = iriTurtleForms("http://example.org/ont#Dog", {}, undefined);
    expect(forms).toContain("<http://example.org/ont#Dog>");
  });

  it("includes prefixed form when prefix matches", () => {
    const forms = iriTurtleForms(
      "http://example.org/ont#Dog",
      { ex: "http://example.org/ont#" },
      undefined,
    );
    expect(forms).toContain("ex:Dog");
  });

  it("includes relative IRI form when @base matches", () => {
    const forms = iriTurtleForms(
      "http://example.org/ont#Dog",
      {},
      "http://example.org/ont#",
    );
    expect(forms).toContain("<Dog>");
  });

  it("includes all three forms when both prefix and base match", () => {
    const forms = iriTurtleForms(
      "http://example.org/ont#Dog",
      { ex: "http://example.org/ont#" },
      "http://example.org/ont#",
    );
    expect(forms).toContain("<http://example.org/ont#Dog>");
    expect(forms).toContain("ex:Dog");
    expect(forms).toContain("<Dog>");
  });

  it("includes default prefix form", () => {
    const forms = iriTurtleForms("http://example.org/ont#Bird", {
      "": "http://example.org/ont#",
    });
    expect(forms).toContain(":Bird");
  });

  it("does not include relative form when base does not match", () => {
    const forms = iriTurtleForms(
      "http://example.org/ont#Dog",
      {},
      "http://other.org/",
    );
    expect(forms).toHaveLength(1);
    expect(forms[0]).toBe("<http://example.org/ont#Dog>");
  });

  it("does not include relative form when relative part is empty", () => {
    const forms = iriTurtleForms(
      "http://example.org/ont#",
      {},
      "http://example.org/ont#",
    );
    expect(forms).toEqual(["<http://example.org/ont#>"]);
  });
});

describe("scanToBlockEnd", () => {
  it("finds terminating period on same line", () => {
    const lines = ["ex:Dog a owl:Class ."];
    expect(scanToBlockEnd(lines, 0)).toBe(0);
  });

  it("finds terminating period on later line", () => {
    const lines = [
      "ex:Dog a owl:Class ;",
      '    rdfs:label "Dog"@en .',
    ];
    expect(scanToBlockEnd(lines, 0)).toBe(1);
  });

  it("handles nested brackets", () => {
    const lines = [
      "ex:Dog a owl:Class ;",
      "    rdfs:subClassOf [",
      "        a owl:Restriction ;",
      "        owl:onProperty ex:hasAge",
      "    ] .",
    ];
    expect(scanToBlockEnd(lines, 0)).toBe(4);
  });

  it("ignores periods inside string literals", () => {
    const lines = ['ex:Dog rdfs:label "Dr. Dog"@en .'];
    expect(scanToBlockEnd(lines, 0)).toBe(0);
  });

  it("ignores periods inside comments", () => {
    const lines = [
      "ex:Dog a owl:Class ; # this has a . in comment",
      '    rdfs:label "Dog"@en .',
    ];
    expect(scanToBlockEnd(lines, 0)).toBe(1);
  });

  it("handles triple-quoted strings", () => {
    const lines = [
      'ex:Doc rdfs:comment """A class with a',
      'multi-line. comment"""@en .',
    ];
    expect(scanToBlockEnd(lines, 0)).toBe(1);
  });

  it("returns last line index when no terminator found", () => {
    const lines = ["ex:Dog a owl:Class ;", '    rdfs:label "Dog"@en'];
    expect(scanToBlockEnd(lines, 0)).toBe(1);
  });

  it("handles escaped quotes inside strings", () => {
    const lines = ['ex:Dog rdfs:label "say \\"hello\\"."@en .'];
    expect(scanToBlockEnd(lines, 0)).toBe(0);
  });
});

describe("findBlock", () => {
  it("finds a block by prefixed name", () => {
    const lines = TURTLE_FIXTURE.split("\n");
    const { prefixes } = parseDeclarations(TURTLE_FIXTURE);
    const block = findBlock(
      lines,
      "http://example.org/ont#Dog",
      prefixes,
      undefined,
    );
    expect(block).not.toBeNull();
    expect(lines[block!.startLine]).toContain("ex:Dog");
    expect(lines[block!.endLine]).toContain(".");
  });

  it("finds a block by full IRI", () => {
    const source = `<http://example.org/ont#Foo> a owl:Class .`;
    const lines = source.split("\n");
    const block = findBlock(
      lines,
      "http://example.org/ont#Foo",
      {},
      undefined,
    );
    expect(block).not.toBeNull();
    expect(block!.startLine).toBe(0);
  });

  it("finds a block using @base relative IRI", () => {
    const lines = TURTLE_WITH_BASE.split("\n");
    const { prefixes, base } = parseDeclarations(TURTLE_WITH_BASE);
    const block = findBlock(
      lines,
      "http://example.org/ont#Animal",
      prefixes,
      base,
    );
    expect(block).not.toBeNull();
    expect(lines[block!.startLine]).toContain("<Animal>");
  });

  it("returns null for non-existent entity", () => {
    const lines = TURTLE_FIXTURE.split("\n");
    const { prefixes } = parseDeclarations(TURTLE_FIXTURE);
    const block = findBlock(
      lines,
      "http://example.org/ont#NonExistent",
      prefixes,
      undefined,
    );
    expect(block).toBeNull();
  });

  it("skips comment and prefix lines", () => {
    const source = `# ex:Fake is mentioned here\n@prefix ex: <http://example.org/ont#> .\nex:Real a owl:Class .`;
    const lines = source.split("\n");
    const { prefixes } = parseDeclarations(source);
    const block = findBlock(
      lines,
      "http://example.org/ont#Real",
      prefixes,
      undefined,
    );
    expect(block).not.toBeNull();
    expect(block!.startLine).toBe(2);
  });

  it("does not match continuation lines as subject position", () => {
    const source = [
      "@prefix ex: <http://example.org/ont#> .",
      "ex:A a owl:Class ;",
      "    rdfs:subClassOf ex:B .",
      "ex:B a owl:Class .",
    ].join("\n");
    const lines = source.split("\n");
    const { prefixes } = parseDeclarations(source);
    const block = findBlock(
      lines,
      "http://example.org/ont#B",
      prefixes,
      undefined,
    );
    expect(block).not.toBeNull();
    expect(block!.startLine).toBe(3);
  });

  it("uses local name fallback for unrecognized prefix", () => {
    const source = [
      "@prefix foo: <http://foo.org/> .",
      "foo:MyClass a owl:Class .",
    ].join("\n");
    const lines = source.split("\n");
    const block = findBlock(
      lines,
      "http://foo.org/MyClass",
      {},
      undefined,
    );
    expect(block).not.toBeNull();
  });
});

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    expect(escapeRegex("foo.bar")).toBe("foo\\.bar");
    expect(escapeRegex("a+b*c?d")).toBe("a\\+b\\*c\\?d");
    expect(escapeRegex("[test]")).toBe("\\[test\\]");
    expect(escapeRegex("(group)")).toBe("\\(group\\)");
    expect(escapeRegex("a{1,2}")).toBe("a\\{1,2\\}");
    expect(escapeRegex("^start$end")).toBe("\\^start\\$end");
    expect(escapeRegex("a|b")).toBe("a\\|b");
    expect(escapeRegex("back\\slash")).toBe("back\\\\slash");
  });

  it("does not modify plain strings", () => {
    expect(escapeRegex("hello")).toBe("hello");
  });
});

describe("esc", () => {
  it("escapes backslashes", () => {
    expect(esc("a\\b")).toBe("a\\\\b");
  });

  it("escapes double quotes", () => {
    expect(esc('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes newlines", () => {
    expect(esc("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes carriage returns", () => {
    expect(esc("line1\rline2")).toBe("line1\\rline2");
  });

  it("escapes tabs", () => {
    expect(esc("col1\tcol2")).toBe("col1\\tcol2");
  });

  it("handles multiple escape types together", () => {
    expect(esc('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd');
  });

  it("returns empty string for empty input", () => {
    expect(esc("")).toBe("");
  });
});

describe("literal", () => {
  it("creates a plain literal", () => {
    expect(literal("hello")).toBe('"hello"');
  });

  it("escapes special characters in value", () => {
    expect(literal('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("escapes backslashes and newlines", () => {
    expect(literal("line1\nline2\\end")).toBe('"line1\\nline2\\\\end"');
  });
});

describe("isIriValue", () => {
  it("returns true for http:// URIs", () => {
    expect(isIriValue("http://example.org/foo")).toBe(true);
  });

  it("returns true for https:// URIs", () => {
    expect(isIriValue("https://example.org/foo")).toBe(true);
  });

  it("returns true for urn: URIs", () => {
    expect(isIriValue("urn:isbn:0451450523")).toBe(true);
  });

  it("returns false for plain strings", () => {
    expect(isIriValue("hello world")).toBe(false);
  });

  it("returns false for prefixed names", () => {
    expect(isIriValue("ex:Foo")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isIriValue("")).toBe(false);
  });
});

describe("block boundary scanning", () => {
  it("does not treat # inside an IRI as a comment", () => {
    const lines = [
      "<http://example.org/ont#Dog> a owl:Class ;",
      "    a <http://example.org/ont#Animal> .",
      "",
      "<http://example.org/ont#Cat> a owl:Class .",
    ];
    expect(scanToBlockEnd(lines, 0)).toBe(1);
  });

  it("does not stop at dots inside decimals or prefixed names", () => {
    const lines = ["ex:Dog ex:w 1.5 ;", "    ex:r .5 ;", "    rdfs:seeAlso ex:v1.2 .", "ex:Cat a owl:Class ."];
    expect(scanToBlockEnd(lines, 0)).toBe(2);
  });

  it("treats a dot right after a prefixed name at end of line as the terminator", () => {
    expect(scanToBlockEnd(["ex:Dog a owl:Class.", "ex:Cat a owl:Class ."], 0)).toBe(0);
  });

  it("handles long strings that end in a quote or contain escaped quotes", () => {
    const lines = ['ex:Dog rdfs:comment """a \\""" b . "c"""" ;', '    rdfs:label "Dog" .', "ex:Cat a owl:Class ."];
    expect(scanToBlockEnd(lines, 0)).toBe(1);
  });

  it("does not select a block that only references the IRI as an object", () => {
    const source = [
      "@prefix ex: <http://example.org/ont#> .",
      "ex:A rdfs:seeAlso <http://example.org/ont#Ghost> .",
    ].join("\n");
    const { prefixes } = parseDeclarations(source);
    expect(findBlock(source.split("\n"), "http://example.org/ont#Ghost", prefixes)).toBeNull();
  });

  it("does not match a same-named entity under a different declared prefix", () => {
    const source = [
      "@prefix ex: <http://example.org/ont#> .",
      "@prefix other: <http://other.org/> .",
      "other:Dog a owl:Class .",
    ].join("\n");
    const { prefixes } = parseDeclarations(source);
    expect(findBlock(source.split("\n"), "http://example.org/ont#Dog", prefixes)).toBeNull();
  });

  it("does not match a subject-looking line inside a long string", () => {
    const source = [
      "@prefix ex: <http://example.org/ont#> .",
      'ex:A rdfs:comment """',
      "ex:Dog a owl:Class .",
      '""" .',
      "ex:Dog rdfs:label \"Dog\" .",
    ].join("\n");
    const { prefixes } = parseDeclarations(source);
    expect(findBlock(source.split("\n"), "http://example.org/ont#Dog", prefixes)).toEqual({ startLine: 4, endLine: 4 });
  });

  it("returns exact spans and skips SPARQL-style directives", () => {
    const source = 'PREFIX ex: <http://example.org/ont#>\nex:A a ex:B . ex:Dog rdfs:label "D. og" . # tail';
    const { prefixes } = parseDeclarations(source);
    const span = findBlockSpan(source, "http://example.org/ont#Dog", prefixes)!;
    expect(source.slice(span.start, span.end)).toBe('ex:Dog rdfs:label "D. og" .');
  });
});
