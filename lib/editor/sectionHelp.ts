/**
 * Tooltips for the section labels in the entity editor (the left column of the class, property
 * and individual panels): what each section is, why it's there, and the RDF/OWL term behind it.
 */
const SECTION_HELP: Record<string, string> = {
  "Primary Label":
    "The name people see for this entity in the tree, search and everywhere else. Stored as rdfs:label; the IRI is its permanent identifier, the label can change freely.",
  "Label(s)":
    "The names people see for this entity in the tree, search and everywhere else. Stored as rdfs:label; the IRI is its permanent identifier, the labels can change freely.",
  Definition:
    "One precise statement of what this entity is, meant to tell it apart from everything else in the ontology. Stored as skos:definition.",
  "Comment(s)":
    "Free-form notes for people reading the ontology: usage guidance, examples, background or open questions. Stored as rdfs:comment; reasoners ignore it.",
  "Parent Class(es)":
    "The broader classes this one is a kind of. Everything true of a parent is true of this class and its members. Stored as rdfs:subClassOf; it places the class in the tree.",
  "Relationship(s)":
    "How this class connects to others through properties: the properties whose domain or range is this class, and restrictions on it. Shown so you can see its role at a glance.",
  "Relationships":
    "Other entities connected to this one through properties, in either direction. Shown so you can see its role in the ontology at a glance.",
  Subclasses:
    "The narrower classes that are kinds of this one (their rdfs:subClassOf points here). Everything true of this class is true of them. Worked out from the ontology; edit a subclass to move it.",
  Individuals:
    "The named individuals stated to be of this class (their rdf:type is this class), that is, its instances. Individuals of its subclasses aren't listed here. Worked out from the ontology; add one here, or edit an individual's types to change it.",
  "Equivalent Classes":
    "Classes with exactly the same members as this one: anything in one is in the other. Stored as owl:equivalentClass; used to align vocabularies or define a class by a rule.",
  "Disjoint With":
    "Classes that can share no members with this one: nothing can be both. Stored as owl:disjointWith; lets a reasoner catch contradictions.",
  Domain:
    "The kind of thing this property describes: whatever uses the property is inferred to be of this class. Stored as rdfs:domain.",
  Range:
    "The kind of value this property takes: a class for an object property, a datatype (such as xsd:string) for a data property. Stored as rdfs:range.",
  "Parent Properties":
    "Broader properties this one specializes: whenever this property holds, its parents hold too. Stored as rdfs:subPropertyOf.",
  "Inverse Of":
    "The property that states the same link in the other direction, such as hasPart and isPartOf. Stored as owl:inverseOf.",
  Characteristics:
    "Logical rules for this property, such as functional (at most one value) or transitive (it chains). OWL property types a reasoner uses to draw conclusions.",
  "Equivalent Properties":
    "Properties that always hold between the same things as this one. Stored as owl:equivalentProperty; used to align vocabularies.",
  "Disjoint Properties":
    "Properties that can never link the same two things as this one. Stored as owl:propertyDisjointWith.",
  Annotations:
    "Other descriptive notes on this entity, such as synonyms, examples, authors or sources. Annotation properties (skos:altLabel, dcterms:creator, ...); they document and don't affect reasoning.",
  "Type(s)":
    "The classes this individual is a member of. Stored as rdf:type; it decides which properties and rules apply to it.",
  "Same As":
    "Other individuals that are the very same thing under another IRI. Stored as owl:sameAs; their facts are merged.",
  "Different From":
    "Individuals that are definitely not this one, even if they look alike. Stored as owl:differentFrom.",
  "Object Properties":
    "This individual's links to other individuals, such as worksFor → Acme. Each is an object property assertion.",
  "Used By":
    "Every other entity in the ontology that refers to this one: as a parent, a domain or range, a type, a value or in an annotation. Check it before renaming or deleting. Worked out, not stored.",
  Rules:
    "What instances of this class must look like: how many values a property may have, their class, datatype, allowed values or pattern. Stored as rule:Rule terms; OntoBuild checks them as SHACL and reports each instance that breaks one.",
  "Rule Violations":
    "The rules this individual breaks. Worked out when rules are validated, not stored; fix the individual or change the rule.",
  History:
    "The commits that changed this entity, newest first: who changed what and when. Read from the project's Git history.",
  "Data Properties":
    "This individual's values, such as a name, date or number. Each is a data property assertion with a literal value.",
};

/** The tooltip for a section label, falling back to `fallback` (such as the bare RDF term). */
export function sectionHelp(title: string, fallback?: string): string | undefined {
  return SECTION_HELP[title] ?? fallback;
}
