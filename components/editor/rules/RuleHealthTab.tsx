"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Download, Info, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RuleViolationList } from "@/components/editor/rules/RuleViolationList";
import { rulesApi, type RuleValidationResult } from "@/lib/api/rules";
import { apiErrorMessage } from "@/lib/api/errors";
import { ruleQueryKeys, useRuleViolations } from "@/lib/hooks/useRules";
import { cn, formatDateTime } from "@/lib/utils";

const FIRST_DELAY_MS = 1000;
const MAX_DELAY_MS = 5000;
const MAX_ATTEMPTS = 40;

interface RuleHealthTabProps {
  projectId: string;
  branch?: string;
  onNavigate?: (iri: string, entityType: string) => void;
  onResultsChanged?: () => void;
}

export function RuleHealthTab({ projectId, branch, onNavigate, onResultsChanged }: RuleHealthTabProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error: loadError } = useRuleViolations(projectId, branch);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, [projectId, branch]);

  const handleRun = async () => {
    setIsRunning(true);
    setRunError(null);
    try {
      const { job_id: jobId } = await rulesApi.validate(projectId, branch);
      let delay = FIRST_DELAY_MS;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, delay));
        if (cancelled.current) return;
        const result = await rulesApi.getJobResult(projectId, jobId);
        if ("status" in result && result.status === "pending") {
          delay = Math.min(delay * 1.5, MAX_DELAY_MS);
          continue;
        }
        const completed = result as RuleValidationResult;
        void queryClient.invalidateQueries({ queryKey: ruleQueryKeys.all });
        onResultsChanged?.();
        if (!completed.checked_at) setRunError("Validation finished without a result");
        return;
      }
      setRunError("Validation timed out — try again later");
    } catch (err) {
      if (!cancelled.current) setRunError(apiErrorMessage(err, "Validation failed"));
    } finally {
      if (!cancelled.current) setIsRunning(false);
    }
  };

  const counts = data?.counts;
  const violations = data?.violations ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="rule-health-tab">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="flex items-center justify-between gap-2">
          <div className="grid flex-1 grid-cols-4 gap-2">
            <Count label="Errors" count={counts?.error ?? 0} color="text-red-600 dark:text-red-400" bg="bg-red-50 dark:bg-red-900/20" />
            <Count label="Warnings" count={counts?.warning ?? 0} color="text-amber-600 dark:text-amber-400" bg="bg-amber-50 dark:bg-amber-900/20" />
            <Count label="Info" count={counts?.info ?? 0} color="text-blue-600 dark:text-blue-400" bg="bg-blue-50 dark:bg-blue-900/20" />
            <Count label="Total" count={counts?.total ?? 0} color="text-slate-600 dark:text-slate-400" bg="bg-slate-50 dark:bg-slate-800" />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            {data?.checked_at && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Last run: {formatDateTime(data.checked_at)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={rulesApi.shaclUrl(projectId, branch)}
              download="rules.shacl.ttl"
              className={cn(
                "inline-flex h-8 items-center justify-center gap-1 rounded-md border border-slate-300 px-3 text-sm font-medium transition-colors",
                "hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800",
              )}
            >
              <Download className="h-4 w-4" />
              Download SHACL
            </a>
            <Button variant="outline" size="sm" onClick={handleRun} disabled={isRunning} className="gap-1">
              <ShieldCheck className={cn("h-4 w-4", isRunning && "animate-spin")} />
              {isRunning ? "Validating..." : "Run Validation"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {data?.stale && data.checked_at && (
          <div
            role="status"
            data-testid="rule-results-stale"
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-400"
          >
            These results are for an older commit. Run validation again to check the current one.
          </div>
        )}
        {(runError || loadError) && (
          <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
            {runError ?? apiErrorMessage(loadError, "Failed to load rule violations")}
          </div>
        )}
        {(isLoading || isRunning) && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        )}
        {!isLoading && !isRunning && data && !data.checked_at && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Info className="h-12 w-12 text-slate-300 dark:text-slate-600" />
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Not validated yet</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Click &ldquo;Run Validation&rdquo; to check the instances against the rules.
            </p>
          </div>
        )}
        {!isLoading && !isRunning && data?.checked_at && violations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-300">No rule violations</p>
          </div>
        )}
        {violations.length > 0 && <RuleViolationList violations={violations} onNavigate={onNavigate} />}
      </div>
    </div>
  );
}

function Count({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <div className={cn("rounded-lg p-2 text-center", bg)}>
      <p className={cn("text-lg font-semibold", color)}>{count}</p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}
