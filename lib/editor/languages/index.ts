export * from './turtle';
export * from './sparql';

import { registerTurtleLanguage, TURTLE_LANGUAGE_ID } from './turtle';
import { registerSparqlLanguage, SPARQL_LANGUAGE_ID } from './sparql';

export function registerRdfLanguages(monaco: typeof import('monaco-editor')) {
  registerTurtleLanguage(monaco);
  registerSparqlLanguage(monaco);
}

export const RDF_LANGUAGE_IDS = {
  turtle: TURTLE_LANGUAGE_ID,
  sparql: SPARQL_LANGUAGE_ID,
} as const;

export function detectLanguageFromExtension(filename: string): string | null {
  const ext = filename.toLowerCase().split('.').pop();

  switch (ext) {
    case 'ttl':
    case 'turtle':
    case 'n3':
      return TURTLE_LANGUAGE_ID;
    case 'rq':
    case 'sparql':
    case 'sq':
      return SPARQL_LANGUAGE_ID;
    case 'owl':
    case 'rdf':
    case 'xml':
      return 'xml';
    case 'jsonld':
    case 'json':
      return 'json';
    default:
      return null;
  }
}

export function getLanguageMimeType(languageId: string): string {
  switch (languageId) {
    case TURTLE_LANGUAGE_ID:
      return 'text/turtle';
    case SPARQL_LANGUAGE_ID:
      return 'application/sparql-query';
    default:
      return 'text/plain';
  }
}
