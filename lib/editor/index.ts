export {
  registerRdfLanguages,
  RDF_LANGUAGE_IDS,
  detectLanguageFromExtension,
  getLanguageMimeType,
} from './languages';

export {
  TURTLE_LANGUAGE_ID,
  TURTLE_EXTENSIONS,
  registerTurtleLanguage,
  turtleLanguageConfiguration,
  turtleTokensProvider,
  commonPrefixes,
  commonProperties,
} from './languages/turtle';

export {
  SPARQL_LANGUAGE_ID,
  SPARQL_EXTENSIONS,
  registerSparqlLanguage,
  sparqlLanguageConfiguration,
  sparqlTokensProvider,
  sparqlKeywords,
  sparqlFunctions,
  sparqlTemplates,
} from './languages/sparql';

