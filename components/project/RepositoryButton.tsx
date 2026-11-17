"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, GitBranch, GitPullRequest, History } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { BranchSwitcher, useBranchChangeNotifier, useBranchStatus } from "@/components/revision/BranchSelector";
import { GitHubAheadBehind, GitHubMark, GitHubPanel, githubTooltip } from "@/components/project/GitHub";
import { useBranch } from "@/lib/context/BranchContext";
import { useGitHub } from "@/lib/hooks/useGitHub";
import { cn } from "@/lib/utils";

interface RepositoryButtonProps {
  projectId: string;
  /** Called whenever the current branch changes (including the initial branch). */
  onBranchChange?: (branchName: string) => void;
  /** Called after a GitHub pull moved the checked-out branch, so the editor can reload its source. */
  onPulled?: () => void;
  /** Whether the revision history panel is open. */
  historyOpen: boolean;
  onToggleHistory: () => void;
  /** Open pull requests between this project's local branches. */
  openPRCount?: number;
  className?: string;
}

function Section({ title, icon, children, className }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("border-t border-slate-200 first:border-t-0 dark:border-slate-700", className)}>
      <h3 className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Sub-heading (right): one popover for everything versioning — the branch (switch, create, delete),
 * revision history, pull requests between local branches, and syncing with the GitHub remote (fetch, pull, push). Linking a remote is in project settings.
 */
export function RepositoryButton({
  projectId,
  onBranchChange,
  onPulled,
  historyOpen,
  onToggleHistory,
  openPRCount = 0,
  className,
}: RepositoryButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { currentBranch, isLoading, isFeatureBranch } = useBranch();
  const { currentBranchInfo, status } = useBranchStatus();
  const { query } = useGitHub(projectId);
  const remote = query.data;
  // Stays mounted while the popover is closed so the editor always learns the active branch.
  useBranchChangeNotifier(onBranchChange);

  const tooltip = isLoading
    ? "Repository: loading branches…"
    : `Repository: on branch ${currentBranch}${status ? ` ${status}` : ""}. ${githubTooltip(remote).replace(/\.$/, "")}. ${openPRCount > 0 ? `${openPRCount} open pull request${openPRCount === 1 ? "" : "s"}. ` : ""}Click to switch branches, view history and pull requests, or push and pull.`;

  return (
    <div
      className={cn("relative", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && isOpen) {
          e.stopPropagation();
          setIsOpen(false);
        }
      }}
    >
      <Tooltip side="bottom" disabled={isOpen} content={tooltip}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Repository"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          data-testid="repository-button"
          className={cn(
            "inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md border px-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700",
            isFeatureBranch
              ? "border-amber-500 text-amber-600 dark:text-amber-400"
              : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200",
            historyOpen && "bg-slate-100 dark:bg-slate-700",
          )}
        >
          <GitBranch className="h-4 w-4 flex-shrink-0" />
          <span className="hidden max-w-32 truncate sm:inline" data-testid="repository-branch">
            {currentBranch}
          </span>
          {currentBranchInfo && currentBranchInfo.commits_ahead > 0 && (
            <span className="hidden rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 sm:inline dark:bg-amber-900/30 dark:text-amber-400">
              +{currentBranchInfo.commits_ahead}
            </span>
          )}
          {remote?.remote_url && (
            <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <GitHubMark className="h-3.5 w-3.5" />
              <GitHubAheadBehind remote={remote} />
            </span>
          )}
          <ChevronDown className="h-4 w-4 flex-shrink-0" />
        </button>
      </Tooltip>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            role="dialog"
            aria-label="Repository"
            data-testid="repository-popover"
            className="absolute right-0 top-full z-50 mt-1 max-h-[80vh] w-[26rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-slate-200 bg-white text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <Section title="Branch" icon={<GitBranch className="h-3.5 w-3.5" />}>
              <div className="border-t border-slate-200 dark:border-slate-700">
                <BranchSwitcher onBranchChange={onBranchChange} onDone={() => setIsOpen(false)} />
              </div>
            </Section>

            <Section title="History" icon={<History className="h-3.5 w-3.5" />}>
              <button
                type="button"
                aria-pressed={historyOpen}
                onClick={() => {
                  onToggleHistory();
                  setIsOpen(false);
                }}
                className="mb-1 flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <History className="h-4 w-4 flex-shrink-0" />
                {historyOpen ? "Hide revision history" : "Revision history"}
                {historyOpen && <span aria-hidden className="ml-auto text-xs text-slate-400 dark:text-slate-500">Esc</span>}
              </button>
            </Section>

            <Section title="Pull requests" icon={<GitPullRequest className="h-3.5 w-3.5" />}>
              <Link
                href={`/projects/${projectId}/pull-requests`}
                onClick={() => setIsOpen(false)}
                className="mb-1 flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <GitPullRequest className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">
                  Pull requests
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Review and merge changes between local branches (not GitHub)
                  </span>
                </span>
                {openPRCount > 0 && (
                  <span
                    data-testid="repository-open-prs"
                    className="rounded-full bg-primary-100 px-1.5 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-400"
                  >
                    {openPRCount}
                  </span>
                )}
              </Link>
            </Section>

            <Section title="GitHub" icon={<GitHubMark className="h-3.5 w-3.5" />}>
              <div className="px-3 pb-3">
                <GitHubPanel projectId={projectId} onPulled={onPulled} mode="sync" />
              </div>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
