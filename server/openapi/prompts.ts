import { error, ref, type DocMap, type Schema } from "./types";

export const promptsSchemas: Record<string, Schema> = {
  ProvenanceItem: {
    type: "object",
    required: ["iri", "property", "value"],
    properties: {
      iri: { type: "string", description: "Subject entity IRI." },
      property: { type: "string", description: "Annotation property IRI." },
      value: { type: "string", description: "The literal text." },
    },
  },
  Provenance: {
    type: "object",
    description:
      "Where a text value came from. `approved`: on the default branch and introduced by a merged pull request with enough approving reviews (at least one). `direct`: on the default branch without such a pull request. `pending`: only on another branch. `unknown`: not found.",
    required: ["iri", "property", "value", "status", "introduced_in", "pull_request", "on_default_branch"],
    properties: {
      iri: { type: "string" },
      property: { type: "string" },
      value: { type: "string" },
      status: { type: "string", enum: ["approved", "direct", "pending", "unknown"] },
      introduced_in: {
        type: ["object", "null"],
        description: "The commit that added the text (found with `git log -S`, so approximate).",
        required: ["hash", "short_hash", "message", "author_name", "timestamp"],
        properties: {
          hash: { type: "string" },
          short_hash: { type: "string" },
          message: { type: "string" },
          author_name: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      pull_request: {
        type: ["object", "null"],
        description: "The merged pull request that brought the commit to the default branch, or the open one for a pending value.",
        required: ["number", "title", "status", "merged_at", "merged_by", "approvals"],
        properties: {
          number: { type: "integer" },
          title: { type: "string" },
          status: { type: "string", enum: ["open", "merged", "closed"] },
          merged_at: { type: ["string", "null"], format: "date-time" },
          merged_by: { type: ["string", "null"] },
          approvals: {
            type: "array",
            items: {
              type: "object",
              required: ["reviewer", "at"],
              properties: { reviewer: { type: "string" }, at: { type: "string", format: "date-time" } },
            },
          },
        },
      },
      on_default_branch: { type: "boolean" },
    },
  },
};

export const promptsDocs: DocMap = {
  "GET /projects/{id}/provenance": {
    summary: "Get a text value's provenance",
    description:
      "Whether a text value was approved through a pull request before it reached the default branch. Used by \"Run as prompt\" to show if a prompt has been agreed.",
    query: [
      { name: "iri", description: "Subject entity IRI.", schema: { type: "string" }, required: true },
      { name: "property", description: "Annotation property IRI.", schema: { type: "string" }, required: true },
      { name: "value", description: "The literal text.", schema: { type: "string" }, required: true },
      { name: "branch", description: "Branch the value is viewed on (defaults to the default branch).", schema: { type: "string" } },
    ],
    responses: {
      "200": { description: "The provenance", schema: ref("Provenance") },
      "404": error("Project not found"),
      "422": error("Missing or invalid parameters"),
    },
  },
  "POST /projects/{id}/provenance/batch": {
    summary: "Get provenance for many values",
    description: "The batch form of the provenance lookup, for every text value shown in an entity panel at once (at most 200).",
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["items"],
        properties: {
          branch: { type: "string" },
          items: { type: "array", maxItems: 200, items: ref("ProvenanceItem") },
        },
      },
    },
    responses: {
      "200": {
        description: "Provenance for each item, in order",
        schema: { type: "object", required: ["items"], properties: { items: { type: "array", items: ref("Provenance") } } },
      },
      "404": error("Project not found"),
      "422": error("Invalid items"),
    },
  },
};
