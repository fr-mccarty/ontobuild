"use client";

import type { ReactNode } from "react";
import { Code2, Lock, Network } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAgentPermissionsStore } from "@/lib/stores/agentPermissionsStore";

interface PillToggleProps {
  label: string;
  icon: ReactNode;
  pressed: boolean;
  onToggle: () => void;
  tooltip: string;
}

function PillToggle({ label, icon, pressed, onToggle, tooltip }: PillToggleProps) {
  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        aria-pressed={pressed}
        onClick={onToggle}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500",
          pressed
            ? "border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50"
            : "border-slate-200 bg-transparent text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800",
        )}
      >
        {icon}
        {label}
      </button>
    </Tooltip>
  );
}

/** The Edit Ontology / Edit Code toggles. The server enforces them; they are sent with every chat request. */
export function AgentPermissionToggles() {
  const editOntology = useAgentPermissionsStore((s) => s.edit_ontology);
  const editCode = useAgentPermissionsStore((s) => s.edit_code);
  const setEditOntology = useAgentPermissionsStore((s) => s.setEditOntology);
  const setEditCode = useAgentPermissionsStore((s) => s.setEditCode);

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="What the agent may change">
      <PillToggle
        label="Edit Ontology"
        icon={<Network className="h-3 w-3" />}
        pressed={editOntology}
        onToggle={() => setEditOntology(!editOntology)}
        tooltip={
          editOntology
            ? "The agent may change the ontology, branches and pull requests. Click to turn off."
            : "The agent can read the ontology but not change it. Click to allow edits."
        }
      />
      <PillToggle
        label="Edit Code"
        icon={<Code2 className="h-3 w-3" />}
        pressed={editCode}
        onToggle={() => setEditCode(!editCode)}
        tooltip={
          editCode
            ? "The agent may write and delete files in the project folder and run commands. Click to turn off."
            : "The agent can read the project's files but not change them or run commands. Click to allow."
        }
      />
      {!editOntology && !editCode && (
        <span
          data-testid="agent-read-only-note"
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"
        >
          <Lock className="h-3 w-3" />
          Read-only: the agent can&apos;t change anything
        </span>
      )}
    </div>
  );
}
