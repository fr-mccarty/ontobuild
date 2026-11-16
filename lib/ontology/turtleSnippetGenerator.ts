import type { EntityType } from "./iriGeneration";
import { esc, reverseMap, toTurtle, type PrefixMap } from "./turtleUtils";

export interface TurtleSnippetOptions {
  iri: string;
  label: string;
  entityType: EntityType;
  parentIri?: string;
  ontologyPrefix?: string;
  ontologyNamespace?: string;
  /**
   * Prefixes declared in the file the snippet will be appended to. When given, every
   * IRI that one of them covers is written as a short name (`:Pizza`, `ex:Pizza`),
   * and anything else stays a full `<...>` IRI, so the snippet never relies on a
   * prefix the file doesn't declare.
   */
  prefixes?: PrefixMap;
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
    prefixes,
  } = options;

  const rev = prefixes ? reverseMap(prefixes) : undefined;
  const ref = (term: string) =>
    rev ? toTurtle(term, rev) : toPrefixedOrFull(term, ontologyPrefix, ontologyNamespace);

  const subject = ref(iri);
  const owlType = OWL_TYPE[entityType];
  const escapedLabel = esc(label);

  const lines: string[] = [];

  lines.push(`${subject} a ${owlType} ;`);

  if (parentIri) {
    lines.push(`    rdfs:label "${escapedLabel}" ;`);
  } else {
    lines.push(`    rdfs:label "${escapedLabel}" .`);
  }

  if (parentIri) {
    const predicate = PARENT_PREDICATE[entityType];
    const parentRef = ref(parentIri);
    lines.push(`    ${predicate} ${parentRef} .`);
  }

  return "\n" + lines.join("\n") + "\n";
}
