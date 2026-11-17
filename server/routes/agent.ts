import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { httpError, readJson } from "../http";
import { requireProject, requireBranch } from "../ontology";
import {
  API_KEY_ENV,
  OPENROUTER_BASE_URL,
  OPENROUTER_HEADERS,
  SECRETS_FILE,
  getApiKey,
  isValidModelId,
  notConfiguredDetail,
  readAgentSettings,
  saveAgentSettings,
  validateAgentSettingsPatch,
} from "../agent/config";
import {
  createOpenRouterClient,
  describeError,
  isAbortError,
  runAgentChat,
  type AgentClient,
  type AgentEventName,
} from "../agent/chat";
import { DEFAULT_AGENT_PERMISSIONS, type AgentPermissions } from "../agent/tools";
import type { AgentModel } from "@/lib/api/agentSettings";

export interface AppLike {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

let clientFactory: (apiKey: string) => AgentClient = (apiKey) => createOpenRouterClient(apiKey);

export function setAgentClientFactory(factory: ((apiKey: string) => AgentClient) | null) {
  clientFactory = factory ?? ((apiKey) => createOpenRouterClient(apiKey));
}

const MODELS_TTL_MS = 10 * 60 * 1000;
let modelsCache: { at: number; models: AgentModel[] } | null = null;

export function clearAgentModelsCache() {
  modelsCache = null;
}

interface OpenRouterModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
  supported_parameters?: unknown;
}

function perMillion(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1e6 * 1e6) / 1e6 : null;
}

export function toAgentModels(data: unknown): AgentModel[] {
  const list = (data as { data?: unknown })?.data;
  if (!Array.isArray(list)) return [];
  const out: AgentModel[] = [];
  for (const m of list as OpenRouterModel[]) {
    if (typeof m.id !== "string" || m.id.endsWith(":batch")) continue;
    const params = Array.isArray(m.supported_parameters) ? (m.supported_parameters as unknown[]) : [];
    if (!params.includes("tools")) continue;
    out.push({
      id: m.id,
      name: typeof m.name === "string" && m.name ? m.name : m.id,
      context_length: typeof m.context_length === "number" ? m.context_length : null,
      prompt_price_per_million: perMillion(m.pricing?.prompt),
      completion_price_per_million: perMillion(m.pricing?.completion),
      supports_reasoning: params.includes("reasoning"),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchModels(): Promise<AgentModel[]> {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.models;
  let res: Response;
  try {
    res = await fetch(`${OPENROUTER_BASE_URL}/models`, { headers: OPENROUTER_HEADERS });
  } catch {
    httpError(502, "Could not reach OpenRouter");
  }
  if (!res.ok) httpError(502, `OpenRouter returned HTTP ${res.status} for the model list`);
  const models = toAgentModels(await res.json());
  modelsCache = { at: Date.now(), models };
  return models;
}

function validHistory(v: unknown): v is ChatCompletionMessageParam[] {
  return (
    Array.isArray(v) &&
    v.every(
      (m) =>
        m &&
        typeof m === "object" &&
        !Array.isArray(m) &&
        ["user", "assistant", "tool"].includes((m as { role?: unknown }).role as string),
    )
  );
}

/** The request's `permissions`, with defaults for an absent object or field; null when invalid. */
export function parsePermissions(v: unknown): AgentPermissions | null {
  if (v === undefined || v === null) return { ...DEFAULT_AGENT_PERMISSIONS };
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const p = v as Record<string, unknown>;
  const out = { ...DEFAULT_AGENT_PERMISSIONS };
  for (const key of ["edit_code", "edit_ontology"] as const) {
    if (p[key] === undefined) continue;
    if (typeof p[key] !== "boolean") return null;
    out[key] = p[key];
  }
  return out;
}

export function createAgentRoutes(getApp: () => AppLike) {
  const r = new Hono();

  r.get("/agent/status", (c) =>
    c.json({
      configured: getApiKey() !== null,
      secrets_file: SECRETS_FILE,
      api_key_env: API_KEY_ENV,
      settings: readAgentSettings(),
    }),
  );

  r.get("/agent/models", async (c) => c.json({ models: await fetchModels() }));

  r.get("/agent/settings", (c) => c.json(readAgentSettings()));

  r.patch("/agent/settings", async (c) => {
    const result = validateAgentSettingsPatch(await readJson<unknown>(c));
    if ("error" in result) httpError(422, result.error);
    return c.json(saveAgentSettings(result.patch));
  });

  r.post("/agent/test", async (c) => {
    const apiKey = getApiKey();
    if (!apiKey) httpError(400, notConfiguredDetail());
    const { model } = readAgentSettings();
    let res: Response;
    try {
      res = await fetch(`${OPENROUTER_BASE_URL}/key`, {
        headers: { ...OPENROUTER_HEADERS, Authorization: `Bearer ${apiKey}` },
      });
    } catch {
      httpError(502, "Could not reach OpenRouter");
    }
    if (res.status === 401 || res.status === 403) httpError(400, "OpenRouter rejected the API key");
    if (res.status === 429) httpError(429, "Rate limited by OpenRouter; try again shortly");
    if (!res.ok) httpError(502, `OpenRouter returned HTTP ${res.status} while checking the key`);
    let models: AgentModel[] | null = null;
    try {
      models = await fetchModels();
    } catch {
      models = null;
    }
    if (models && !models.some((m) => m.id === model)) {
      httpError(400, `The API key works, but model "${model}" is not available on OpenRouter with tool support`);
    }
    return c.json({ ok: true, model });
  });

  r.post("/projects/:id/agent/chat", async (c) => {
    const projectId = c.req.param("id");
    requireProject(projectId);
    const body = await readJson<Record<string, unknown>>(c);
    const history = body.messages ?? [];
    if (!validHistory(history)) httpError(422, "messages must be an array of user, assistant or tool messages");
    if (typeof body.user_message !== "string" || !body.user_message.trim())
      httpError(422, "user_message must be a non-empty string");
    const pageContext = typeof body.page_context === "string" ? body.page_context : "";
    if (body.model !== undefined && body.model !== null && !isValidModelId(body.model))
      httpError(422, "model must be a non-empty string of at most 200 characters");
    const permissions = parsePermissions(body.permissions);
    if (!permissions) httpError(422, "permissions must be an object with boolean edit_code and edit_ontology");
    const apiKey = getApiKey();
    if (!apiKey) httpError(400, notConfiguredDetail());
    const branch = await requireBranch(projectId, c.req.query("branch"));
    const settings = readAgentSettings();
    const model = typeof body.model === "string" ? body.model.trim() : settings.model;
    const userMessage = body.user_message;
    const client = clientFactory(apiKey);

    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      stream.onAbort(abort);
      c.req.raw.signal?.addEventListener("abort", abort, { once: true });

      const send = async (event: AgentEventName, data: unknown) => {
        if (controller.signal.aborted || stream.aborted) return;
        try {
          await stream.writeSSE({ event, data: JSON.stringify(data) });
        } catch {
          controller.abort();
        }
      };

      try {
        await runAgentChat({
          client,
          model,
          effort: settings.effort,
          customInstructions: settings.custom_instructions,
          history,
          userMessage,
          pageContext,
          permissions,
          send,
          signal: controller.signal,
          toolContext: {
            projectId,
            branch,
            editorBranch: branch,
            permissions,
            signal: controller.signal,
            request: (path, init) => Promise.resolve(getApp().request(path, init)),
          },
        });
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return;
        await send("error", { detail: describeError(err) });
      } finally {
        c.req.raw.signal?.removeEventListener("abort", abort);
      }
    });
  });

  return r;
}
