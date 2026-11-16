import { api } from "./client";

export type AgentEffort = "low" | "medium" | "high";

export interface AgentSettings {
  model: string;
  effort: AgentEffort;
  custom_instructions: string;
}

export interface AgentStatus {
  configured: boolean;
  secrets_file: string;
  settings: AgentSettings;
  api_key_env?: string;
}

export interface AgentTestResult {
  ok: boolean;
  model: string;
}

export interface AgentModel {
  id: string;
  name: string;
  context_length: number | null;
  prompt_price_per_million: number | null;
  completion_price_per_million: number | null;
  supports_reasoning: boolean;
}

export const AGENT_EFFORTS: { id: AgentEffort; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

export const DEFAULT_AGENT_API_KEY_ENV = "OPENROUTER_API_KEY";

export const AGENT_CUSTOM_INSTRUCTIONS_LIMIT = 4000;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  custom_instructions: "",
};

export const agentSettingsApi = {
  getStatus: () => api.get<AgentStatus>("/api/v1/agent/status"),
  testConnection: () => api.post<AgentTestResult>("/api/v1/agent/test"),
  listModels: () => api.get<{ models: AgentModel[] }>("/api/v1/agent/models"),
  getSettings: () => api.get<AgentSettings>("/api/v1/agent/settings"),
  saveSettings: (settings: Partial<AgentSettings>) =>
    api.patch<AgentSettings>("/api/v1/agent/settings", settings),
};
