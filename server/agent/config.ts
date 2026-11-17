import path from "node:path";
import { fromJson, get, insert, nowIso, toJson, update } from "../db";
import { LOCAL_USER } from "../user";
import {
  AGENT_CUSTOM_INSTRUCTIONS_LIMIT,
  AGENT_EFFORTS,
  DEFAULT_AGENT_API_KEY_ENV,
  DEFAULT_AGENT_SETTINGS,
  type AgentEffort,
  type AgentSettings,
} from "@/lib/api/agentSettings";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_HEADERS = { "HTTP-Referer": "http://localhost:3000", "X-Title": "OntoBuilder" };
export const API_KEY_ENV = DEFAULT_AGENT_API_KEY_ENV;
export const SECRETS_FILE = path.resolve(process.cwd(), ".env.local");
export const MODEL_ID_MAX = 200;

const EFFORT_IDS = new Set<string>(AGENT_EFFORTS.map((e) => e.id));

export function getApiKey(): string | null {
  const raw = process.env[API_KEY_ENV];
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key ? key : null;
}

export function isValidModelId(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= MODEL_ID_MAX;
}

export function isValidEffort(v: unknown): v is AgentEffort {
  return typeof v === "string" && EFFORT_IDS.has(v);
}

export function normalizeAgentSettings(raw: unknown): AgentSettings {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    model: isValidModelId(obj.model) ? obj.model.trim() : DEFAULT_AGENT_SETTINGS.model,
    effort: isValidEffort(obj.effort) ? obj.effort : DEFAULT_AGENT_SETTINGS.effort,
    custom_instructions:
      typeof obj.custom_instructions === "string"
        ? obj.custom_instructions.slice(0, AGENT_CUSTOM_INSTRUCTIONS_LIMIT)
        : DEFAULT_AGENT_SETTINGS.custom_instructions,
  };
}

function readUserSettings(): Record<string, unknown> | null {
  const row = get<{ settings: string }>("SELECT settings FROM user_settings WHERE user_id = ?", LOCAL_USER.id);
  return row ? fromJson<Record<string, unknown>>(row.settings, {}) : null;
}

export function readAgentSettings(): AgentSettings {
  return normalizeAgentSettings(readUserSettings()?.agent);
}

export function validateAgentSettingsPatch(body: unknown): { patch: Partial<AgentSettings> } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Expected a JSON object" };
  const obj = body as Record<string, unknown>;
  const patch: Partial<AgentSettings> = {};
  for (const key of Object.keys(obj)) {
    if (!["model", "effort", "custom_instructions"].includes(key)) return { error: `Unknown field '${key}'` };
  }
  if (obj.model !== undefined) {
    if (!isValidModelId(obj.model)) return { error: `model must be a non-empty string of at most ${MODEL_ID_MAX} characters` };
    patch.model = obj.model.trim();
  }
  if (obj.effort !== undefined) {
    if (!isValidEffort(obj.effort)) return { error: `effort must be one of ${[...EFFORT_IDS].join(", ")}` };
    patch.effort = obj.effort;
  }
  if (obj.custom_instructions !== undefined) {
    if (typeof obj.custom_instructions !== "string") return { error: "custom_instructions must be a string" };
    if (obj.custom_instructions.length > AGENT_CUSTOM_INSTRUCTIONS_LIMIT)
      return { error: `custom_instructions must be at most ${AGENT_CUSTOM_INSTRUCTIONS_LIMIT} characters` };
    patch.custom_instructions = obj.custom_instructions;
  }
  return { patch };
}

export function saveAgentSettings(patch: Partial<AgentSettings>): AgentSettings {
  const current = readUserSettings();
  const merged = normalizeAgentSettings({ ...readAgentSettings(), ...patch });
  const next = { ...(current ?? {}), agent: merged };
  if (current === null) {
    insert("user_settings", { user_id: LOCAL_USER.id, settings: toJson(next) ?? "{}", created_at: nowIso() });
  } else {
    update("user_settings", { settings: toJson(next) ?? "{}", updated_at: nowIso() }, { user_id: LOCAL_USER.id });
  }
  return merged;
}

export function notConfiguredDetail(): string {
  return `No ${API_KEY_ENV} in ${SECRETS_FILE}`;
}
