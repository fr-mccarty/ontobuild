"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  XCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  X,
  ExternalLink,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldCheck,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  lintApi,
  isLintRunActive,
  waitForLintRun,
  type LintIssue,
  type LintIssueType,
  type LintSummary,
  type SubjectType,
} from "@/lib/api/lint";
import { qualityApi } from "@/lib/api/quality";
import type { ConsistencyCheckResult, ConsistencyIssue, DuplicateCluster, DuplicateDetectionResult } from "@/lib/ontology/qualityTypes";
import Link from "next/link";
import { cn, formatDateTime, getLocalName } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

interface HealthCheckPanelProps {
  projectId: string;
  branch?: string;
  isOpen: boolean;
  onClose: () => void;
  onNavigateToClass?: (iri: string, subjectType?: string) => void;
  canRunLint?: boolean;
  embedded?: boolean;
}

type HealthTab = "lint" | "consistency" | "duplicates";
type IssueFilter = "all" | "error" | "warning" | "info";

const issueIcons = {
  error: <XCircle className="h-4 w-4 text-red-500" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  info: <Info className="h-4 w-4 text-blue-500" />,
};

const issueColors = {
  error: "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10",
  warning: "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10",
  info: "border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-900/10",
};

export function HealthCheckPanel({
  projectId,
  branch,
  canRunLint = false,
  isOpen,
  onClose,
  onNavigateToClass,
  embedded = false,
}: HealthCheckPanelProps) {
  const [activeTab, setActiveTab] = useState<HealthTab>("lint");
  const [summary, setSummary] = useState<LintSummary | null>(null);
  const [issues, setIssues] = useState<LintIssue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<IssueFilter>("all");

  const [consistencyIssues, setConsistencyIssues] = useState<ConsistencyIssue[]>([]);
  const [isCheckingConsistency, setIsCheckingConsistency] = useState(false);
  const [consistencyError, setConsistencyError] = useState<string | null>(null);
  // null until a check has run on this branch (the API reports checked_at: null then).
  const [consistencyCheckedAt, setConsistencyCheckedAt] = useState<string | null>(null);

  const [duplicateClusters, setDuplicateClusters] = useState<DuplicateCluster[]>([]);
  const [isDetectingDuplicates, setIsDetectingDuplicates] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null);
  const [duplicatesCheckedAt, setDuplicatesCheckedAt] = useState<string | null>(null);

  const [isLoadingCachedConsistency, setIsLoadingCachedConsistency] = useState(false);
  const [isLoadingCachedDuplicates, setIsLoadingCachedDuplicates] = useState(false);

  const [lintConfigHint, setLintConfigHint] = useState<string | null>(null);

  const [isClearing, setIsClearing] = useState(false);

  const [isPollingLint, setIsPollingLint] = useState(false);
  const pollCancelled = useRef(false);

  const fetchData = useCallback(async (issueFilter?: IssueFilter) => {
    if (!isOpen) return;

    setIsLoading(true);
    setError(null);

    try {
      const issueOptions: { issue_type?: LintIssueType; limit: number } = { limit: 500 };
      const activeFilter = issueFilter ?? filter;
      if (activeFilter !== "all") {
        issueOptions.issue_type = activeFilter as LintIssueType;
      }

      const [summaryData, issuesData] = await Promise.all([
        lintApi.getStatus(projectId),
        lintApi.getIssues(projectId, issueOptions),
      ]);

      setSummary(summaryData);
      setIssues(issuesData.items);

      if (isLintRunActive(summaryData)) {
        setIsRunning(true);
        setIsPollingLint(true);
      } else {
        setIsRunning(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load lint data";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, isOpen, filter]);

  const fetchDataRef = useRef(fetchData);
  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const [config, levels] = await Promise.all([
          lintApi.getLintConfig(projectId),
          lintApi.getLevels(),
        ]);
        if (cancelled) return;
        if (config.lint_level != null) {
          const level = levels.levels.find((l) => l.level === config.lint_level);
          if (level) {
            setLintConfigHint(`Level ${level.level} — ${level.name} (${level.rule_ids.length} rules)`);
          } else {
            setLintConfigHint(`Level ${config.lint_level} (${config.effective_rules.length} rules)`);
          }
        } else if (config.enabled_rules) {
          setLintConfigHint(`Custom (${config.enabled_rules.length} rules)`);
        } else {
          setLintConfigHint(`All rules (${config.effective_rules.length})`);
        }
      } catch (err) {
        console.error("Failed to fetch lint config hint:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, projectId]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, fetchData]);

  useEffect(() => {
    if (!isOpen || !isPollingLint) return;
    const controller = new AbortController();
    waitForLintRun(projectId, { signal: controller.signal })
      .then((summary) => {
        if (controller.signal.aborted || !summary) return;
        setIsPollingLint(false);
        setIsRunning(false);
        fetchDataRef.current();
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setIsPollingLint(false);
        setIsRunning(false);
        setError(err instanceof Error ? err.message : "Failed to check lint status");
      });
    return () => controller.abort();
  }, [isOpen, isPollingLint, projectId]);

  const handleClearResults = async () => {
    setIsClearing(true);
    try {
      await lintApi.clearResults(projectId);
      setSummary((prev) => prev ? {
        ...prev,
        last_run: null,
        counts_run_id: null,
        error_count: 0,
        warning_count: 0,
        info_count: 0,
        total_issues: 0,
      } : null);
      setIssues([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear results");
    } finally {
      setIsClearing(false);
    }
  };

  const handleRunLint = async () => {
    setIsRunning(true);
    setError(null);

    try {
      await lintApi.triggerLint(projectId);
      setIsPollingLint(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start lint";
      setError(message);
      setIsRunning(false);
    }
  };

  const handleRunConsistencyCheck = async () => {
    setIsCheckingConsistency(true);
    setConsistencyError(null);
    pollCancelled.current = false;

    let jobId: string;
    try {
      ({ job_id: jobId } = await qualityApi.triggerConsistencyCheck(
        projectId,
        branch
      ));
    } catch (err) {
      setConsistencyError(
        err instanceof Error ? err.message : "Consistency check failed"
      );
      setIsCheckingConsistency(false);
      return;
    }

    try {
      let delay = 1000;
      const maxDelay = 5000;
      const maxAttempts = 20;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (pollCancelled.current) return;
        await new Promise((r) => setTimeout(r, delay));
        if (pollCancelled.current) return;
        const result = await qualityApi.getConsistencyJobResult(
          projectId,
          jobId
        );
        if ("status" in result && result.status === "pending") {
          delay = Math.min(delay * 1.5, maxDelay);
          continue;
        }
        const completed = result as ConsistencyCheckResult;
        setConsistencyIssues(completed.issues);
        setConsistencyCheckedAt(completed.checked_at);
        return;
      }
      setConsistencyError("Consistency check timed out — try again later");
    } catch (err) {
      if (!pollCancelled.current) {
        setConsistencyError(
          err instanceof Error ? err.message : "Consistency check failed"
        );
      }
    } finally {
      if (!pollCancelled.current) {
        setIsCheckingConsistency(false);
      }
    }
  };

  const handleDetectDuplicates = async () => {
    setIsDetectingDuplicates(true);
    setDuplicatesError(null);
    pollCancelled.current = false;

    let jobId: string;
    try {
      ({ job_id: jobId } = await qualityApi.triggerDuplicateDetection(
        projectId,
        branch
      ));
    } catch (err) {
      setDuplicatesError(
        err instanceof Error ? err.message : "Duplicate detection failed"
      );
      setIsDetectingDuplicates(false);
      return;
    }

    try {
      let delay = 1000;
      const maxDelay = 5000;
      const maxAttempts = 20;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (pollCancelled.current) return;
        await new Promise((r) => setTimeout(r, delay));
        if (pollCancelled.current) return;
        const result = await qualityApi.getDuplicateJobResult(
          projectId,
          jobId
        );
        if ("status" in result && result.status === "pending") {
          delay = Math.min(delay * 1.5, maxDelay);
          continue;
        }
        const completed = result as DuplicateDetectionResult;
        setDuplicateClusters(completed.clusters);
        setDuplicatesCheckedAt(completed.checked_at);
        return;
      }
      setDuplicatesError("Duplicate detection timed out — try again later");
    } catch (err) {
      if (!pollCancelled.current) {
        setDuplicatesError(
          err instanceof Error ? err.message : "Duplicate detection failed"
        );
      }
    } finally {
      if (!pollCancelled.current) {
        setIsDetectingDuplicates(false);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (activeTab === "consistency" && consistencyIssues.length === 0 && !isCheckingConsistency) {
      requestAnimationFrame(() => {
        if (cancelled) return;
        setIsLoadingCachedConsistency(true);
        qualityApi.getConsistencyIssues(projectId, branch)
          .then((r) => {
            if (cancelled) return;
            setConsistencyIssues(r.issues);
            setConsistencyCheckedAt(r.checked_at);
          })
          .catch((err) => { console.error("Failed to load cached consistency issues", { projectId, err }); })
          .finally(() => { if (!cancelled) setIsLoadingCachedConsistency(false); });
      });
    }
    if (activeTab === "duplicates" && duplicateClusters.length === 0 && !isDetectingDuplicates) {
      requestAnimationFrame(() => {
        if (cancelled) return;
        setIsLoadingCachedDuplicates(true);
        qualityApi.getLatestDuplicates(projectId, branch)
          .then((r) => {
            if (cancelled) return;
            setDuplicateClusters(r.clusters);
            setDuplicatesCheckedAt(r.checked_at);
          })
          .catch((err) => { console.error("Failed to load cached duplicates", { projectId, err }); })
          .finally(() => { if (!cancelled) setIsLoadingCachedDuplicates(false); });
      });
    }
    return () => { cancelled = true; };
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setConsistencyIssues([]);
    setConsistencyError(null);
    setConsistencyCheckedAt(null);
    setDuplicateClusters([]);
    setDuplicatesError(null);
    setDuplicatesCheckedAt(null);
  }, [projectId, branch]);

  useEffect(() => {
    if (!isOpen) return;
    return () => {
      pollCancelled.current = true;
    };
  }, [isOpen, projectId, branch]);

  const handleDismissIssue = async (issueId: string) => {

    try {
      await lintApi.dismissIssue(projectId, issueId);
      setIssues((prev) => prev.filter((i) => i.id !== issueId));
      if (summary) {
        const issue = issues.find((i) => i.id === issueId);
        if (issue) {
          setSummary((prev) =>
            prev
              ? {
                  ...prev,
                  total_issues: prev.total_issues - 1,
                  error_count:
                    issue.issue_type === "error" ? prev.error_count - 1 : prev.error_count,
                  warning_count:
                    issue.issue_type === "warning"
                      ? prev.warning_count - 1
                      : prev.warning_count,
                  info_count:
                    issue.issue_type === "info" ? prev.info_count - 1 : prev.info_count,
                }
              : null
          );
        }
      }
    } catch (err) {
      console.error("Failed to dismiss issue:", err);
    }
  };

  const handleFilterChange = useCallback((newFilter: IssueFilter) => {
    setFilter(newFilter);
    fetchData(newFilter);
  }, [fetchData]);

  const filteredIssues = issues;

  if (!isOpen) return null;

  return (
    <div className={cn("flex h-full flex-col bg-white dark:bg-slate-900", !embedded && "border-l border-slate-200 dark:border-slate-700")}>
      <div className="border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Health Check
            </h2>
            {isRunning && (
              <span className="flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                Running
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeTab === "lint" && (
              summary?.last_run?.status === "completed" && !isRunning && summary.total_issues > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearResults}
                  disabled={isClearing || !canRunLint}
                  className="gap-1"
                >
                  <X className="h-4 w-4" />
                  {isClearing ? "Clearing..." : "Clear"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRunLint}
                  disabled={isRunning || !canRunLint}
                  className="gap-1"
                >
                  <RefreshCw className={cn("h-4 w-4", isRunning && "animate-spin")} />
                  {isRunning ? "Running..." : "Run Lint"}
                </Button>
              )
            )}
            {activeTab === "consistency" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRunConsistencyCheck}
                disabled={isCheckingConsistency}
                className="gap-1"
              >
                <ShieldCheck className={cn("h-4 w-4", isCheckingConsistency && "animate-spin")} />
                {isCheckingConsistency ? "Checking..." : "Run Check"}
              </Button>
            )}
            {activeTab === "duplicates" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDetectDuplicates}
                disabled={isDetectingDuplicates}
                className="gap-1"
              >
                <Copy className={cn("h-4 w-4", isDetectingDuplicates && "animate-spin")} />
                {isDetectingDuplicates ? "Detecting..." : "Find Duplicates"}
              </Button>
            )}
            {!embedded && (
              <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex px-4">
          {(["lint", "consistency", "duplicates"] as HealthTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === tab
                  ? "border-primary-500 text-primary-600 dark:text-primary-400"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              )}
            >
              {tab === "lint" ? "Lint" : tab === "consistency" ? "Consistency" : "Duplicates"}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "lint" && (
      <>
      {summary && (
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="grid grid-cols-4 gap-2">
            <SummaryCard
              label="Errors"
              count={summary.error_count}
              color="red"
              active={filter === "error"}
              onClick={() => handleFilterChange(filter === "error" ? "all" : "error")}
            />
            <SummaryCard
              label="Warnings"
              count={summary.warning_count}
              color="amber"
              active={filter === "warning"}
              onClick={() => handleFilterChange(filter === "warning" ? "all" : "warning")}
            />
            <SummaryCard
              label="Info"
              count={summary.info_count}
              color="blue"
              active={filter === "info"}
              onClick={() => handleFilterChange(filter === "info" ? "all" : "info")}
            />
            <SummaryCard
              label="Total"
              count={summary.total_issues}
              color="slate"
              active={filter === "all"}
              onClick={() => handleFilterChange("all")}
            />
          </div>
          <div className="mt-2 space-y-0.5">
            {summary.last_run && (
              <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Clock className="h-3 w-3" />
                Last run: {formatDateTime(summary.last_run.started_at)}
                {summary.last_run.status === "completed" && (
                  <CheckCircle2 className="ml-1 h-3 w-3 text-green-500" />
                )}
                {summary.last_run.status === "failed" && (
                  <XCircle className="ml-1 h-3 w-3 text-red-500" />
                )}
              </div>
            )}
            {lintConfigHint && (
              <div className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                <Info className="h-3 w-3" />
                {lintConfigHint}
                <span className="mx-0.5">&mdash;</span>
                <Link
                  href={`/projects/${projectId}/settings#lint-config`}
                  className="text-primary-600 hover:underline dark:text-primary-400"
                >
                  configure
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {isLoading && !summary && (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        </div>
      )}

      {!isLoading && summary?.last_run?.status === "completed" && summary.total_issues === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
            No issues found
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Your ontology looks healthy!
          </p>
        </div>
      )}

      {!isLoading && !summary?.last_run && (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <Info className="h-12 w-12 text-slate-300 dark:text-slate-600" />
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            No lint run yet
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            Click &ldquo;Run Lint&rdquo; to check your ontology
          </p>
        </div>
      )}

      {!isLoading && filteredIssues.length > 0 && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2">
            {filteredIssues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                onNavigate={onNavigateToClass}
                onDismiss={() => handleDismissIssue(issue.id)}
              />
            ))}
          </div>
        </div>
      )}
      </>
      )}

      {activeTab === "consistency" && (
        <div className="flex-1 overflow-y-auto p-4">
          {consistencyError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
              {consistencyError}
            </div>
          )}
          {(isCheckingConsistency || isLoadingCachedConsistency) && (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
            </div>
          )}
          {!isCheckingConsistency && !isLoadingCachedConsistency && consistencyIssues.length === 0 && !consistencyCheckedAt && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Info className="h-12 w-12 text-slate-300 dark:text-slate-600" />
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                Not checked yet
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Run a consistency check to validate your ontology structure.
              </p>
            </div>
          )}
          {!isCheckingConsistency && !isLoadingCachedConsistency && consistencyIssues.length === 0 && consistencyCheckedAt && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ShieldCheck className="h-12 w-12 text-green-500" />
              <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                No consistency issues
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Last checked {new Date(consistencyCheckedAt).toLocaleString()}
              </p>
            </div>
          )}
          {consistencyIssues.length > 0 && (
            <div className="space-y-2">
              {consistencyIssues.map((issue, idx) => (
                <div
                  key={`${issue.rule_id}-${issue.entity_iri}-${idx}`}
                  className={cn(
                    "rounded-lg border p-3",
                    issue.severity === "error" && "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10",
                    issue.severity === "warning" && "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10",
                    issue.severity === "info" && "border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-900/10"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {issue.severity === "error" && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                    {issue.severity === "warning" && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />}
                    {issue.severity === "info" && <Info className="h-4 w-4 shrink-0 text-blue-500" />}
                    <div className="min-w-0 flex-1">
                      <span className="rounded-sm bg-slate-200/50 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700/50 dark:text-slate-400">
                        {issue.rule_id}
                      </span>
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                        {issue.message}
                      </p>
                      {issue.entity_iri && (
                        <button
                          onClick={() => onNavigateToClass?.(issue.entity_iri, issue.entity_type)}
                          className="mt-1 text-xs text-primary-600 hover:underline dark:text-primary-400"
                        >
                          {getLocalName(issue.entity_iri)}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "duplicates" && (
        <div className="flex-1 overflow-y-auto p-4">
          {duplicatesError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
              {duplicatesError}
            </div>
          )}
          {(isDetectingDuplicates || isLoadingCachedDuplicates) && (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
            </div>
          )}
          {!isDetectingDuplicates && !isLoadingCachedDuplicates && duplicateClusters.length === 0 && !duplicatesCheckedAt && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Info className="h-12 w-12 text-slate-300 dark:text-slate-600" />
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                Not checked yet
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Click &ldquo;Find Duplicates&rdquo; to scan for near-duplicate entities.
              </p>
            </div>
          )}
          {!isDetectingDuplicates && !isLoadingCachedDuplicates && duplicateClusters.length === 0 && duplicatesCheckedAt && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">
                No duplicates detected
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Last checked {new Date(duplicatesCheckedAt).toLocaleString()}
              </p>
            </div>
          )}
          {duplicateClusters.length > 0 && (
            <div className="space-y-3">
              {duplicateClusters.map((cluster, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/10"
                >
                  <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                    {Math.round(cluster.similarity * 100)}% similar
                  </div>
                  <div className="space-y-1">
                    {cluster.entities.map((entity) => (
                      <button
                        key={entity.iri}
                        onClick={() => onNavigateToClass?.(entity.iri, entity.entity_type)}
                        className="flex w-full items-center gap-2 text-left text-sm text-primary-600 hover:underline dark:text-primary-400"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-owl-class/10 border border-owl-class/50">
                          <span className="text-[8px] font-bold text-owl-class">
                            {entity.entity_type === "class" ? "C" : entity.entity_type === "property" ? "P" : "I"}
                          </span>
                        </span>
                        {entity.label || getLocalName(entity.iri)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  count: number;
  color: "red" | "amber" | "blue" | "slate";
  active?: boolean;
  onClick?: () => void;
}

function SummaryCard({ label, count, color, active, onClick }: SummaryCardProps) {
  const colorClasses = {
    red: "text-red-600 dark:text-red-400",
    amber: "text-amber-600 dark:text-amber-400",
    blue: "text-blue-600 dark:text-blue-400",
    slate: "text-slate-600 dark:text-slate-400",
  };

  const bgClasses = {
    red: "bg-red-50 dark:bg-red-900/20",
    amber: "bg-amber-50 dark:bg-amber-900/20",
    blue: "bg-blue-50 dark:bg-blue-900/20",
    slate: "bg-slate-50 dark:bg-slate-800",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg p-2 text-center transition-all",
        bgClasses[color],
        active && "ring-2 ring-primary-500 ring-offset-1"
      )}
    >
      <p className={cn("text-lg font-semibold", colorClasses[color])}>{count}</p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{label}</p>
    </button>
  );
}

interface IssueCardProps {
  issue: LintIssue;
  onNavigate?: (iri: string, subjectType?: string) => void;
  onDismiss?: () => void;
}

const SUBJECT_TYPE_BADGE: Record<SubjectType, { letter: string; colorClass: string }> = {
  class: { letter: "C", colorClass: "text-owl-class bg-owl-class/10 border-owl-class/50" },
  property: { letter: "P", colorClass: "text-emerald-600 bg-emerald-100/50 border-emerald-500/50 dark:text-emerald-400 dark:bg-emerald-900/20 dark:border-emerald-400/50" },
  individual: { letter: "I", colorClass: "text-violet-600 bg-violet-100/50 border-violet-500/50 dark:text-violet-400 dark:bg-violet-900/20 dark:border-violet-400/50" },
  other: { letter: "?", colorClass: "text-slate-500 bg-slate-100/50 border-slate-400/50 dark:text-slate-400 dark:bg-slate-700/50 dark:border-slate-500/50" },
};

function resolveBadgeKey(subjectType: SubjectType | null): SubjectType {
  if (subjectType === null) return "other";
  if (subjectType in SUBJECT_TYPE_BADGE) return subjectType;
  console.error("Unknown lint issue subject_type:", subjectType);
  return "other";
}

function IssueCard({ issue, onNavigate, onDismiss }: IssueCardProps) {
  const subjectTypeKey = resolveBadgeKey(issue.subject_type);
  const subjectBadge = SUBJECT_TYPE_BADGE[subjectTypeKey];
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        issueColors[issue.issue_type]
      )}
    >
      <div className="flex items-start gap-2">
        {issueIcons[issue.issue_type]}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-sm bg-slate-200/50 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700/50 dark:text-slate-400">
              {issue.rule_id}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
            {issue.message}
          </p>
          {issue.subject_iri && (
            <Tooltip content={issue.subject_iri}>
              <button
                onClick={() => onNavigate?.(issue.subject_iri!, subjectTypeKey)}
                className="mt-2 flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-400"
              >
                <span
                  aria-label={`subject type: ${subjectTypeKey}`}
                  data-testid={`subject-type-badge-${subjectTypeKey}`}
                  className={cn("flex h-4 w-4 items-center justify-center rounded-full border", subjectBadge.colorClass)}
                >
                  <span className="text-[8px] font-bold">{subjectBadge.letter}</span>
                </span>
                {getLocalName(issue.subject_iri)}
                <ExternalLink className="h-3 w-3 opacity-50" />
              </button>
            </Tooltip>
          )}
          {issue.details?.duplicate_iris && issue.details.duplicate_iris.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <span>Also:</span>
              {issue.details.duplicate_iris.slice(0, 3).map((iri) => (
                <Tooltip key={iri} content={iri}>
                  <button
                    onClick={() => onNavigate?.(iri, subjectTypeKey)}
                    className="text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-400"
                  >
                    {getLocalName(iri)}
                  </button>
                </Tooltip>
              ))}
              {issue.details.duplicate_iris.length > 3 && (
                <span>+{issue.details.duplicate_iris.length - 3} more</span>
              )}
            </div>
          )}
        </div>
        {onDismiss && (
          <Tooltip content="Dismiss issue">
            <button
              onClick={onDismiss}
              className="rounded-sm p-1 text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 dark:hover:bg-slate-700/50 dark:hover:text-slate-300"
              aria-label="Dismiss issue"
            >
              <X className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
