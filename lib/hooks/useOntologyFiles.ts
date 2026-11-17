"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectApi, type OntologyFileChange, type OntologyFileCreate } from "@/lib/api/projects";
import { healthQueryKeys } from "@/lib/hooks/useHealthSummary";
import { useSelectionStore } from "@/lib/stores/selectionStore";

export const ontologyFileQueryKeys = {
  list: (projectId: string, branch?: string) => ["ontologyFiles", projectId, branch ?? ""] as const,
};

/** The RDF files in the project folder on a branch, and which one is the project's ontology. */
export function useOntologyFiles(projectId: string, branch?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ontologyFileQueryKeys.list(projectId, branch),
    queryFn: () => projectApi.listOntologyFiles(projectId, branch),
    enabled: !!projectId && (options.enabled ?? true),
  });
}

/**
 * Switch the project's ontology file, or create a new one. Afterwards every query scoped to the
 * project is refetched (the project itself, so the editor sees the new path, plus the tree,
 * source, lint, health, normalization and index status), and the entity selection is cleared:
 * it belonged to the old ontology.
 */
export function useOntologyFileMutations(
  projectId: string,
  branch?: string,
  onChanged?: (change: OntologyFileChange) => void,
) {
  const queryClient = useQueryClient();
  const applied = (change: OntologyFileChange) => {
    useSelectionStore.getState().clear();
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes(projectId) });
    void queryClient.invalidateQueries({ queryKey: healthQueryKeys.all });
    onChanged?.(change);
  };
  const switchFile = useMutation({
    /** `reconvert`: see projectApi.switchOntologyFile; left out unless the user chose. */
    mutationFn: ({ path, reconvert }: { path: string; reconvert?: boolean }) =>
      reconvert === undefined
        ? projectApi.switchOntologyFile(projectId, path, branch)
        : projectApi.switchOntologyFile(projectId, path, branch, { reconvert }),
    onSuccess: applied,
  });
  const createFile = useMutation({
    mutationFn: (data: Omit<OntologyFileCreate, "branch">) => projectApi.createOntologyFile(projectId, { ...data, branch }),
    onSuccess: applied,
  });
  return { switchFile, createFile };
}
