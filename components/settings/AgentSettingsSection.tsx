"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, AlertCircle, Brain, Copy, ExternalLink, Loader2, Plug, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/lib/context/ToastContext";
import { cn } from "@/lib/utils";
import {
  AGENT_CUSTOM_INSTRUCTIONS_LIMIT,
  AGENT_EFFORTS,
  DEFAULT_AGENT_API_KEY_ENV,
  DEFAULT_AGENT_SETTINGS,
  agentSettingsApi,
  type AgentEffort,
  type AgentSettings,
  type AgentStatus,
} from "@/lib/api/agentSettings";
import { SettingsField, SettingsSection } from "./SettingsSection";
import { SegmentedChoice } from "./SegmentedChoice";
import { apiErrorMessage } from "@/lib/api/errors";

export const AGENT_INSTRUCTIONS_DEBOUNCE_MS = 800;
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";

const KEY_PLACEHOLDERS: Record<string, string> = {
  OPENROUTER_API_KEY: "sk-or-...",
};

type SaveState = "idle" | "saving" | "saved" | "error";

type TestResult =
  | { kind: "success" }
  | { kind: "error"; message: string };

interface AgentSettingsSectionProps {
  highlighted?: boolean;
}

export function AgentSettingsSection({ highlighted = false }: AgentSettingsSectionProps) {
  const toast = useToast();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const editedRef = useRef<Set<keyof AgentSettings>>(new Set());
  const settingsRef = useRef<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Partial<AgentSettings>>({});
  const saveSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    agentSettingsApi
      .getStatus()
      .then((result) => {
        if (cancelled) return;
        setStatus(result);
        const loaded: AgentSettings = { ...DEFAULT_AGENT_SETTINGS, ...result.settings };
        for (const key of editedRef.current) {
          Object.assign(loaded, { [key]: settingsRef.current[key] });
        }
        settingsRef.current = loaded;
        setSettings(loaded);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatusError(err instanceof Error ? err.message : "Could not load agent status");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    async (next: Partial<AgentSettings>) => {
      const seq = ++saveSeqRef.current;
      setSaveState("saving");
      try {
        await agentSettingsApi.saveSettings(next);
        if (seq === saveSeqRef.current) setSaveState("saved");
      } catch (err) {
        if (seq === saveSeqRef.current) setSaveState("error");
        toast.error("Couldn't save the agent settings", apiErrorMessage(err));
      }
    },
    [toast],
  );

  const flushPending = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        void agentSettingsApi.saveSettings(pendingRef.current).catch(() => undefined);
      }
    };
  }, []);

  const update = useCallback(
    (patch: Partial<AgentSettings>, debounce = false) => {
      for (const key of Object.keys(patch) as (keyof AgentSettings)[]) {
        editedRef.current.add(key);
      }
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      if (flushPending()) {
        const pending = pendingRef.current;
        pendingRef.current = {};
        if (!debounce) void persist(pending);
      }
      if (debounce) {
        pendingRef.current = patch;
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          const pending = pendingRef.current;
          pendingRef.current = {};
          void persist(pending);
        }, AGENT_INSTRUCTIONS_DEBOUNCE_MS);
      } else {
        void persist(patch);
      }
    },
    [flushPending, persist],
  );

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await agentSettingsApi.testConnection();
      setTestResult({ kind: "success" });
      setStatus((prev) => (prev ? { ...prev, configured: true } : prev));
    } catch (err) {
      setTestResult({
        kind: "error",
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleCopyPath = async () => {
    if (!status?.secrets_file) return;
    try {
      await navigator.clipboard.writeText(status.secrets_file);
      toast.success("Copied the secrets file path");
    } catch {
      toast.error("Couldn't copy the secrets file path");
    }
  };

  const instructionsLength = settings.custom_instructions.length;
  const keyEnv = status?.api_key_env || DEFAULT_AGENT_API_KEY_ENV;
  const keyExample = `${keyEnv}=${KEY_PLACEHOLDERS[keyEnv] ?? "..."}`;

  return (
    <SettingsSection
      id="agent"
      title="Agent"
      description="Configure the AI agent that can read and edit ontologies from the editor chat panel."
      highlighted={highlighted}
      actions={<SaveIndicator state={saveState} />}
    >
      <SettingsField labelId="agent-api-key-label" label="API Key">
        <div
          aria-labelledby="agent-api-key-label"
          role="group"
          className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2" data-testid="agent-key-status">
              {!status && !statusError && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Checking…
                  </span>
                </>
              )}
              {status?.configured && (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Configured
                  </span>
                </>
              )}
              {status && !status.configured && (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Not configured
                  </span>
                </>
              )}
              {!status && statusError && (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Status unavailable
                  </span>
                </>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Plug className="mr-1 h-4 w-4" />
              )}
              {testing ? "Testing…" : "Test connection"}
            </Button>
          </div>

          {statusError && !status && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{statusError}</p>
          )}

          {status?.secrets_file && (
            <div className="mt-3 flex items-center gap-1">
              <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                {status.secrets_file}
              </code>
              <Tooltip content="Copy path">
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  onClick={handleCopyPath}
                  aria-label="Copy secrets file path"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>
          )}

          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            The key is never entered or shown here. Add{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {keyExample}
            </code>{" "}
            to {status?.secrets_file ? "that file" : "the secrets file"}, then retry. Next.js reloads env files in dev.{" "}
            <a
              href={OPENROUTER_KEYS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-primary-600 hover:underline dark:text-primary-400"
            >
              Create an OpenRouter key
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </p>

          {testResult && (
            <div
              role="status"
              className={cn(
                "mt-3 flex items-start gap-2 text-sm",
                testResult.kind === "success"
                  ? "text-green-700 dark:text-green-400"
                  : "text-red-600 dark:text-red-400",
              )}
            >
              {testResult.kind === "success" ? (
                <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              )}
              <span>
                {testResult.kind === "success"
                  ? "Connected to OpenRouter"
                  : testResult.message}
              </span>
            </div>
          )}
        </div>
      </SettingsField>

      <SettingsField
        id="agent-model"
        labelId="agent-model-label"
        label="Model"
        hint="Change the model from the Agent panel in the project editor's right sidebar."
        className="mt-6"
      >
        <div
          role="group"
          aria-labelledby="agent-model-label"
          className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-600"
        >
          <Sparkles className="h-5 w-5 flex-shrink-0 text-slate-400" />
          <code data-testid="agent-current-model" className="font-mono text-sm text-slate-900 dark:text-white">
            {settings.model}
          </code>
        </div>
      </SettingsField>

      <SettingsField
        id="agent-effort"
        labelId="agent-effort-label"
        label="Effort"
        hint="Higher effort is more thorough but slower and costs more."
        className="mt-6"
      >
        <SegmentedChoice<AgentEffort>
          labelledBy="agent-effort-label"
          options={AGENT_EFFORTS.map((e) => ({ value: e.id, label: e.label, icon: Brain }))}
          value={settings.effort}
          onChange={(effort) => {
            if (effort !== settings.effort) update({ effort });
          }}
        />
      </SettingsField>

      <SettingsField
        id="agent-instructions"
        labelId="agent-instructions-label"
        label="Custom Instructions"
        className="mt-6"
      >
        <textarea
          aria-labelledby="agent-instructions-label"
          aria-describedby="agent-instructions-hint"
          value={settings.custom_instructions}
          maxLength={AGENT_CUSTOM_INSTRUCTIONS_LIMIT}
          rows={5}
          placeholder="For example: prefer British English labels, and always add an rdfs:comment to new classes."
          onChange={(e) =>
            update(
              { custom_instructions: e.target.value.slice(0, AGENT_CUSTOM_INSTRUCTIONS_LIMIT) },
              true,
            )
          }
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-hidden focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500"
        />
        <div id="agent-instructions-hint" className="mt-1 flex justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>Appended to the agent&apos;s system prompt.</span>
          <span
            data-testid="agent-instructions-count"
            className={cn(instructionsLength >= AGENT_CUSTOM_INSTRUCTIONS_LIMIT && "text-amber-600 dark:text-amber-400")}
          >
            {instructionsLength.toLocaleString()} / {AGENT_CUSTOM_INSTRUCTIONS_LIMIT.toLocaleString()}
          </span>
        </div>
      </SettingsField>
    </SettingsSection>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span aria-live="polite" className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
      {state === "saving" && "Saving…"}
      {state === "saved" && "Saved"}
      {state === "error" && <span className="text-red-600 dark:text-red-400">Not saved</span>}
    </span>
  );
}
