"use client";

import { useSearchParams } from "next/navigation";
import { useSelectionStore } from "@/lib/stores/selectionStore";
import {
  buildSelectionQuery,
  readSelectionFromSearchParams,
} from "@/lib/utils/selectionUrl";

export function useProjectHomeHref(projectId: string): string {
  const searchParams = useSearchParams();
  const storeIri = useSelectionStore((s) => s.iri);
  const storeType = useSelectionStore((s) => s.type);
  const selection =
    storeIri && storeType
      ? { iri: storeIri, type: storeType }
      : readSelectionFromSearchParams(searchParams);

  return `/projects/${projectId}${buildSelectionQuery(selection)}`;
}
