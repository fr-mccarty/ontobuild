"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import { getLocalName } from "@/lib/utils";
import { projectOntologyApi, type EntitySearchResult } from "@/lib/api/client";
import { apiErrorMessage } from "@/lib/api/errors";
import { EntityTree } from "@/components/editor/shared/EntityTree";
import type { EntityTreeNode } from "@/lib/ontology/types";

interface IndividualListProps {
  projectId: string;
  branch?: string;
  selectedIri: string | null;
  onSelect: (iri: string) => void;
  /** Change to reload the list in place, keeping the selection. */
  refreshKey?: number;
  /** Renders a load error (its `detail` text); defaults to a plain error box. */
  renderError?: (message: string) => ReactNode;
}

export function IndividualList({
  projectId,
  branch,
  selectedIri,
  onSelect,
  refreshKey = 0,
  renderError,
}: IndividualListProps) {
  const [individuals, setIndividuals] = useState<EntitySearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A refresh keeps showing the current list while it reloads; only a new project or
  // branch shows the spinner.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const scope = `${projectId}\n${branch ?? ""}`;
  if (loadedFor !== null && loadedFor !== scope) {
    setLoadedFor(null);
    setIsLoading(true);
  }

  useEffect(() => {
    let cancelled = false;

    const fetchIndividuals = async () => {
      setError(null);

      try {
        const response = await projectOntologyApi.searchEntities(
          projectId,
          "*",
          branch,
          "individual",
        );

        if (cancelled) return;
        setIndividuals(response.results);
        setLoadedFor(`${projectId}\n${branch ?? ""}`);
      } catch (err) {
        if (!cancelled) {
          setError(apiErrorMessage(err, "Failed to load individuals"));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchIndividuals();
    return () => { cancelled = true; };
  }, [projectId, branch, refreshKey]);

  const entityNodes = useMemo((): EntityTreeNode[] => {
    return individuals.map((ind) => ({
      iri: ind.iri,
      label: ind.label || getLocalName(ind.iri),
      children: [],
      isExpanded: false,
      isLoading: false,
      hasChildren: false,
      entityType: "individual" as const,
      deprecated: ind.deprecated,
    }));
  }, [individuals]);

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  if (error) {
    if (renderError) return <>{renderError(error)}</>;
    return (
      <div className="p-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center dark:border-red-900/50 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (individuals.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No individuals found in this ontology
        </p>
      </div>
    );
  }

  return (
    <EntityTree
      nodes={entityNodes}
      selectedIri={selectedIri}
      onSelect={onSelect}
      onExpand={() => {}}
      onCollapse={() => {}}
    />
  );
}
