import type { EntityType } from "./iriGeneration";

export interface TurtleSnippetOptions {
  iri: string;
  label: string;
  entityType: EntityType;
  parentIri?: string;
  ontologyPrefix?: string;
  ontologyNamespace?: string;
}

const OWL_TYPE: Record<EntityType, string> = {
  class: "owl:Class",
  objectProperty: "owl:ObjectProperty",
  dataProperty: "owl:DatatypeProperty",
  annotationProperty: "owl:AnnotationProperty",
  individual: "owl:NamedIndividual",
};

const PARENT_PREDICATE: Record<EntityType, string> = {
  class: "rdfs:subClassOf",
  objectProperty: "rdfs:subPropertyOf",
  dataProperty: "rdfs:subPropertyOf",
  annotationProperty: "rdfs:subPropertyOf",
  individual: "a",
};

function escapeTurtleString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toPrefixedOrFull(
  iri: string,
  ontologyPrefix?: string,
  ontologyNamespace?: string,
): string {
  if (ontologyPrefix && ontologyNamespace && iri.startsWith(ontologyNamespace)) {
    const localName = iri.slice(ontologyNamespace.length);
    return `${ontologyPrefix}:${localName}`;
  }
  return `<${iri}>`;
}

export function generateTurtleSnippet(options: TurtleSnippetOptions): string {
  const {
    iri,
    label,
    entityType,
    parentIri,
    ontologyPrefix,
    ontologyNamespace,
  } = options;

  const subject = toPrefixedOrFull(iri, ontologyPrefix, ontologyNamespace);
  const owlType = OWL_TYPE[entityType];
  const escapedLabel = escapeTurtleString(label);

  const lines: string[] = [];

  lines.push(`${subject} a ${owlType} ;`);

  if (parentIri) {
    lines.push(`    rdfs:label "${escapedLabel}"@en ;`);
  } else {
    lines.push(`    rdfs:label "${escapedLabel}"@en .`);
  }

  if (parentIri) {
    const predicate = PARENT_PREDICATE[entityType];
    const parentRef = toPrefixedOrFull(parentIri, ontologyPrefix, ontologyNamespace);
    lines.push(`    ${predicate} ${parentRef} .`);
  }

  return "\n" + lines.join("\n") + "\n";
}
