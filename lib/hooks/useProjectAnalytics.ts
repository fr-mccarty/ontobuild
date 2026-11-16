import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "@/lib/api/analytics";

export function useProjectActivity(
  projectId: string,
  accessToken?: string,
  days = 30
) {
  return useQuery({
    queryKey: ["projectActivity", projectId, !!accessToken, days],
    queryFn: () => analyticsApi.getActivity(projectId, accessToken, days),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

export function useHotEntities(
  projectId: string,
  accessToken?: string,
  limit = 20,
  days = 30
) {
  return useQuery({
    queryKey: ["hotEntities", projectId, !!accessToken, limit, days],
    queryFn: () => analyticsApi.getHotEntities(projectId, accessToken, limit, days),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

export function useContributors(
  projectId: string,
  accessToken?: string,
  days = 30
) {
  return useQuery({
    queryKey: ["contributors", projectId, !!accessToken, days],
    queryFn: () => analyticsApi.getContributors(projectId, accessToken, days),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}
