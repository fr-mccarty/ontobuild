import fs from "node:fs";
import path from "node:path";
import type { Store } from "n3";
import { NS, parseTurtle } from "./rdf";

export const RULES_ONTOLOGY_IRI = "https://ontobuild.dev/rules";
export const RULE_NS = "https://ontobuild.dev/rules#";
export const RULE_PREFIX = "rule";
export const RULE_CLASS = RULE_NS + "Rule";

const VOCABULARY_FILE = path.join(/*turbopackIgnore: true*/ process.cwd(), "server", "vocabularies", "rules.ttl");

const g = globalThis as typeof globalThis & { __ontobuildRulesVocabulary?: { content: string; store: Store } };

export function rulesVocabulary(): { content: string; store: Store } {
  if (!g.__ontobuildRulesVocabulary) {
    const content = fs.readFileSync(VOCABULARY_FILE, "utf8");
    g.__ontobuildRulesVocabulary = { content, store: parseTurtle(content).store };
  }
  return g.__ontobuildRulesVocabulary;
}

export function isRulesOntologyIri(iri: string): boolean {
  return iri.trim().replace(/[#/]+$/, "") === RULES_ONTOLOGY_IRI;
}

export function isRule(store: Store, iri: string): boolean {
  return store.countQuads(iri, NS.rdf + "type", RULE_CLASS, null) > 0;
}
