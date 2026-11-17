"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ResizablePanelDivider } from "@/components/editor/ResizablePanelDivider";
import { useWorkspaceStore, type RightSidebarTab } from "@/lib/stores/workspaceStore";

export type { RightSidebarTab };
export type LintSeverity = "error" | "warning" | "info";

export interface LintCounts {
  total_issues: number;
  error_count: number;
  warning_count: number;
}

export function lintSeverity(summary: LintCounts | null | undefined): LintSeverity | null {
  if (!summary || summary.total_issues <= 0) return null;
  if (summary.error_count > 0) return "error";
  if (summary.warning_count > 0) return "warning";
  return "info";
}

export const LINT_BADGE_CLASSES: Record<LintSeverity, string> = {
  error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export const LINT_DOT_CLASSES: Record<LintSeverity, string> = {
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
};

export const RIGHT_SIDEBAR_WIDTH_KEY = "ontokit:rightSidebarWidth";
export const RIGHT_SIDEBAR_DEFAULT_WIDTH = 400;
export const RIGHT_SIDEBAR_MIN_WIDTH = 320;

/**
 * Below Tailwind's `lg` breakpoint (1024px) the panel floats over the editor instead of
 * squeezing it: at its 400px default width a side-by-side panel would leave the detail
 * panel under ~600px there. From `lg` up it sits beside the editor as before.
 */
export const RIGHT_SIDEBAR_LAYOUT_CLASSES =
  "absolute inset-y-0 right-0 z-30 max-w-[calc(100%-2rem)] shadow-xl lg:static lg:z-auto lg:max-w-none lg:shadow-none";

function maxSidebarWidth(): number {
  if (typeof window === "undefined") return 800;
  return Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.floor(window.innerWidth * 0.5));
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(RIGHT_SIDEBAR_WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) return Math.min(maxSidebarWidth(), Math.max(RIGHT_SIDEBAR_MIN_WIDTH, n));
  } catch {
    return RIGHT_SIDEBAR_DEFAULT_WIDTH;
  }
  return RIGHT_SIDEBAR_DEFAULT_WIDTH;
}

interface RightSidebarProps {
  onClose: () => void;
  lintSummary?: LintCounts | null;
  agent: ReactNode;
  health: (isActive: boolean) => ReactNode;
  files?: (isActive: boolean) => ReactNode;
}

const TABS: { id: RightSidebarTab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "health", label: "Health" },
  { id: "files", label: "Files" },
];

export function RightSidebar({ onClose, lintSummary, agent, health, files }: RightSidebarProps) {
  const activeTab = useWorkspaceStore((s) => s.rightTab);
  const setActiveTab = useWorkspaceStore((s) => s.setRightTab);
  const tabs = files ? TABS : TABS.filter((t) => t.id !== "files");
  // Opens on the Agent tab each time, unless an action (Run as prompt, Files) asked for a tab.
  const resetRightTabOnOpen = useWorkspaceStore((s) => s.resetRightTabOnOpen);
  useEffect(() => resetRightTabOnOpen(), [resetRightTabOnOpen]);
  // A request that arrives while the panel is already open has been honoured; forget it.
  const rightTabRequested = useWorkspaceStore((s) => s.rightTabRequested);
  useEffect(() => {
    if (rightTabRequested) useWorkspaceStore.setState({ rightTabRequested: false });
  }, [rightTabRequested]);
  const [width, setWidth] = useState(readStoredWidth);
  const severity = lintSeverity(lintSummary);

  const handleWidthChange = useCallback((w: number) => {
    setWidth(w);
    try {
      localStorage.setItem(RIGHT_SIDEBAR_WIDTH_KEY, String(Math.round(w)));
    } catch {
      return;
    }
  }, []);

  return (
    <>
      {/* Overlay mode only: dims the editor and closes the panel on a click outside it. */}
      <div
        data-testid="right-sidebar-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 z-20 bg-slate-900/20 lg:hidden"
      />
      <div className="hidden lg:contents">
        <ResizablePanelDivider
          width={width}
          onWidthChange={handleWidthChange}
          minWidth={RIGHT_SIDEBAR_MIN_WIDTH}
          maxWidth={maxSidebarWidth()}
          invert
        />
      </div>
      <aside
        data-agent-exclude
        aria-label="Agent and health panel"
        style={{ width }}
        className={cn(
          "flex h-full min-w-0 flex-shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
          RIGHT_SIDEBAR_LAYOUT_CLASSES,
        )}
      >
        <div className="flex items-stretch border-b border-slate-200 dark:border-slate-700">
          <div role="tablist" aria-label="Right panel" className="flex flex-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`right-sidebar-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`right-sidebar-panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
                  activeTab === tab.id
                    ? "border-b-2 border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300",
                )}
              >
                {tab.label}
                {tab.id === "health" && severity && lintSummary && (
                  <span
                    data-testid="health-tab-badge"
                    className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none", LINT_BADGE_CLASSES[severity])}
                  >
                    {lintSummary.total_issues}
                  </span>
                )}
              </button>
            ))}
          </div>
          <Tooltip content="Close panel" side="bottom">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close panel"
              className="my-auto mr-1 h-7 w-7 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
        <div
          role="tabpanel"
          id="right-sidebar-panel-agent"
          aria-labelledby="right-sidebar-tab-agent"
          hidden={activeTab !== "agent"}
          className={cn("min-h-0 flex-1 flex-col", activeTab === "agent" ? "flex" : "hidden")}
        >
          {agent}
        </div>
        <div
          role="tabpanel"
          id="right-sidebar-panel-health"
          aria-labelledby="right-sidebar-tab-health"
          hidden={activeTab !== "health"}
          className={cn("min-h-0 flex-1 flex-col", activeTab === "health" ? "flex" : "hidden")}
        >
          {health(activeTab === "health")}
        </div>
        {files && (
          <div
            role="tabpanel"
            id="right-sidebar-panel-files"
            aria-labelledby="right-sidebar-tab-files"
            hidden={activeTab !== "files"}
            className={cn("min-h-0 flex-1 flex-col", activeTab === "files" ? "flex" : "hidden")}
          >
            {files(activeTab === "files")}
          </div>
        )}
      </aside>
    </>
  );
}
