"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

const TONES = {
  error: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/10 dark:text-amber-300",
  info: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
} as const;

export type AgentNoticeTone = keyof typeof TONES;

interface AgentNoticeProps {
  tone: AgentNoticeTone;
  icon: ReactNode;
  children: ReactNode;
  /** Buttons before the X, such as "Fix issues" or "Retry". */
  actions?: ReactNode;
  /** Every notice can be closed; what closing means (until when) is the caller's. */
  onDismiss: () => void;
  /** Explains what closing does, e.g. "Hide this until the issues change". */
  dismissTooltip?: string;
  role?: "alert" | "status";
  testId?: string;
}

/**
 * A banner above the agent's message box: an error, a warning or a note. Every banner there goes
 * through this so each one has the same look and an X to close it.
 */
export function AgentNotice({ tone, icon, children, actions, onDismiss, dismissTooltip = "Close", role, testId }: AgentNoticeProps) {
  return (
    <div
      role={role}
      data-testid={testId}
      className={cn("mx-3 mb-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs", TONES[tone])}
    >
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {actions}
      <Tooltip content={dismissTooltip}>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

/** Classes for a text button in a notice's actions. */
export const AGENT_NOTICE_ACTION_CLASSES =
  "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10";
