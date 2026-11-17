"use client";

import type { ReactNode } from "react";
import { useWorkspaceStore, type ToolId } from "@/lib/stores/workspaceStore";
import { Tooltip } from "@/components/ui/tooltip";
import { ComponentTreePanel } from "./component-tree/ComponentTreePanel";
import { OrphansPanel } from "./orphans/OrphansPanel";

interface ToolDefinition {
  id: ToolId;
  label: string;
  description: string;
  render: (props: { projectId: string; isActive: boolean }) => ReactNode;
}

/** Meta tools shown in the right sidebar's Tools tab. Add new tools here (and to ToolId). */
export const TOOLS: ToolDefinition[] = [
  {
    id: "component-tree",
    label: "Component tree",
    description: "Which React components in code/ render which",
    render: (props) => <ComponentTreePanel {...props} />,
  },
  {
    id: "orphans",
    label: "Orphans",
    description: "Files, components, classes, functions, variables, types, tests and scripts in code/ that nothing uses",
    render: (props) => <OrphansPanel {...props} />,
  },
];

export function ToolsPanel({ projectId, isActive }: { projectId: string; isActive: boolean }) {
  const activeTool = useWorkspaceStore((s) => s.activeTool);
  const setActiveTool = useWorkspaceStore((s) => s.setActiveTool);
  const tool = TOOLS.find((t) => t.id === activeTool) ?? TOOLS[0];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-white dark:bg-slate-900" data-testid="tools-panel">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 dark:border-slate-700">
        <label htmlFor="tools-panel-picker" className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Tool
        </label>
        <Tooltip side="bottom" content={tool.description}>
          <select
            id="tools-panel-picker"
            value={tool.id}
            onChange={(e) => setActiveTool(e.target.value as ToolId)}
            className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            {TOOLS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Tooltip>
      </div>
      {tool.render({ projectId, isActive })}
    </div>
  );
}
