"use client";

import { Activity, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";
import { healthIssueParts, totalHealthIssues, type AgentHealthSummary } from "@/lib/agent/healthSummary";

interface AgentHealthStripProps {
  health: AgentHealthSummary | null | undefined;
  /** Puts the fix request in the composer; the user sends it. */
  onFix: () => void;
  disabled?: boolean;
}

/** The Health tab's counts, shown in the Agent tab so the user can ask the agent to fix them in place. */
export function AgentHealthStrip({ health, onFix, disabled }: AgentHealthStripProps) {
  const setRightTab = useWorkspaceStore((s) => s.setRightTab);
  if (!health || totalHealthIssues(health) === 0) return null;
  const hasErrors = (health.lint?.errors ?? 0) > 0 || (health.consistency?.count ?? 0) > 0;
  return (
    <div
      data-testid="agent-health-strip"
      className={cn(
        "mx-3 mb-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
        hasErrors
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-300"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/10 dark:text-amber-300",
      )}
    >
      <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <Tooltip content="Open the Health tab">
        <button
          type="button"
          onClick={() => setRightTab("health")}
          className="min-w-0 flex-1 truncate text-left hover:underline"
        >
          {healthIssueParts(health).join(" · ")}
        </button>
      </Tooltip>
      <button
        type="button"
        onClick={onFix}
        disabled={disabled}
        className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
      >
        <Wand2 className="h-3 w-3" aria-hidden="true" />
        Fix issues
      </button>
    </div>
  );
}
