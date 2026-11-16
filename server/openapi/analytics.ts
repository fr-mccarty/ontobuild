import { error, ref, type DocMap, type Schema } from "./types";

export const analyticsSchemas: Record<string, Schema> = {
  AnalyticsChangeEvent: {
    type: "object",
    description: "An entity-level change recorded from a commit.",
    required: [
      "id",
      "project_id",
      "branch",
      "entity_iri",
      "entity_type",
      "event_type",
      "user_id",
      "user_name",
      "commit_hash",
      "changed_fields",
      "old_values",
      "new_values",
      "created_at",
    ],
    properties: {
      id: { type: "string" },
      project_id: { type: "string" },
      branch: { type: "string" },
      entity_iri: { type: "string" },
      entity_type: { type: "string", enum: ["class", "property", "individual"] },
      event_type: { type: "string", enum: ["create", "update", "delete", "rename", "reparent", "deprecate"] },
      user_id: { type: "string" },
      user_name: { type: ["string", "null"] },
      commit_hash: { type: ["string", "null"] },
      changed_fields: {
        type: "array",
        items: { type: "string", enum: ["labels", "parents", "deprecated", "comments", "other"] },
      },
      old_values: {
        type: ["object", "null"],
        additionalProperties: true,
        description: "Previous `labels`, `parents` and/or `deprecated` values, when those changed.",
      },
      new_values: {
        type: ["object", "null"],
        additionalProperties: true,
        description: "New `labels`, `parents` and/or `deprecated` values, when those changed.",
      },
      created_at: { type: "string", format: "date-time" },
    },
  },
  AnalyticsHotEntity: {
    type: "object",
    required: ["entity_iri", "entity_type", "label", "edit_count", "editor_count", "last_edited_at"],
    properties: {
      entity_iri: { type: "string" },
      entity_type: { type: "string" },
      label: { type: ["string", "null"], description: "Preferred label from the current ontology, if any." },
      edit_count: { type: "integer" },
      editor_count: { type: "integer" },
      last_edited_at: { type: "string", format: "date-time" },
    },
  },
  AnalyticsContributor: {
    type: "object",
    required: ["user_id", "user_name", "create_count", "update_count", "delete_count", "total_count", "last_active_at"],
    properties: {
      user_id: { type: "string" },
      user_name: { type: ["string", "null"], description: "Display name recorded with the events, or null if none was recorded." },
      create_count: { type: "integer" },
      update_count: { type: "integer", description: "Updates, renames, reparents and deprecations." },
      delete_count: { type: "integer" },
      total_count: { type: "integer" },
      last_active_at: { type: "string", format: "date-time" },
    },
  },
};

const daysParam = {
  name: "days",
  description: "Look-back window in days.",
  schema: { type: "integer", minimum: 1, maximum: 365, default: 30 },
};

export const analyticsDocs: DocMap = {
  "GET /projects/{id}/analytics/activity": {
    summary: "Get project activity",
    description: "Counts change events per day across all branches, with the top 10 editors.",
    query: [daysParam],
    responses: {
      "200": {
        description: "Activity summary.",
        schema: {
          type: "object",
          required: ["daily_counts", "total_events", "top_editors"],
          properties: {
            daily_counts: {
              type: "array",
              description: "Days with at least one event, oldest first.",
              items: {
                type: "object",
                required: ["date", "count"],
                properties: { date: { type: "string", format: "date" }, count: { type: "integer" } },
              },
            },
            total_events: { type: "integer" },
            top_editors: {
              type: "array",
              items: {
                type: "object",
                required: ["user_id", "user_name", "edit_count"],
                properties: {
                  user_id: { type: "string" },
                  user_name: { type: ["string", "null"] },
                  edit_count: { type: "integer" },
                },
              },
            },
          },
        },
      },
      "404": error("Project not found."),
      "422": error("`days` is not an integer in range."),
    },
  },
  "GET /projects/{id}/analytics/entity/{iri}/history": {
    summary: "Get entity history",
    description: "Lists change events for one entity, newest first.",
    query: [
      { name: "branch", description: "Only events on this branch. Defaults to all branches.", schema: { type: "string" } },
      { name: "limit", description: "Maximum number of events.", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
    ],
    responses: {
      "200": {
        description: "The entity's change events.",
        schema: {
          type: "object",
          required: ["entity_iri", "events", "total"],
          properties: {
            entity_iri: { type: "string" },
            events: { type: "array", items: ref("AnalyticsChangeEvent") },
            total: { type: "integer", description: "Number of matching events, ignoring `limit`." },
          },
        },
      },
      "404": error("Project not found."),
      "422": error("`limit` is not an integer in range."),
    },
  },
  "GET /projects/{id}/analytics/hot-entities": {
    summary: "List hot entities",
    description: "Lists the most-edited entities over the look-back window.",
    query: [
      daysParam,
      { name: "limit", description: "Maximum number of entities.", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
    ],
    responses: {
      "200": { description: "Entities by edit count, highest first.", schema: { type: "array", items: ref("AnalyticsHotEntity") } },
      "404": error("Project not found."),
      "422": error("`limit` or `days` is not an integer in range."),
    },
  },
  "GET /projects/{id}/analytics/contributors": {
    summary: "List contributors",
    description: "Summarizes change events per user over the window.",
    query: [daysParam],
    responses: {
      "200": { description: "Contributors by total events, highest first.", schema: { type: "array", items: ref("AnalyticsContributor") } },
      "404": error("Project not found."),
      "422": error("`days` is not an integer in range."),
    },
  },
};
