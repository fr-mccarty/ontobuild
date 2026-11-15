export const TURTLE_LANGUAGE_ID = 'turtle';

export const TURTLE_EXTENSIONS = ['.ttl', '.turtle', '.n3'];

export const turtleLanguageConfiguration = {
  comments: {
    lineComment: '#',
  },
  brackets: [
    ['{', '}'] as [string, string],
    ['[', ']'] as [string, string],
    ['(', ')'] as [string, string],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '<', close: '>' },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '<', close: '>' },
  ],
  folding: {
    markers: {
      start: /^\s*#region\b/,
      end: /^\s*#endregion\b/,
    },
  },
};

export const turtleTokensProvider = {
  defaultToken: '',
  tokenPostfix: '.turtle',

  keywords: ['a', 'true', 'false'],

  directives: ['@prefix', '@base', 'PREFIX', 'BASE'],

  typeKeywords: [
    'owl:Class', 'owl:ObjectProperty', 'owl:DatatypeProperty', 'owl:AnnotationProperty',
    'owl:Thing', 'owl:Nothing', 'owl:Ontology', 'owl:NamedIndividual',
    'rdfs:Class', 'rdfs:Resource', 'rdfs:Literal', 'rdfs:Datatype',
    'rdf:Property', 'rdf:List', 'rdf:Statement',
    'xsd:string', 'xsd:integer', 'xsd:decimal', 'xsd:boolean', 'xsd:dateTime',
  ],

  operators: ['^^', '@'],

  namespaces: [
    'rdf:', 'rdfs:', 'owl:', 'xsd:', 'xml:',
    'skos:', 'dc:', 'dcterms:', 'foaf:', 'schema:',
  ],

  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

  tokenizer: {
    root: [
      [/#.*$/, 'comment'],

      [/@?(?:prefix|base)\b/i, 'keyword'],
      [/(?:PREFIX|BASE)\b/, 'keyword'],

      [/<[^\s<>"{}|^`\\]*>/, 'string.link'],

      [/(\w*:)(\w*)/, ['storage.type', 'variable']],

      [/\ba\b/, 'keyword'],

      [/@[a-zA-Z]+(-[a-zA-Z0-9]+)*/, 'type'],

      [/\^\^/, 'operator'],

      [/"""/, 'string', '@tripleDoubleString'],
      [/'''/, 'string', '@tripleSingleString'],

      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@doubleString'],

      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/'/, 'string', '@singleString'],

      [/[+-]?\d+\.\d*([eE][+-]?\d+)?/, 'number.float'],
      [/[+-]?\.\d+([eE][+-]?\d+)?/, 'number.float'],
      [/[+-]?\d+[eE][+-]?\d+/, 'number.float'],
      [/[+-]?\d+/, 'number'],

      [/\b(?:true|false)\b/, 'keyword'],

      [/_:\w+/, 'variable.predefined'],

      [/[;,.]/, 'delimiter'],
      [/[\[\]{}()]/, '@brackets'],
    ],

    doubleString: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],

    singleString: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, 'string', '@pop'],
    ],

    tripleDoubleString: [
      [/[^"]+/, 'string'],
      [/"""/, 'string', '@pop'],
      [/"/, 'string'],
    ],

    tripleSingleString: [
      [/[^']+/, 'string'],
      [/'''/, 'string', '@pop'],
      [/'/, 'string'],
    ],
  },
};

export const commonPrefixes = [
  { prefix: 'rdf', namespace: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' },
  { prefix: 'rdfs', namespace: 'http://www.w3.org/2000/01/rdf-schema#' },
  { prefix: 'owl', namespace: 'http://www.w3.org/2002/07/owl#' },
  { prefix: 'xsd', namespace: 'http://www.w3.org/2001/XMLSchema#' },
  { prefix: 'xml', namespace: 'http://www.w3.org/XML/1998/namespace' },
  { prefix: 'skos', namespace: 'http://www.w3.org/2004/02/skos/core#' },
  { prefix: 'dc', namespace: 'http://purl.org/dc/elements/1.1/' },
  { prefix: 'dcterms', namespace: 'http://purl.org/dc/terms/' },
  { prefix: 'foaf', namespace: 'http://xmlns.com/foaf/0.1/' },
  { prefix: 'schema', namespace: 'https://schema.org/' },
];

export const commonProperties = [
  { label: 'rdf:type', detail: 'The type of a resource' },
  { label: 'rdf:first', detail: 'First element of a list' },
  { label: 'rdf:rest', detail: 'Rest of a list' },
  { label: 'rdfs:label', detail: 'Human-readable label' },
  { label: 'rdfs:comment', detail: 'Human-readable description' },
  { label: 'rdfs:subClassOf', detail: 'Subclass relationship' },
  { label: 'rdfs:subPropertyOf', detail: 'Subproperty relationship' },
  { label: 'rdfs:domain', detail: 'Domain of a property' },
  { label: 'rdfs:range', detail: 'Range of a property' },
  { label: 'rdfs:seeAlso', detail: 'Reference to related resource' },
  { label: 'rdfs:isDefinedBy', detail: 'Defining resource' },
  { label: 'owl:equivalentClass', detail: 'Equivalent class' },
  { label: 'owl:disjointWith', detail: 'Disjoint class' },
  { label: 'owl:inverseOf', detail: 'Inverse property' },
  { label: 'owl:deprecated', detail: 'Deprecated annotation' },
  { label: 'owl:versionInfo', detail: 'Version information' },
  { label: 'owl:imports', detail: 'Import another ontology' },
  { label: 'skos:prefLabel', detail: 'Preferred label' },
  { label: 'skos:altLabel', detail: 'Alternative label' },
  { label: 'skos:definition', detail: 'Definition' },
  { label: 'skos:broader', detail: 'Broader concept' },
  { label: 'skos:narrower', detail: 'Narrower concept' },
];

export function registerTurtleLanguage(monaco: typeof import('monaco-editor')) {
  monaco.languages.register({
    id: TURTLE_LANGUAGE_ID,
    extensions: TURTLE_EXTENSIONS,
    aliases: ['Turtle', 'turtle', 'ttl', 'N3'],
    mimetypes: ['text/turtle', 'application/x-turtle'],
  });

  monaco.languages.setLanguageConfiguration(
    TURTLE_LANGUAGE_ID,
    turtleLanguageConfiguration
  );

  monaco.languages.setMonarchTokensProvider(
    TURTLE_LANGUAGE_ID,
    turtleTokensProvider as unknown as import('monaco-editor').languages.IMonarchLanguage
  );

  monaco.languages.registerCompletionItemProvider(TURTLE_LANGUAGE_ID, {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = [
        ...commonPrefixes.map((p) => ({
          label: `@prefix ${p.prefix}:`,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: `@prefix ${p.prefix}: <${p.namespace}> .`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: p.namespace,
          range,
        })),
        ...commonProperties.map((p) => ({
          label: p.label,
          kind: monaco.languages.CompletionItemKind.Property,
          insertText: p.label,
          detail: p.detail,
          range,
        })),
      ];

      return { suggestions };
    },
  });
}
