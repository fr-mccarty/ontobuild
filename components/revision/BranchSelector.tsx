"use client";

import { useEffect, useRef, useState } from "react";
import { useBranch } from "@/lib/context/BranchContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  GitBranch,
  ChevronDown,
  Plus,
  Check,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

interface BranchSelectorProps {
  className?: string;
  onBranchChange?: (branchName: string) => void;
}

/** Calls `onBranchChange` whenever the current branch changes (including the initial branch). */
export function useBranchChangeNotifier(onBranchChange?: (branchName: string) => void) {
  const { currentBranch } = useBranch();
  const lastNotified = useRef<string | null>(null);
  useEffect(() => {
    if (currentBranch && currentBranch !== lastNotified.current) {
      lastNotified.current = currentBranch;
      onBranchChange?.(currentBranch);
    }
  }, [currentBranch, onBranchChange]);
}

/** A one-line description of the current branch (commit and ahead/behind the default branch). */
export function useBranchStatus() {
  const { branches, currentBranch, defaultBranch } = useBranch();
  const currentBranchInfo = branches.find((b) => b.name === currentBranch);
  const plural = (n: number) => (n === 1 ? "commit" : "commits");
  const status = [
    currentBranchInfo?.commit_hash && `at commit ${currentBranchInfo.commit_hash.slice(0, 7)}`,
    currentBranchInfo && currentBranchInfo.commits_ahead > 0 &&
      `${currentBranchInfo.commits_ahead} ${plural(currentBranchInfo.commits_ahead)} ahead of ${defaultBranch}`,
    currentBranchInfo && currentBranchInfo.commits_behind > 0 &&
      `${currentBranchInfo.commits_behind} ${plural(currentBranchInfo.commits_behind)} behind ${defaultBranch}`,
  ].filter(Boolean).join(", ");
  return { currentBranchInfo, status };
}

export function BranchSelector({
  className,
  onBranchChange,
}: BranchSelectorProps) {
  const { currentBranch, isLoading, isFeatureBranch } = useBranch();
  const [isOpen, setIsOpen] = useState(false);
  useBranchChangeNotifier(onBranchChange);
  const { currentBranchInfo, status: branchStatus } = useBranchStatus();

  const branchTooltip = isLoading
    ? "Branch: loading branches…"
    : `Branch: ${currentBranch}${branchStatus ? ` ${branchStatus}` : ""}. Click to switch branches or create a new one.`;

  return (
    <div className={cn("relative", className)}>
      {/* The span receives hover even while the button is disabled (loading), so the tooltip still shows. */}
      <Tooltip side="bottom" disabled={isOpen} content={branchTooltip}>
        <span className="inline-flex">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "gap-2",
              isFeatureBranch && "border-amber-500 text-amber-600 dark:text-amber-400"
            )}
            onClick={() => setIsOpen(!isOpen)}
            disabled={isLoading}
            aria-expanded={isOpen}
          >
            <GitBranch className="h-4 w-4" />
            <span className="max-w-32 truncate">{currentBranch}</span>
            {currentBranchInfo?.commit_hash && (
              <code className="rounded-sm bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                {currentBranchInfo.commit_hash.slice(0, 7)}
              </code>
            )}
            {currentBranchInfo && currentBranchInfo.commits_ahead > 0 && (
              <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                +{currentBranchInfo.commits_ahead}
              </span>
            )}
            <ChevronDown className="h-4 w-4" />
          </Button>
        </span>
      </Tooltip>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
            <BranchSwitcher onBranchChange={onBranchChange} onDone={() => setIsOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}

interface BranchSwitcherProps {
  onBranchChange?: (branchName: string) => void;
  /** Called after switching to or creating a branch (e.g. to close the surrounding popover). */
  onDone?: () => void;
}

/** The branch list with switch, create and delete; rendered inside a popover. */
export function BranchSwitcher({ onBranchChange, onDone }: BranchSwitcherProps) {
  const { branches, currentBranch, switchBranch, createBranch, deleteBranch } = useBranch();
  const [isCreating, setIsCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSwitchBranch = async (name: string) => {
    if (name === currentBranch) {
      onDone?.();
      return;
    }

    setError(null);
    try {
      await switchBranch(name);
      onBranchChange?.(name);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch branch");
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;

    setError(null);
    try {
      const branch = await createBranch(newBranchName.trim());
      onBranchChange?.(branch.name);
      setNewBranchName("");
      setIsCreating(false);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch");
    }
  };

  const handleDeleteBranch = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm(`Are you sure you want to delete branch "${name}"?`)) {
      return;
    }

    setError(null);
    try {
      await deleteBranch(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete branch");
    }
  };

  return (
    <>
      {error && (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-slate-700 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isCreating ? (
        <div className="border-b border-slate-200 p-3 dark:border-slate-700">
          <input
            type="text"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateBranch();
              if (e.key === "Escape") {
                setIsCreating(false);
                setNewBranchName("");
              }
            }}
            placeholder="feature/my-changes"
            className="w-full rounded-sm border border-slate-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-hidden dark:border-slate-600 dark:bg-slate-700"
            autoFocus
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={handleCreateBranch}>
              Create
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsCreating(false);
                setNewBranchName("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          className="flex w-full items-center gap-2 border-b border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700"
          onClick={() => setIsCreating(true)}
        >
          <Plus className="h-4 w-4" />
          Create new branch
        </button>
      )}

      <div className="max-h-64 overflow-y-auto py-1">
        {branches.map((branch) => (
          <div
            key={branch.name}
            className={cn(
              "flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700",
              branch.name === currentBranch && "bg-slate-100 dark:bg-slate-700"
            )}
            onClick={() => handleSwitchBranch(branch.name)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleSwitchBranch(branch.name);
              }
            }}
            role="option"
            aria-selected={branch.name === currentBranch}
            tabIndex={0}
          >
            <div className="flex items-center gap-2">
              {branch.name === currentBranch ? (
                <Check className="h-4 w-4 text-primary-600" />
              ) : (
                <div className="h-4 w-4" />
              )}
              <span className="truncate">{branch.name}</span>
              {branch.is_default && (
                <span className="rounded-sm bg-slate-200 px-1 py-0.5 text-xs text-slate-600 dark:bg-slate-600 dark:text-slate-300">
                  default
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {branch.commit_hash && (
                <code className="font-mono text-xs text-slate-400 dark:text-slate-500">
                  {branch.commit_hash.slice(0, 7)}
                </code>
              )}
              {branch.commits_ahead > 0 && (
                <span className="text-xs text-slate-500">
                  +{branch.commits_ahead}
                </span>
              )}
              {branch.commits_behind > 0 && (
                <span className="text-xs text-slate-500">
                  -{branch.commits_behind}
                </span>
              )}
              {!branch.is_default &&
                branch.name !== currentBranch &&
                branch.has_delete_permission && (
                  <Tooltip content={branch.has_open_pr ? "Cannot delete: branch has an open pull request" : "Delete branch"}>
                    <span className="inline-flex">
                      <button
                        className={cn(
                          "rounded-sm p-1",
                          branch.can_delete
                            ? "text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                            : "cursor-not-allowed text-slate-300 dark:text-slate-600"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (branch.can_delete)
                            handleDeleteBranch(branch.name, e);
                        }}
                        aria-label={branch.has_open_pr ? "Cannot delete: branch has an open pull request" : "Delete branch"}
                        disabled={!branch.can_delete}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  </Tooltip>
                )}
            </div>
          </div>
        ))}

        {branches.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-slate-500">
            No branches found
          </div>
        )}
      </div>
    </>
  );
}
