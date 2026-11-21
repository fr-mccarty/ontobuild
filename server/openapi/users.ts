import { error, ref, type DocMap, type Schema } from "./types";

export const userSchemas: Record<string, Schema> = {
  User: {
    type: "object",
    required: ["id", "name", "email"],
    description: "OntoBuild runs as a single local user.",
    properties: {
      id: { type: "string", examples: ["local-user"] },
      name: { type: "string", examples: ["Local User"] },
      email: { type: "string", examples: ["local@localhost"] },
    },
  },
  UserSettings: {
    type: "object",
    required: ["user_id", "settings", "created_at", "updated_at"],
    properties: {
      user_id: { type: "string" },
      settings: {
        type: "object",
        additionalProperties: true,
        description: "Free-form preferences stored by the front end (theme, label preferences, and so on).",
      },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: ["string", "null"], format: "date-time" },
    },
  },
};

const settingsBody = {
  required: true,
  description: "Either the settings object itself or `{ \"settings\": { ... } }`.",
  schema: { type: "object", additionalProperties: true },
};

export const userDocs: DocMap = {
  "GET /health": {
    summary: "Health check",
    description: "Returns `healthy` once the database can be opened.",
    responses: {
      "200": {
        description: "The server is healthy.",
        schema: { type: "object", required: ["status"], properties: { status: { type: "string", const: "healthy" } } },
      },
    },
  },
  "GET /users/me": {
    summary: "Get current user",
    responses: { "200": { description: "The local user.", schema: ref("User") } },
  },
  "GET /users/me/settings": {
    summary: "Get user settings",
    responses: { "200": { description: "The user's settings.", schema: ref("UserSettings") } },
  },
  "PUT /users/me/settings": {
    summary: "Replace user settings",
    description: "Replaces all settings with the given object.",
    body: settingsBody,
    responses: {
      "200": { description: "The saved settings.", schema: ref("UserSettings") },
      "422": error("The body is not a JSON object."),
    },
  },
  "PATCH /users/me/settings": {
    summary: "Update user settings",
    description: "Merges the given keys into the stored settings. A key set to `null` is removed.",
    body: settingsBody,
    responses: {
      "200": { description: "The saved settings.", schema: ref("UserSettings") },
      "422": error("The body is not a JSON object."),
    },
  },
};
