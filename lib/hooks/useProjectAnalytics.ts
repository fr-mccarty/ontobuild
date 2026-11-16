import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "@/lib/api/analytics";

export function useProjectActivity(
  projectId: string,
  days = 30
) {
  return useQuery({
    queryKey: ["projectActivity", projectId, days],
    queryFn: () => analyticsApi.getActivity(projectId, days),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

export function useHotEntities(
  projectId: string,
  limit = 20,
  days = 30
) {
  return useQuery({
    queryKey: ["hotEntities", projectId, limit, days],
    queryFn: () => analyticsApi.getHotEntities(projectId, limit, days),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

export function useContributors(
  projectId: string,
  days = 30
) {
  return useQuery({
    queryKey: ["contributors", projectId, days],
    queryFn: () => analyticsApi.getContributors(projectId, days),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}
