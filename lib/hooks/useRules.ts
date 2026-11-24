import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { rulesApi } from "@/lib/api/rules";
import { healthQueryKeys } from "@/lib/hooks/useHealthSummary";
import { branchQueryKeys } from "@/lib/context/BranchContext";

const VALIDATION_SETTLE_MS = 3000;

export const ruleQueryKeys = {
  all: ["rules"] as const,
  forClass: (projectId: string, branch: string | undefined, classIri: string) =>
    ["rules", "class", projectId, branch ?? null, classIri] as const,
  violations: (projectId: string, branch: string | undefined, classIri: string | null, entityIri: string | null) =>
    ["rules", "violations", projectId, branch ?? null, classIri, entityIri] as const,
};

/** The rules on a class and its superclasses, imported ones included. */
export function useClassRules(projectId: string, classIri: string | null, branch?: string) {
  return useQuery({
    queryKey: ruleQueryKeys.forClass(projectId, branch, classIri ?? ""),
    queryFn: () => rulesApi.list(projectId, branch, classIri ?? undefined).then((r) => r.rules),
    enabled: !!projectId && !!classIri,
  });
}

export function useRuleViolations(
  projectId: string,
  branch: string | undefined,
  filter: { classIri?: string; entityIri?: string } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ruleQueryKeys.violations(projectId, branch, filter.classIri ?? null, filter.entityIri ?? null),
    queryFn: () => rulesApi.getViolations(projectId, branch, filter),
    enabled: enabled && !!projectId,
  });
}

/** What every rule write refreshes: the rules and violations, the health counts and the branch heads. */
export function useRefreshAfterRuleChange(projectId: string) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ruleQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: healthQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId) });
    };
    refresh();
    setTimeout(refresh, VALIDATION_SETTLE_MS);
  }, [queryClient, projectId]);
}
