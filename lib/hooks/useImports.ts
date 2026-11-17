"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { importsApi, type ImportCandidate, type ImportsResponse } from "@/lib/api/imports";
import { IMPORTS_CHANGED_EVENT, type ImportsChangedDetail } from "@/lib/hooks/useOntologyTree";

export const importsQueryKeys = {
  list: (projectId: string, branch?: string) => ["imports", projectId, branch ?? ""] as const,
  candidates: (q: string) => ["importCandidates", q] as const,
};

export function useImports(projectId: string, branch?: string) {
  return useQuery({
    queryKey: importsQueryKeys.list(projectId, branch),
    queryFn: () => importsApi.list(projectId, branch),
    enabled: !!projectId,
  });
}

export function useImportCandidates(q: string, enabled = true) {
  return useQuery<ImportCandidate[]>({
    queryKey: importsQueryKeys.candidates(q),
    queryFn: () => importsApi.candidates(q),
    enabled,
    staleTime: 10_000,
  });
}

/**
 * Add, remove and refresh imports. After a change the editor is told to reload: every query
 * scoped to the project is invalidated (as after an agent edit) and the class tree refreshes
 * through IMPORTS_CHANGED_EVENT.
 */
export function useImportMutations(projectId: string, branch?: string, onChanged?: () => void) {
  const queryClient = useQueryClient();

  const applied = (data: ImportsResponse, ontologyChanged: boolean) => {
    queryClient.setQueryData(importsQueryKeys.list(projectId, branch), data);
    if (!ontologyChanged) return;
    void queryClient.invalidateQueries({
      predicate: (q) => q.queryKey.includes(projectId) && q.queryKey[0] !== "imports",
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<ImportsChangedDetail>(IMPORTS_CHANGED_EVENT, { detail: { projectId, branch } }),
      );
    }
    onChanged?.();
  };

  const add = useMutation({
    mutationFn: (iri: string) => importsApi.add(projectId, iri, branch),
    onSuccess: (data) => applied(data, true),
  });
  const remove = useMutation({
    mutationFn: (iri: string) => importsApi.remove(projectId, iri, branch),
    onSuccess: (data) => applied(data, true),
  });
  const refresh = useMutation({
    mutationFn: () => importsApi.refresh(projectId, branch),
    // Refetched documents can change the imported classes the tree shows.
    onSuccess: (data) => applied(data, true),
  });

  return { add, remove, refresh };
}
