import type { LocalizedString, AnnotationUpdate } from "@/lib/api/client";
import {
  parseDeclarations,
  reverseMap,
  toTurtle,
  findBlockSpan,
  literal,
  isIriValue,
} from "@/lib/ontology/turtleUtils";

export interface TurtleClassUpdateData {
  labels: LocalizedString[];
  comments: LocalizedString[];
  parent_iris: string[];
  annotations?: AnnotationUpdate[];
  deprecated?: boolean;
  equivalent_iris?: string[];
  disjoint_iris?: string[];
}

function genBlock(
  iri: string,
  data: TurtleClassUpdateData,
  rev: Map<string, string>,
): string {
  const subject = toTurtle(iri, rev);
  const po: string[] = [];

  po.push("a owl:Class");

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

  for (const p of data.parent_iris) {
    po.push(`rdfs:subClassOf ${toTurtle(p, rev)}`);
  }

  if (data.equivalent_iris) {
    for (const e of data.equivalent_iris) {
      po.push(`owl:equivalentClass ${toTurtle(e, rev)}`);
    }
  }

  if (data.disjoint_iris) {
    for (const d of data.disjoint_iris) {
      po.push(`owl:disjointWith ${toTurtle(d, rev)}`);
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
    return `${subject} ${po[0] || "a owl:Class"} .`;
  }

  const lines = [`${subject} ${po[0]} ;`];
  for (let i = 1; i < po.length; i++) {
    lines.push(`    ${po[i]}${i === po.length - 1 ? " ." : " ;"}`);
  }
  return lines.join("\n");
}

export function updateClassInTurtle(
  source: string,
  classIri: string,
  data: TurtleClassUpdateData,
): string {
  const { prefixes, base } = parseDeclarations(source);
  const rev = reverseMap(prefixes);
  const block = findBlockSpan(source, classIri, prefixes, base);
  if (!block) {
    throw new Error(
      `Could not find class "${classIri}" in ontology source. ` +
        `The class may have been added via the form and not yet committed to the source file.`,
    );
  }

  const newBlock = genBlock(classIri, data, rev);
  return source.slice(0, block.start) + newBlock + source.slice(block.end);
}
