import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "@/lib/api/analytics";

export function useEntityHistory(
  projectId: string,
  entityIri: string | null,
  branch?: string,
  limit = 50
) {
  return useQuery({
    queryKey: ["entityHistory", projectId, entityIri, branch, limit],
    queryFn: () =>
      analyticsApi.getEntityHistory(projectId, entityIri!, branch, limit),
    enabled: !!entityIri && !!projectId,
    staleTime: 30_000,
  });
}
