import { useQuery } from "@tanstack/react-query";
import { qualityApi } from "@/lib/api/quality";

export function useCrossReferences(
  projectId: string,
  entityIri: string | null,
  branch?: string
) {
  return useQuery({
    queryKey: ["crossReferences", projectId, entityIri, branch],
    queryFn: () =>
      qualityApi.getCrossReferences(projectId, entityIri!, branch),
    enabled: !!entityIri && !!projectId,
    staleTime: 60_000,
  });
}
