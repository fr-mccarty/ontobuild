import type { LocalizedString, AnnotationUpdate } from "@/lib/api/client";
import {
  parseDeclarations,
  reverseMap,
  toTurtle,
  findBlockSpan,
  literal,
  isIriValue,
  esc,
} from "@/lib/ontology/turtleUtils";
import type { PropertyAssertion } from "@/lib/ontology/entityDetailExtractors";

export interface TurtleIndividualUpdateData {
  labels: LocalizedString[];
  comments: LocalizedString[];
  definitions: LocalizedString[];
  typeIris: string[];
  sameAsIris: string[];
  differentFromIris: string[];
  objectPropertyAssertions: PropertyAssertion[];
  dataPropertyAssertions: PropertyAssertion[];
  annotations?: AnnotationUpdate[];
  deprecated?: boolean;
  seeAlsoIris?: string[];
  isDefinedByIris?: string[];
}

function genIndividualBlock(
  iri: string,
  data: TurtleIndividualUpdateData,
  rev: Map<string, string>,
): string {
  const subject = toTurtle(iri, rev);
  const po: string[] = [];

  const typeTokens = ["owl:NamedIndividual"];
  for (const t of data.typeIris) {
    typeTokens.push(toTurtle(t, rev));
  }
  po.push(`a ${typeTokens.join(", ")}`);

  if (data.deprecated) {
    po.push("owl:deprecated true");
  }

  for (const l of data.labels) {
    if (!l.value.trim()) continue;
    po.push(`rdfs:label ${literal(l.value)}`);
  }

  for (const c of data.comments) {
    if (!c.value.trim()) continue;
    po.push(`rdfs:comment ${literal(c.value)}`);
  }

  for (const d of data.definitions) {
    if (!d.value.trim()) continue;
    po.push(`skos:definition ${literal(d.value)}`);
  }

  for (const s of data.sameAsIris) {
    po.push(`owl:sameAs ${toTurtle(s, rev)}`);
  }

  for (const d of data.differentFromIris) {
    po.push(`owl:differentFrom ${toTurtle(d, rev)}`);
  }

  for (const a of data.objectPropertyAssertions) {
    if (!a.targetIri) continue;
    po.push(`${toTurtle(a.propertyIri, rev)} ${toTurtle(a.targetIri, rev)}`);
  }

  for (const a of data.dataPropertyAssertions) {
    if (!a.value) continue;
    const prop = toTurtle(a.propertyIri, rev);
    if (a.datatype) {
      const escaped = esc(a.value);
      po.push(`${prop} "${escaped}"^^${toTurtle(a.datatype, rev)}`);
    } else {
      po.push(`${prop} ${literal(a.value)}`);
    }
  }

  if (data.seeAlsoIris) {
    for (const s of data.seeAlsoIris) {
      po.push(`rdfs:seeAlso ${toTurtle(s, rev)}`);
    }
  }

  if (data.isDefinedByIris) {
    for (const d of data.isDefinedByIris) {
      po.push(`rdfs:isDefinedBy ${toTurtle(d, rev)}`);
    }
  }

  if (data.annotations) {
    for (const ann of data.annotations) {
      const prop = toTurtle(ann.property_iri, rev);
      for (const v of ann.values) {
        if (!v.value.trim()) continue;
        if (isIriValue(v.value)) {
          po.push(`${prop} ${toTurtle(v.value, rev)}`);
        } else {
          po.push(`${prop} ${literal(v.value)}`);
        }
      }
    }
  }

  if (po.length <= 1) {
    return `${subject} ${po[0] || "a owl:NamedIndividual"} .`;
  }

  const lines = [`${subject} ${po[0]} ;`];
  for (let i = 1; i < po.length; i++) {
    lines.push(`    ${po[i]}${i === po.length - 1 ? " ." : " ;"}`);
  }
  return lines.join("\n");
}

export function updateIndividualInTurtle(
  source: string,
  individualIri: string,
  data: TurtleIndividualUpdateData,
): string {
  const { prefixes, base } = parseDeclarations(source);
  const rev = reverseMap(prefixes);
  const block = findBlockSpan(source, individualIri, prefixes, base);
  if (!block) {
    throw new Error(
      `Could not find individual "${individualIri}" in ontology source.`,
    );
  }

  const newBlock = genIndividualBlock(individualIri, data, rev);
  return source.slice(0, block.start) + newBlock + source.slice(block.end);
}
