import { useQuery } from "@tanstack/react-query";
import { projectOntologyApi } from "@/lib/api/client";

export interface EntityCounts {
  properties: number;
  individuals: number;
}

/** How many properties and individuals the ontology has on a branch, for the entity tree's tabs. */
export function useEntityCounts(projectId: string, branch?: string, refreshKey = 0) {
  return useQuery({
    queryKey: ["entity-counts", projectId, branch ?? null, refreshKey],
    queryFn: async (): Promise<EntityCounts> => {
      // limit 0: only the totals, not every entity.
      const [properties, individuals] = await Promise.all([
        projectOntologyApi.searchEntities(projectId, "*", branch, "property", 0),
        projectOntologyApi.searchEntities(projectId, "*", branch, "individual", 0),
      ]);
      return { properties: properties.total, individuals: individuals.total };
    },
    enabled: !!projectId && !!branch,
    placeholderData: (previous) => previous,
  });
}
