"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/lib/context/ToastContext";
import { AGENT_EFFORTS, agentSettingsApi, type AgentEffort, type AgentModel } from "@/lib/api/agentSettings";
import { useAgentChatStore } from "@/lib/stores/agentChatStore";
import { useAgentModels } from "./agentQueries";

export function shortModelName(id: string, models?: AgentModel[]): string {
  const found = models?.find((m) => m.id === id);
  if (found?.name) {
    const idx = found.name.indexOf(": ");
    return idx >= 0 ? found.name.slice(idx + 2) : found.name;
  }
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

function formatPrice(n: number): string {
  if (n === 0) return "0";
  if (n < 0.1) return n.toFixed(3).replace(/0+$/, "");
  if (n < 10) return n.toFixed(2).replace(/\.?0+$/, "");
  return n.toFixed(0);
}

export function formatModelPrice(model: AgentModel): string | null {
  if (model.prompt_price_per_million == null || model.completion_price_per_million == null) return null;
  return `$${formatPrice(model.prompt_price_per_million)} / $${formatPrice(model.completion_price_per_million)} per 1M tokens`;
}

export function AgentModelPicker() {
  const toast = useToast();
  const model = useAgentChatStore((s) => s.model);
  const effort = useAgentChatStore((s) => s.effort);
  const setModel = useAgentChatStore((s) => s.setModel);
  const setEffort = useAgentChatStore((s) => s.setEffort);
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { data: models, isLoading, error } = useAgentModels(requested);

  const close = useCallback(() => {
    setOpen(false);
    setSearch("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  const handleSelectModel = (id: string) => {
    const previous = model;
    setModel(id);
    close();
    if (id === previous) return;
    agentSettingsApi.saveSettings({ model: id }).catch((err) => {
      if (useAgentChatStore.getState().model === id) setModel(previous);
      toast.error("Could not save the agent model", err instanceof Error ? err.message : undefined);
    });
  };

  const handleSelectEffort = (value: AgentEffort) => {
    const previous = effort;
    if (value === previous) return;
    setEffort(value);
    agentSettingsApi.saveSettings({ effort: value }).catch((err) => {
      if (useAgentChatStore.getState().effort === value) setEffort(previous);
      toast.error("Could not save the reasoning effort", err instanceof Error ? err.message : undefined);
    });
  };

  const label = model ? shortModelName(model, models) : "Model";

  return (
    <div ref={containerRef} className="relative min-w-0">
      <Tooltip content="Model used by the agent" side="bottom">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setRequested(true);
            setOpen((v) => !v);
          }}
          aria-label={`Agent model: ${label}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex max-w-[14rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <span className="truncate">{label}</span>
          {effort && <span className="shrink-0 text-slate-400 dark:text-slate-500">· {effort}</span>}
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
          <Command
            filter={(value, query) => {
              const m = models?.find((x) => x.id === value);
              const q = query.toLowerCase();
              if (value.toLowerCase().includes(q)) return 1;
              if (m?.name.toLowerCase().includes(q)) return 1;
              return 0;
            }}
          >
            <div className="border-b border-slate-200 px-2 py-1.5 dark:border-slate-600">
              <Command.Input
                autoFocus
                value={search}
                onValueChange={setSearch}
                placeholder="Search models…"
                aria-label="Search models"
                className="w-full bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden dark:text-white dark:placeholder:text-slate-500"
              />
            </div>
            <Command.List className="max-h-72 overflow-y-auto py-1">
              {isLoading ? (
                <Command.Loading>
                  <div className="flex items-center justify-center gap-2 py-3 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading models…
                  </div>
                </Command.Loading>
              ) : error ? (
                <div className="py-3 text-center text-xs text-red-600 dark:text-red-400">Could not load models</div>
              ) : (
                <Command.Empty className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
                  No matching models
                </Command.Empty>
              )}
              {models?.map((m) => {
                const price = formatModelPrice(m);
                return (
                  <Command.Item
                    key={m.id}
                    value={m.id}
                    onSelect={() => handleSelectModel(m.id)}
                    className="flex cursor-pointer flex-col items-start gap-0.5 px-2 py-1.5 text-xs aria-selected:bg-slate-100 dark:aria-selected:bg-slate-700"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="truncate font-medium text-slate-800 dark:text-slate-100">{m.name}</span>
                      {m.id === model && (
                        <span className="ml-auto text-primary-500" aria-label="Selected">
                          &#10003;
                        </span>
                      )}
                    </span>
                    <span className="w-full truncate font-mono text-[10px] text-slate-400 dark:text-slate-500">{m.id}</span>
                    {price && <span className="text-[10px] text-slate-500 dark:text-slate-400">{price}</span>}
                  </Command.Item>
                );
              })}
            </Command.List>
          </Command>
          <div
            role="radiogroup"
            aria-label="Reasoning effort"
            className="flex items-center gap-1 border-t border-slate-200 px-2 py-1.5 dark:border-slate-600"
          >
            <span className="mr-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Effort
            </span>
            {AGENT_EFFORTS.map((e) => (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={effort === e.id}
                onClick={() => handleSelectEffort(e.id)}
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500",
                  effort === e.id
                    ? "bg-primary-100 font-medium text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
                    : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700",
                )}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
