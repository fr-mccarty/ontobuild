import { error, ref, type DocMap, type Schema } from "./types";

export const agentSchemas: Record<string, Schema> = {
  AgentSettings: {
    type: "object",
    required: ["model", "effort", "custom_instructions"],
    properties: {
      model: { type: "string", maxLength: 200, description: "OpenRouter model id.", examples: ["anthropic/claude-opus-5.5"] },
      effort: { type: "string", enum: ["low", "medium", "high"], description: "Reasoning effort sent to the model." },
      custom_instructions: { type: "string", maxLength: 4000, description: "Extra instructions appended to the system prompt." },
    },
  },
  AgentModel: {
    type: "object",
    required: ["id", "name", "context_length", "prompt_price_per_million", "completion_price_per_million", "supports_reasoning"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      context_length: { type: ["integer", "null"] },
      prompt_price_per_million: { type: ["number", "null"], description: "USD per million input tokens." },
      completion_price_per_million: { type: ["number", "null"], description: "USD per million output tokens." },
      supports_reasoning: { type: "boolean" },
    },
  },
};

export const agentDocs: DocMap = {
  "GET /agent/status": {
    summary: "Get agent status",
    description: "Reports whether an OpenRouter API key is configured, where it is read from, and the current agent settings.",
    responses: {
      "200": {
        description: "Agent status.",
        schema: {
          type: "object",
          required: ["configured", "secrets_file", "settings"],
          properties: {
            configured: { type: "boolean", description: "True when the API key environment variable is set." },
            secrets_file: { type: "string", description: "Absolute path of the .env.local file the key is read from." },
            api_key_env: { type: "string", examples: ["OPENROUTER_API_KEY"] },
            settings: ref("AgentSettings"),
          },
        },
      },
    },
  },
  "GET /agent/models": {
    summary: "List agent models",
    description: "Lists OpenRouter models that support tool calling, sorted by name. Cached for 10 minutes.",
    responses: {
      "200": {
        description: "Available models.",
        schema: { type: "object", required: ["models"], properties: { models: { type: "array", items: ref("AgentModel") } } },
      },
      "502": error("OpenRouter could not be reached or returned an error."),
    },
  },
  "GET /agent/settings": {
    summary: "Get agent settings",
    responses: { "200": { description: "Current agent settings.", schema: ref("AgentSettings") } },
  },
  "PATCH /agent/settings": {
    summary: "Update agent settings",
    description: "Updates any subset of the agent settings and returns the full result.",
    body: {
      required: true,
      schema: {
        type: "object",
        properties: {
          model: { type: "string", minLength: 1, maxLength: 200 },
          effort: { type: "string", enum: ["low", "medium", "high"] },
          custom_instructions: { type: "string", maxLength: 4000 },
        },
      },
    },
    responses: {
      "200": { description: "Updated agent settings.", schema: ref("AgentSettings") },
      "422": error("A field is invalid."),
    },
  },
  "POST /agent/test": {
    summary: "Test agent connection",
    description: "Checks the API key with OpenRouter and confirms the configured model is available with tool support.",
    responses: {
      "200": {
        description: "The key works and the model is available.",
        schema: {
          type: "object",
          required: ["ok", "model"],
          properties: { ok: { type: "boolean", const: true }, model: { type: "string" } },
        },
      },
      "400": error("No API key is configured, the key was rejected, or the model is unavailable."),
      "429": error("Rate limited by OpenRouter."),
      "502": error("OpenRouter could not be reached or returned an error."),
    },
  },
  "POST /projects/{id}/agent/chat": {
    summary: "Chat with the agent",
    description:
      "Sends one user turn to the editing agent and streams the reply as [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html). " +
      "Event names are `message`, `text`, `thinking`, `tool_use`, `tool_result`, `ontology_changed`, `ui_action`, `done` and `error`; each `data` field is JSON. " +
      "`tool_result` carries `mutated: true` when the tool changed project state (ontology, branches, pull requests or settings). " +
      "`ontology_changed` follows the `tool_result` of a tool call that committed to an ontology file, once per branch it committed to: " +
      "`{tool_use_id, name, branch, commit_hash, deleted_iris}`, where `commit_hash` is the branch's new head and `deleted_iris` lists entities the call deleted. " +
      "Read-only tools never send it. " +
      "`ui_action` asks the editor to do something: `{tool_use_id, action: \"select_entity\", iri, entity_type, label, branch}` (sent by the `select_entity` tool) selects and reveals an entity, " +
      "where `entity_type` is `class`, `property` or `individual`. " +
      "The agent can read the project's ontology on the given branch and the files in the project folder. " +
      "What it may change is set per request by `permissions`: `edit_ontology` allows tools that change the ontology, branches, pull requests or project settings; " +
      "`edit_code` allows writing and deleting files in the project folder and running shell commands there. " +
      "Tools that are not allowed are left out of the tool list sent to the model, and a call to one anyway returns an error tool result without side effects. " +
      "When `permissions` (or one of its fields) is absent, `edit_ontology` defaults to true and `edit_code` to false.",
    query: [{ name: "branch", description: "Branch to work on. Defaults to the repository's default branch.", schema: { type: "string" } }],
    body: {
      required: true,
      schema: {
        type: "object",
        required: ["user_message"],
        properties: {
          user_message: { type: "string", minLength: 1 },
          messages: {
            type: "array",
            description: "Prior conversation in OpenAI chat format (user, assistant and tool messages).",
            items: { type: "object", required: ["role"], properties: { role: { type: "string", enum: ["user", "assistant", "tool"] } } },
          },
          page_context: { type: "string", description: "Description of what the user is looking at in the editor." },
          model: { type: ["string", "null"], maxLength: 200, description: "Overrides the configured model for this turn." },
          permissions: {
            type: "object",
            description: "What the agent may change in this turn. Defaults to `{edit_ontology: true, edit_code: false}`.",
            properties: {
              edit_ontology: {
                type: "boolean",
                default: true,
                description: "Allow changes to the ontology, branches, pull requests and project settings.",
              },
              edit_code: {
                type: "boolean",
                default: false,
                description: "Allow writing and deleting files in the project folder and running shell commands there.",
              },
            },
          },
        },
      },
    },
    responses: {
      "200": { description: "Event stream.", contentType: "text/event-stream", schema: { type: "string" } },
      "400": error("No API key is configured."),
      "404": error("Project or branch not found."),
      "422": error("The request body is invalid (including a `permissions` field that is not an object of booleans)."),
    },
  },
};
