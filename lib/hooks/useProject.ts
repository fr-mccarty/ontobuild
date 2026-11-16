import { useQuery } from "@tanstack/react-query";
import { projectApi } from "@/lib/api/projects";
import { ApiError } from "@/lib/api/client";

export type ProjectErrorKind = "no-access" | "not-found" | "generic";

export const projectQueryKeys = {
  detail: (projectId: string) => ["project", projectId] as const,
};

export function useProject(projectId: string) {
  const query = useQuery({
    queryKey: projectQueryKeys.detail(projectId),
    queryFn: () => projectApi.get(projectId),
    enabled: !!projectId,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return false;
      return failureCount < 3;
    },
  });

  let errorKind: ProjectErrorKind | null = null;
  let errorMessage: string | null = null;

  if (query.error) {
    if (query.error instanceof ApiError && query.error.status === 403) {
      errorKind = "no-access";
      errorMessage = "You don't have access to this project";
    } else if (query.error instanceof ApiError && query.error.status === 404) {
      errorKind = "not-found";
      errorMessage = "Project not found";
    } else {
      errorKind = "generic";
      errorMessage = query.error instanceof Error ? query.error.message : "Failed to load project";
    }
  }

  return {
    project: query.data ?? null,
    isLoading: query.isLoading,
    error: errorMessage,
    errorKind,
    refetch: query.refetch,
  };
}
