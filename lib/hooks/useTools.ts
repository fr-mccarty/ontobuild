import { useQuery } from "@tanstack/react-query";
import { toolsApi } from "@/lib/api/tools";

export const toolsQueryKeys = {
  componentTree: (projectId: string) => ["tools", "component-tree", projectId] as const,
  orphans: (projectId: string) => ["tools", "orphans", projectId] as const,
};

/** The React component tree of the project's code/ folder; only fetched while `enabled`. */
export function useComponentTree(projectId: string, enabled = true) {
  return useQuery({
    queryKey: toolsQueryKeys.componentTree(projectId),
    queryFn: () => toolsApi.componentTree(projectId),
    enabled: !!projectId && enabled,
  });
}

/** Unused files, declarations, tests and scripts in the project's code/ folder; only fetched while `enabled`. */
export function useOrphans(projectId: string, enabled = true) {
  return useQuery({
    queryKey: toolsQueryKeys.orphans(projectId),
    queryFn: () => toolsApi.orphans(projectId),
    enabled: !!projectId && enabled,
  });
}
