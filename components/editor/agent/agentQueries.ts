import { useQuery } from "@tanstack/react-query";
import { agentSettingsApi } from "@/lib/api/agentSettings";

export const agentQueryKeys = {
  status: ["agent", "status"] as const,
  models: ["agent", "models"] as const,
};

export function useAgentStatus() {
  return useQuery({
    queryKey: agentQueryKeys.status,
    queryFn: () => agentSettingsApi.getStatus(),
    staleTime: 30_000,
  });
}

export function useAgentModels(enabled: boolean) {
  return useQuery({
    queryKey: agentQueryKeys.models,
    queryFn: async () => (await agentSettingsApi.listModels()).models,
    enabled,
    staleTime: Infinity,
  });
}
