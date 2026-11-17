import { useQuery } from "@tanstack/react-query";
import { lintApi } from "@/lib/api/lint";
import { qualityApi } from "@/lib/api/quality";
import type { AgentHealthSummary } from "@/lib/agent/healthSummary";

export const healthQueryKeys = {
  all: ["health"] as const,
  summary: (projectId: string, branch?: string) => ["health", "summary", projectId, branch ?? null] as const,
};

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export async function fetchHealthSummary(projectId: string, branch?: string): Promise<AgentHealthSummary> {
  const [lint, consistency, duplicates] = await Promise.all([
    settle(lintApi.getStatus(projectId)),
    settle(qualityApi.getConsistencyIssues(projectId, branch)),
    settle(qualityApi.getLatestDuplicates(projectId, branch)),
  ]);
  const running = !!lint?.last_run && ["pending", "running"].includes(lint.last_run.status);
  return {
    lint: lint
      ? {
          errors: lint.error_count,
          warnings: lint.warning_count,
          info: lint.info_count,
          total: lint.total_issues,
          // The counts may come from a run before the one in progress, whose time we don't have.
          checkedAt: !lint.counts_run_id
            ? null
            : lint.last_run?.id === lint.counts_run_id && lint.last_run.completed_at
              ? lint.last_run.completed_at
              : "before the current run",
          running,
        }
      : null,
    consistency: consistency ? { count: consistency.issues.length, checkedAt: consistency.checked_at } : null,
    duplicates: duplicates ? { count: duplicates.clusters.length, checkedAt: duplicates.checked_at } : null,
  };
}

/** The Health tab's latest results for the project and branch. Refetched after agent changes and health runs. */
export function useHealthSummary(projectId: string, branch?: string) {
  return useQuery({
    queryKey: healthQueryKeys.summary(projectId, branch),
    queryFn: () => fetchHealthSummary(projectId, branch),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
