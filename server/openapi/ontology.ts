import { error, ref, type DocMap, type QueryParamDoc, type Schema } from "./types";

/** Fields set on classes that come from an imported ontology (see the Imports operations). */
const importedProps: Record<string, Schema> = {
  imported_from: {
    type: "string",
    description:
      "Present only for a class that comes from an ontology this one imports (`owl:imports`, followed transitively): that ontology's IRI. Such classes are read-only here.",
  },
  imported_from_label: {
    type: ["string", "null"],
    description: "Present with `imported_from`: the importing source's project name or ontology title, if known.",
  },
};

export const ontologySchemas: Record<string, Schema> = {
  OntologyLiteral: {
    type: "object",
    required: ["value"],
    description: "A literal value. Language tags are not exposed.",
    properties: { value: { type: "string" } },
  },
  OntologyAnnotationValue: {
    type: "object",
    required: ["value", "type"],
    properties: {
      value: { type: "string", description: "The literal text, or the IRI for an IRI reference." },
      type: { type: "string", enum: ["literal", "iri"], description: "Whether the value is a literal or an IRI reference." },
    },
  },
  OntologyTreeNode: {
    type: "object",
    required: ["iri", "label", "child_count", "deprecated"],
    properties: {
      iri: { type: "string", format: "uri" },
      label: { type: "string", description: "Preferred label, falling back to the IRI's local name." },
      child_count: { type: "integer", description: "Number of direct subclasses." },
      deprecated: { type: "boolean", description: "True when the class has `owl:deprecated true`." },
      ...importedProps,
    },
  },
  OntologyTreeNodes: {
    type: "object",
    required: ["nodes", "total_classes"],
    properties: {
      nodes: { type: "array", items: ref("OntologyTreeNode") },
      total_classes: { type: "integer", description: "Number of classes in the whole ontology (the project's own classes, not imported ones)." },
    },
  },
  OntologyAnnotation: {
    type: "object",
    required: ["property_iri", "property_label", "values"],
    properties: {
      property_iri: { type: "string", format: "uri" },
      property_label: { type: "string", description: "Prefixed name of the property.", examples: ["skos:definition"] },
      values: {
        type: "array",
        items: ref("OntologyAnnotationValue"),
        description: "Values of the annotation; `type` tells literals and IRI references apart.",
      },
    },
  },
  OntologyClass: {
    type: "object",
    required: [
      "iri",
      "labels",
      "comments",
      "deprecated",
      "parent_iris",
      "parent_labels",
      "equivalent_iris",
      "disjoint_iris",
      "child_count",
      "subclasses",
      "instance_count",
      "instances",
      "annotations",
    ],
    properties: {
      iri: { type: "string", format: "uri" },
      labels: { type: "array", items: ref("OntologyLiteral"), description: "`rdfs:label` values." },
      comments: { type: "array", items: ref("OntologyLiteral"), description: "`rdfs:comment` values." },
      deprecated: { type: "boolean" },
      parent_iris: { type: "array", items: { type: "string" }, description: "Named `rdfs:subClassOf` targets." },
      parent_labels: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Display label for each parent IRI.",
      },
      equivalent_iris: { type: "array", items: { type: "string" } },
      disjoint_iris: { type: "array", items: { type: "string" } },
      child_count: { type: "integer" },
      subclasses: {
        type: "array",
        description: "The direct subclasses of this class, sorted by label.",
        items: {
          type: "object",
          required: ["iri", "label"],
          properties: { iri: { type: "string" }, label: { type: "string" } },
        },
      },
      instance_count: { type: "integer" },
      instances: {
        type: "array",
        description: "Named individuals typed with this class, sorted by label.",
        items: {
          type: "object",
          required: ["iri", "label"],
          properties: { iri: { type: "string" }, label: { type: "string" } },
        },
      },
      annotations: { type: "array", items: ref("OntologyAnnotation") },
      ...importedProps,
    },
  },
  OntologySearchResult: {
    type: "object",
    required: ["iri", "label", "entity_type", "property_kind", "deprecated"],
    properties: {
      iri: { type: "string", format: "uri" },
      label: { type: "string" },
      entity_type: { type: "string", enum: ["class", "property", "individual"] },
      property_kind: {
        type: ["string", "null"],
        enum: ["object", "data", "annotation", null],
        description: "Set for OWL properties; `null` for classes, individuals and plain `rdf:Property`.",
      },
      deprecated: { type: "boolean" },
      ...importedProps,
    },
  },
  OntologyIndexStatus: {
    type: "object",
    required: ["project_id", "branch", "status", "entity_count", "indexed_at", "commit_hash", "error_message"],
    properties: {
      project_id: { type: "string" },
      branch: { type: "string" },
      status: { type: "string", enum: ["indexing", "ready", "failed"] },
      entity_count: { type: ["integer", "null"] },
      indexed_at: { type: ["string", "null"], format: "date-time" },
      commit_hash: { type: ["string", "null"] },
      error_message: { type: ["string", "null"] },
    },
  },
  OntologyEntityReference: {
    type: "object",
    required: ["source_iri", "source_type", "source_label", "reference_context"],
    properties: {
      source_iri: { type: "string", format: "uri", description: "Named entity that references the target." },
      source_type: { type: "string", enum: ["class", "property", "individual", "unknown"] },
      source_label: {
        type: ["string", "null"],
        description: "Preferred label of the source (using the project's label preferences), or null if it has none.",
      },
      reference_context: { type: "string" },
    },
  },
};

const branchQuery: QueryParamDoc = {
  name: "branch",
  description: "Branch to read. Defaults to the repository's default branch.",
  schema: { type: "string" },
};

const commitMessageQuery: QueryParamDoc = {
  name: "commit_message",
  description: "Commit message for the deletion. Defaults to a generated message. May also be sent in the JSON body; the query parameter wins.",
  schema: { type: "string", maxLength: 500 },
};

const deleteBody = {
  required: false,
  description: "Optional alternative to the `commit_message` query parameter.",
  schema: {
    type: "object",
    properties: { commit_message: { type: "string", maxLength: 500 } },
  },
};

const loadErrors = {
  "404": error("Project, repository, branch or ontology file not found."),
  "422": error("The ontology could not be parsed."),
};

const treeResponse = (description: string) => ({
  "200": { description, schema: ref("OntologyTreeNodes") },
  ...loadErrors,
});

export const ontologyDocs: DocMap = {
  "GET /projects/{id}/ontology/tree": {
    summary: "Get the class tree roots",
    description:
      "Returns the top-level classes: those with no named superclass other than `owl:Thing`, sorted by label. " +
      "Classes from imported ontologies are included and marked with `imported_from`; a local class that is a subclass of an imported class appears under it.",
    query: [branchQuery],
    responses: treeResponse("Root classes."),
  },
  "GET /projects/{id}/ontology/tree/{iri}/children": {
    summary: "Get class children",
    description: "Returns the direct subclasses of a class, sorted by label.",
    pathParams: { iri: "Full IRI of the parent class, URL-encoded." },
    query: [branchQuery],
    responses: { ...treeResponse("Direct subclasses."), "404": error("Project, branch or ontology not found, or the IRI does not appear in the ontology.") },
  },
  "GET /projects/{id}/ontology/tree/{iri}/ancestors": {
    summary: "Get class ancestors",
    description:
      "Returns one path of superclasses from a root down to the class's direct parent (the class itself is excluded). " +
      "Where a class has several parents, the first by label (the tree's sort order) is followed. An IRI that is in the ontology but is not a class yields an empty list.",
    pathParams: { iri: "Full IRI of the class, URL-encoded." },
    query: [branchQuery],
    responses: { ...treeResponse("Ancestors, root first."), "404": error("Project, branch or ontology not found, or the IRI does not appear in the ontology.") },
  },
  "GET /projects/{id}/ontology/classes/{iri}": {
    summary: "Get a class",
    pathParams: { iri: "Full IRI of the class, URL-encoded." },
    query: [branchQuery],
    responses: {
      "200": { description: "Class detail.", schema: ref("OntologyClass") },
      "404": error("Project, branch or ontology not found, or the IRI is not a class."),
      "422": loadErrors["422"],
    },
  },
  "DELETE /projects/{id}/ontology/classes/{iri}": {
    summary: "Delete a class",
    description:
      "Removes every triple about the class, every triple pointing at it, and any blank-node expressions that mention it, then commits the result to the branch.",
    pathParams: { iri: "Full IRI of the class, URL-encoded." },
    query: [branchQuery, commitMessageQuery],
    body: deleteBody,
    responses: {
      "204": { description: "The class was deleted and the change committed." },
      "403": error("The class comes from an imported ontology and is read-only."),
      "404": error("Project, branch or ontology not found, or the IRI is not a class."),
      "422": error("The ontology could not be parsed, the body is not valid JSON, or `commit_message` is invalid or longer than 500 characters."),
    },
  },
  "DELETE /projects/{id}/ontology/entities/{iri}": {
    summary: "Delete an entity",
    description:
      "Deletes any entity that is the subject of at least one triple (class, property, individual...) the same way as deleting a class, and commits the result.",
    query: [branchQuery, commitMessageQuery],
    body: deleteBody,
    responses: {
      "204": { description: "The entity was deleted and the change committed." },
      "403": error("The entity is a class from an imported ontology and is read-only."),
      "404": error("Project, branch or ontology not found, or the IRI is not the subject of any triple."),
      "422": error("The ontology could not be parsed, the body is not valid JSON, or `commit_message` is invalid or longer than 500 characters."),
    },
  },
  "GET /projects/{id}/ontology/search": {
    summary: "Search the ontology",
    description:
      "Case-insensitive substring match on local name, IRI and label-like properties (`rdfs:label`, `skos:prefLabel`, `skos:altLabel`, `dc(terms):title`). " +
      "Results whose label starts with the query come first; at most 50 are returned. " +
      "`q=*` deliberately returns every entity unpaged: the property tree and individual list use it to list all entities of a type. " +
      "Classes from imported ontologies are included and marked with `imported_from`; other imported entities are not.",
    query: [
      { name: "q", description: "Search text, or `*` for all entities.", required: true, schema: { type: "string", minLength: 1, maxLength: 200 } },
      {
        name: "entity_types",
        description: "Comma-separated entity types to include: `class`, `property`, `individual`. Defaults to all. Unknown types are rejected with 422.",
        schema: { type: "string", examples: ["class,property"] },
      },
      {
        name: "limit",
        description: "Return at most this many results (overrides the defaults above). `total` still counts every match, so `limit=0` returns only the count.",
        schema: { type: "integer", minimum: 0 },
      },
      branchQuery,
    ],
    responses: {
      "200": {
        description: "Matching entities.",
        schema: {
          type: "object",
          required: ["results", "total"],
          properties: {
            results: { type: "array", items: ref("OntologySearchResult") },
            total: { type: "integer", description: "Total number of matches before the 50-result cap." },
          },
        },
      },
      "404": loadErrors["404"],
      "422": error("`q` is missing or longer than 200 characters, `entity_types` names an unknown type, or the ontology could not be parsed."),
    },
  },
  "GET /projects/{id}/ontology/index-status": {
    summary: "Get index status",
    description:
      "Reports whether the entity index for a branch is ready, rebuilding, or failed. Reading the status indexes the current commit if needed. " +
      "A source that cannot be parsed is reported as `status: \"failed\"` with the parse error in `error_message`; " +
      "a missing project, repository, branch or ontology file is returned as a 404 with the real reason.",
    query: [branchQuery],
    responses: {
      "200": { description: "Index status.", schema: ref("OntologyIndexStatus") },
      "404": error("Project, repository, branch or ontology file not found (the detail says which)."),
    },
  },
  "POST /projects/{id}/ontology/reindex": {
    summary: "Rebuild the index",
    description:
      "Starts a background job that clears the ontology cache and re-indexes the branch. Does nothing if a job is already running. Poll the index status for the result.",
    query: [branchQuery],
    responses: {
      "202": {
        description: "The reindex was accepted.",
        schema: {
          type: "object",
          required: ["status", "branch"],
          properties: { status: { type: "string", const: "accepted" }, branch: { type: "string" } },
        },
      },
      "404": error("Project not found."),
    },
  },
  "GET /projects/{id}/entities/{iri}/references": {
    summary: "List entity references",
    description:
      "Finds entities that point at the given IRI, grouped by how they reference it (as a parent, domain, range, type, restriction filler, annotation value...). " +
      "References from blank-node expressions are attributed to the named entities that own them.",
    query: [branchQuery],
    responses: {
      "200": {
        description: "References grouped by context.",
        schema: {
          type: "object",
          required: ["target_iri", "total", "groups"],
          properties: {
            target_iri: { type: "string", format: "uri" },
            total: { type: "integer", description: "Number of references across all groups." },
            groups: {
              type: "array",
              items: {
                type: "object",
                required: ["context", "context_label", "references"],
                properties: {
                  context: {
                    type: "string",
                    enum: [
                      "parent_iris",
                      "domain_iris",
                      "range_iris",
                      "type_iris",
                      "equivalent_iris",
                      "disjoint_iris",
                      "some_values_from",
                      "annotation_value",
                      "see_also",
                      "inverse_of",
                    ],
                  },
                  context_label: { type: "string", examples: ["As parent class"] },
                  references: { type: "array", items: ref("OntologyEntityReference") },
                },
              },
            },
          },
        },
      },
      ...loadErrors,
      "404": error("Project, branch or ontology not found, or the IRI does not appear in the ontology."),
    },
  },
};
