import type { LocalizedString, AnnotationUpdate } from "@/lib/api/client";
import {
  parseDeclarations,
  reverseMap,
  toTurtle,
  findBlock,
  literal,
  isIriValue,
} from "@/lib/ontology/turtleUtils";
import { parseBlockTriples } from "@/lib/ontology/turtleBlockParser";
import type { PropertyType } from "@/lib/ontology/entityDetailExtractors";

export interface TurtlePropertyUpdateData {
  propertyType: PropertyType;
  labels: LocalizedString[];
  comments: LocalizedString[];
  definitions: LocalizedString[];
  domainIris: string[];
  rangeIris: string[];
  parentIris: string[];
  inverseOf: string | null;
  characteristics: string[];
  annotations?: AnnotationUpdate[];
  deprecated?: boolean;
  equivalentIris?: string[];
  disjointIris?: string[];
  seeAlsoIris?: string[];
  isDefinedByIris?: string[];
}

const OWL = "http://www.w3.org/2002/07/owl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const SKOS = "http://www.w3.org/2004/02/skos/core#";

const PROPERTY_TYPE_IRI: Record<Exclude<PropertyType, "other">, string> = {
  object: `${OWL}ObjectProperty`,
  data: `${OWL}DatatypeProperty`,
  annotation: `${OWL}AnnotationProperty`,
};

const CHARACTERISTIC_IRIS = new Set([
  `${OWL}FunctionalProperty`,
  `${OWL}InverseFunctionalProperty`,
  `${OWL}TransitiveProperty`,
  `${OWL}SymmetricProperty`,
  `${OWL}AsymmetricProperty`,
  `${OWL}ReflexiveProperty`,
  `${OWL}IrreflexiveProperty`,
]);

const MANAGED_TYPE_IRIS = new Set([...Object.values(PROPERTY_TYPE_IRI), ...CHARACTERISTIC_IRIS]);

function genPropertyBlock(
  iri: string,
  data: TurtlePropertyUpdateData,
  rev: Map<string, string>,
  existingTypeIris: string[],
): string {
  const subject = toTurtle(iri, rev);
  const t = (term: string) => toTurtle(term, rev);
  const po: string[] = [];

  const typeIris: string[] = [];
  if (data.propertyType !== "other") typeIris.push(PROPERTY_TYPE_IRI[data.propertyType]);
  for (const ch of data.characteristics) {
    if (CHARACTERISTIC_IRIS.has(ch) && !typeIris.includes(ch)) typeIris.push(ch);
  }
  for (const existing of existingTypeIris) {
    if (!MANAGED_TYPE_IRIS.has(existing) && !typeIris.includes(existing)) typeIris.push(existing);
  }
  if (typeIris.length === 0) typeIris.push(`${RDF}Property`);
  po.push(`a ${typeIris.map(t).join(", ")}`);

  if (data.deprecated) {
    po.push(`${t(`${OWL}deprecated`)} true`);
  }

  for (const l of data.labels) {
    if (!l.value.trim()) continue;
    po.push(`${t(`${RDFS}label`)} ${literal(l.value, l.lang)}`);
  }

  for (const c of data.comments) {
    if (!c.value.trim()) continue;
    po.push(`${t(`${RDFS}comment`)} ${literal(c.value, c.lang)}`);
  }

  for (const d of data.definitions) {
    if (!d.value.trim()) continue;
    po.push(`${t(`${SKOS}definition`)} ${literal(d.value, d.lang)}`);
  }

  for (const d of data.domainIris) {
    po.push(`${t(`${RDFS}domain`)} ${t(d)}`);
  }

  for (const r of data.rangeIris) {
    po.push(`${t(`${RDFS}range`)} ${t(r)}`);
  }

  for (const p of data.parentIris) {
    po.push(`${t(`${RDFS}subPropertyOf`)} ${t(p)}`);
  }

  if (data.inverseOf) {
    po.push(`${t(`${OWL}inverseOf`)} ${t(data.inverseOf)}`);
  }

  for (const e of data.equivalentIris ?? []) {
    po.push(`${t(`${OWL}equivalentProperty`)} ${t(e)}`);
  }

  for (const d of data.disjointIris ?? []) {
    po.push(`${t(`${OWL}propertyDisjointWith`)} ${t(d)}`);
  }

  for (const s of data.seeAlsoIris ?? []) {
    po.push(`${t(`${RDFS}seeAlso`)} ${t(s)}`);
  }

  for (const d of data.isDefinedByIris ?? []) {
    po.push(`${t(`${RDFS}isDefinedBy`)} ${t(d)}`);
  }

  for (const ann of data.annotations ?? []) {
    const prop = t(ann.property_iri);
    for (const v of ann.values) {
      if (!v.value.trim()) continue;
      if (!v.lang && isIriValue(v.value)) {
        po.push(`${prop} ${t(v.value)}`);
      } else {
        po.push(`${prop} ${literal(v.value, v.lang)}`);
      }
    }
  }

  if (po.length === 1) {
    return `${subject} ${po[0]} .`;
  }

  const lines = [`${subject} ${po[0]} ;`];
  for (let i = 1; i < po.length; i++) {
    lines.push(`    ${po[i]}${i === po.length - 1 ? " ." : " ;"}`);
  }
  return lines.join("\n");
}

export function updatePropertyInTurtle(
  source: string,
  propertyIri: string,
  data: TurtlePropertyUpdateData,
): string {
  const { prefixes, base } = parseDeclarations(source);
  const rev = reverseMap(prefixes);
  const lines = source.split("\n");

  const block = findBlock(lines, propertyIri, prefixes, base);
  if (!block) {
    throw new Error(
      `Could not find property "${propertyIri}" in ontology source.`,
    );
  }

  const existingTypeIris = (parseBlockTriples(source, propertyIri) ?? [])
    .flatMap((tr) => (tr.predicate === `${RDF}type` && tr.object.type === "iri" ? [tr.object.value] : []));
  const newBlock = genPropertyBlock(propertyIri, data, rev, existingTypeIris);
  const before = lines.slice(0, block.startLine);
  const after = lines.slice(block.endLine + 1);

  return [...before, newBlock, ...after].join("\n");
}
