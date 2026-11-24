"use client";

import { useState } from "react";
import { Activity, Wand2 } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { AgentNotice, AGENT_NOTICE_ACTION_CLASSES } from "./AgentNotice";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";
import { healthIssueParts, totalHealthIssues, type AgentHealthSummary } from "@/lib/agent/healthSummary";

interface AgentHealthStripProps {
  health: AgentHealthSummary | null | undefined;
  /** Puts the fix request in the composer; the user sends it. */
  onFix: () => void;
  disabled?: boolean;
}

/**
 * The Health tab's counts, shown in the Agent tab so the user can ask the agent to fix them in place.
 * The X hides it until the issues change, so a new problem still shows.
 */
export function AgentHealthStrip({ health, onFix, disabled }: AgentHealthStripProps) {
  const setRightTab = useWorkspaceStore((s) => s.setRightTab);
  const [dismissedSummary, setDismissedSummary] = useState<string | null>(null);
  if (!health || totalHealthIssues(health) === 0) return null;
  const summary = healthIssueParts(health).join(" · ");
  if (summary === dismissedSummary) return null;
  const hasErrors = (health.lint?.errors ?? 0) > 0 || (health.consistency?.count ?? 0) > 0 || (health.rules?.errors ?? 0) > 0;
  return (
    <AgentNotice
      tone={hasErrors ? "error" : "warning"}
      icon={<Activity className="h-3.5 w-3.5" />}
      testId="agent-health-strip"
      onDismiss={() => setDismissedSummary(summary)}
      dismissTooltip="Hide this until the issues change"
      actions={
        <button type="button" onClick={onFix} disabled={disabled} className={AGENT_NOTICE_ACTION_CLASSES}>
          <Wand2 className="h-3 w-3" aria-hidden="true" />
          Fix issues
        </button>
      }
    >
      <Tooltip content="Open the Health tab">
        <button
          type="button"
          onClick={() => setRightTab("health")}
          className="block w-full truncate text-left hover:underline"
        >
          {summary}
        </button>
      </Tooltip>
    </AgentNotice>
  );
}
