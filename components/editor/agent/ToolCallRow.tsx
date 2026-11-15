"use client";

import { useState } from "react";
import { Check, ChevronRight, Loader2, XCircle } from "lucide-react";
import { cn, getLocalName } from "@/lib/utils";
import type { AgentToolStatus } from "@/lib/stores/agentChatStore";

export function friendlyToolName(name: string): string {
  if (!name) return "Tool";
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

export function toolInputHint(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  for (const key of ["label", "query", "name", "iri", "class_iri", "entity_iri", "parent_iri"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) {
      return key.endsWith("iri") ? getLocalName(v) || v : v;
    }
  }
  return null;
}

interface ToolCallRowProps {
  name: string;
  input: unknown;
  status: AgentToolStatus | "unknown";
  summary?: string;
}

export function ToolCallRow({ name, input, status, summary }: ToolCallRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hint = toolInputHint(input);
  const json = input === undefined ? null : JSON.stringify(input, null, 2);
  const title = friendlyToolName(name);
  const line = summary?.trim() || (hint ? `${title} · ${hint}` : title);

  return (
    <div className="text-xs" data-testid="agent-tool-row">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${title}: ${line}`}
        className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-px text-left text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      >
        <ChevronRight
          className={cn("h-3 w-3 shrink-0 transition-transform", expanded && "rotate-90")}
        />
        {status === "pending" ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-label="Running" />
        ) : status === "error" ? (
          <XCircle className="h-3 w-3 shrink-0" aria-label="Failed" />
        ) : status === "ok" ? (
          <Check className="h-3 w-3 shrink-0" aria-label="Done" />
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        <span className="min-w-0 truncate">{line}</span>
      </button>
      {expanded && (
        <div className="mt-0.5 mb-1 ml-5 rounded border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
          <div className="px-2 pt-1.5 font-medium">{title}</div>
          {summary && <div className="px-2 pt-0.5 whitespace-pre-wrap break-words">{summary}</div>}
          <pre className="max-h-64 overflow-auto px-2 py-1.5 font-mono text-[11px]">
            {json ?? "No input"}
          </pre>
        </div>
      )}
    </div>
  );
}
