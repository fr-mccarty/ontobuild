export const SPARQL_LANGUAGE_ID = 'sparql';

export const SPARQL_EXTENSIONS = ['.rq', '.sparql', '.sq'];

export const sparqlLanguageConfiguration = {
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
};

export const sparqlKeywords = [
  'SELECT', 'DISTINCT', 'REDUCED', 'CONSTRUCT', 'DESCRIBE', 'ASK',
  'FROM', 'NAMED',
  'WHERE', 'GRAPH',
  'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'GROUP', 'HAVING',
  'COUNT', 'SUM', 'MIN', 'MAX', 'AVG', 'SAMPLE', 'GROUP_CONCAT', 'SEPARATOR',
  'OPTIONAL', 'UNION', 'FILTER', 'BIND', 'AS', 'VALUES', 'MINUS',
  'EXISTS', 'NOT',
  'SERVICE', 'SILENT',
  'INSERT', 'DELETE', 'DATA', 'LOAD', 'CLEAR', 'DROP', 'CREATE',
  'ADD', 'MOVE', 'COPY', 'WITH', 'USING', 'DEFAULT', 'ALL', 'TO',
  'PREFIX', 'BASE',
  'IN', 'A',
];

export const sparqlFunctions = [
  'STR', 'LANG', 'LANGMATCHES', 'DATATYPE', 'BOUND', 'IRI', 'URI', 'BNODE',
  'RAND', 'ABS', 'CEIL', 'FLOOR', 'ROUND', 'CONCAT', 'STRLEN', 'UCASE', 'LCASE',
  'ENCODE_FOR_URI', 'CONTAINS', 'STRSTARTS', 'STRENDS', 'STRBEFORE', 'STRAFTER',
  'YEAR', 'MONTH', 'DAY', 'HOURS', 'MINUTES', 'SECONDS', 'TIMEZONE', 'TZ',
  'NOW', 'UUID', 'STRUUID', 'MD5', 'SHA1', 'SHA256', 'SHA384', 'SHA512',
  'COALESCE', 'IF', 'STRLANG', 'STRDT', 'SAMETERM', 'ISIRI', 'ISURI', 'ISBLANK',
  'ISLITERAL', 'ISNUMERIC', 'REGEX', 'SUBSTR', 'REPLACE',
];

export const sparqlTokensProvider = {
  defaultToken: '',
  tokenPostfix: '.sparql',
  ignoreCase: true,

  keywords: sparqlKeywords,
  functions: sparqlFunctions,

  operators: [
    '||', '&&', '=', '!=', '<', '>', '<=', '>=',
    '+', '-', '*', '/', '!', '^^', '@',
  ],

  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

  tokenizer: {
    root: [
      [/#.*$/, 'comment'],

      [/[?$][a-zA-Z_][a-zA-Z0-9_]*/, 'variable'],

      [/\b(SELECT|DISTINCT|REDUCED|CONSTRUCT|DESCRIBE|ASK|FROM|NAMED|WHERE|GRAPH|ORDER|BY|ASC|DESC|LIMIT|OFFSET|GROUP|HAVING|OPTIONAL|UNION|FILTER|BIND|AS|VALUES|MINUS|EXISTS|NOT|SERVICE|SILENT|INSERT|DELETE|DATA|LOAD|CLEAR|DROP|CREATE|ADD|MOVE|COPY|WITH|USING|DEFAULT|ALL|TO|PREFIX|BASE|IN)\b/i, 'keyword'],

      [/\b(COUNT|SUM|MIN|MAX|AVG|SAMPLE|GROUP_CONCAT|SEPARATOR)\b/i, 'keyword'],

      [/\b(STR|LANG|LANGMATCHES|DATATYPE|BOUND|IRI|URI|BNODE|RAND|ABS|CEIL|FLOOR|ROUND|CONCAT|STRLEN|UCASE|LCASE|ENCODE_FOR_URI|CONTAINS|STRSTARTS|STRENDS|STRBEFORE|STRAFTER|YEAR|MONTH|DAY|HOURS|MINUTES|SECONDS|TIMEZONE|TZ|NOW|UUID|STRUUID|MD5|SHA1|SHA256|SHA384|SHA512|COALESCE|IF|STRLANG|STRDT|SAMETERM|ISIRI|ISURI|ISBLANK|ISLITERAL|ISNUMERIC|REGEX|SUBSTR|REPLACE)\b/i, 'support.function'],

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

      [/\b(?:true|false)\b/i, 'keyword'],

      [/_:\w+/, 'variable.predefined'],

      [/\|\||&&|=|!=|<=?|>=?|\+|-|\*|\/|!/, 'operator'],

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

export const sparqlTemplates = [
  {
    label: 'SELECT query',
    detail: 'Basic SELECT query template',
    insertText: `SELECT ?s ?p ?o
WHERE {
  ?s ?p ?o .
}
LIMIT 100`,
  },
  {
    label: 'SELECT DISTINCT',
    detail: 'SELECT query with DISTINCT',
    insertText: `SELECT DISTINCT ?subject
WHERE {
  ?subject a <\${1:type}> .
}`,
  },
  {
    label: 'CONSTRUCT query',
    detail: 'CONSTRUCT query template',
    insertText: `CONSTRUCT {
  ?s ?p ?o .
}
WHERE {
  ?s ?p ?o .
}`,
  },
  {
    label: 'ASK query',
    detail: 'ASK query template',
    insertText: `ASK {
  <\${1:subject}> ?p ?o .
}`,
  },
  {
    label: 'DESCRIBE query',
    detail: 'DESCRIBE query template',
    insertText: `DESCRIBE <\${1:resource}>`,
  },
  {
    label: 'INSERT DATA',
    detail: 'Insert data template',
    insertText: `INSERT DATA {
  <\${1:subject}> <\${2:predicate}> <\${3:object}> .
}`,
  },
  {
    label: 'DELETE WHERE',
    detail: 'Delete matching triples',
    insertText: `DELETE WHERE {
  ?s ?p ?o .
  FILTER (?s = <\${1:subject}>)
}`,
  },
  {
    label: 'FILTER with REGEX',
    detail: 'Filter with regular expression',
    insertText: `FILTER (REGEX(?label, "\${1:pattern}", "i"))`,
  },
  {
    label: 'OPTIONAL',
    detail: 'Optional graph pattern',
    insertText: `OPTIONAL {
  ?s <\${1:predicate}> ?value .
}`,
  },
  {
    label: 'UNION',
    detail: 'Union of patterns',
    insertText: `{
  ?s <\${1:pred1}> ?o .
}
UNION
{
  ?s <\${2:pred2}> ?o .
}`,
  },
];

export function registerSparqlLanguage(monaco: typeof import('monaco-editor')) {
  monaco.languages.register({
    id: SPARQL_LANGUAGE_ID,
    extensions: SPARQL_EXTENSIONS,
    aliases: ['SPARQL', 'sparql', 'rq'],
    mimetypes: ['application/sparql-query', 'application/sparql-update'],
  });

  monaco.languages.setLanguageConfiguration(
    SPARQL_LANGUAGE_ID,
    sparqlLanguageConfiguration
  );

  monaco.languages.setMonarchTokensProvider(
    SPARQL_LANGUAGE_ID,
    sparqlTokensProvider as unknown as import('monaco-editor').languages.IMonarchLanguage
  );

  monaco.languages.registerCompletionItemProvider(SPARQL_LANGUAGE_ID, {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = [
        ...sparqlKeywords.map((kw) => ({
          label: kw,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: kw,
          range,
        })),
        ...sparqlFunctions.map((fn) => ({
          label: fn,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${fn}(\${1})`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
        ...sparqlTemplates.map((t) => ({
          label: t.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: t.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: t.detail,
          range,
        })),
      ];

      return { suggestions };
    },
  });
}
