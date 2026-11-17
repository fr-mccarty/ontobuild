import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { provenanceApi, type ProvenanceItem } from "@/lib/api/provenance";

export const provenanceQueryKeys = {
  all: (projectId: string) => ["provenance", projectId] as const,
  item: (projectId: string, branch: string | undefined, item: ProvenanceItem) =>
    ["provenance", projectId, branch ?? "", item.iri, item.property, item.value] as const,
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Provenance of one text value. Lookups from a panel's rows are batched into one request;
 * the value is debounced so typing doesn't send a request per keystroke.
 */
export function useProvenance(
  projectId: string | undefined,
  item: { iri?: string; property?: string; value: string },
  branch?: string,
) {
  const value = useDebounced(item.value, 400);
  const enabled = !!projectId && !!item.iri && !!item.property && !!value.trim();
  const full: ProvenanceItem = { iri: item.iri ?? "", property: item.property ?? "", value };
  return useQuery({
    queryKey: provenanceQueryKeys.item(projectId ?? "", branch, full),
    queryFn: () => provenanceApi.lookup(projectId!, full, branch),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}
