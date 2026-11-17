"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import { getLocalName } from "@/lib/utils";
import { projectOntologyApi, type EntitySearchResult } from "@/lib/api/client";
import { apiErrorMessage } from "@/lib/api/errors";
import { EntityTree } from "@/components/editor/shared/EntityTree";
import type { EntityTreeNode } from "@/lib/ontology/types";

interface PropertyTreeProps {
  projectId: string;
  branch?: string;
  selectedIri: string | null;
  onSelect: (iri: string) => void;
  /** Change to reload the list in place, keeping collapsed groups and the selection. */
  refreshKey?: number;
  /** Renders a load error (its `detail` text); defaults to a plain error box. */
  renderError?: (message: string) => ReactNode;
}

interface PropertyGroup {
  label: string;
  type: string;
  items: EntitySearchResult[];
  isExpanded: boolean;
}

export function PropertyTree({
  projectId,
  branch,
  selectedIri,
  onSelect,
  refreshKey = 0,
  renderError,
}: PropertyTreeProps) {
  const [groups, setGroups] = useState<PropertyGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Open the group that holds the selected property when the selection changes, so a
  // property selected from elsewhere (a link, the agent) is visible.
  const [revealedIri, setRevealedIri] = useState<string | null>(null);
  if (selectedIri !== revealedIri && groups.length > 0) {
    setRevealedIri(selectedIri);
    if (selectedIri && groups.some((g) => !g.isExpanded && g.items.some((i) => i.iri === selectedIri))) {
      setGroups(groups.map((g) => (g.items.some((i) => i.iri === selectedIri) ? { ...g, isExpanded: true } : g)));
    }
  }

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

    const fetchProperties = async () => {
      setError(null);

      try {
        const response = await projectOntologyApi.searchEntities(
          projectId,
          "*",
          branch,
          "property",
        );

        if (cancelled) return;

        const objectProps: EntitySearchResult[] = [];
        const dataProps: EntitySearchResult[] = [];
        const annotationProps: EntitySearchResult[] = [];
        const otherProps: EntitySearchResult[] = [];

        for (const prop of response.results) {
          switch (prop.property_kind) {
            case "object":
              objectProps.push(prop);
              break;
            case "data":
              dataProps.push(prop);
              break;
            case "annotation":
              annotationProps.push(prop);
              break;
            default:
              otherProps.push(prop);
          }
        }

        const newGroups: PropertyGroup[] = [];
        if (objectProps.length > 0) {
          newGroups.push({ label: "Object Properties", type: "object", items: objectProps, isExpanded: true });
        }
        if (dataProps.length > 0) {
          newGroups.push({ label: "Data Properties", type: "data", items: dataProps, isExpanded: true });
        }
        if (annotationProps.length > 0) {
          newGroups.push({ label: "Annotation Properties", type: "annotation", items: annotationProps, isExpanded: true });
        }
        if (otherProps.length > 0) {
          newGroups.push({ label: "Other Properties", type: "other", items: otherProps, isExpanded: true });
        }

        setGroups((prev) =>
          newGroups.map((g) => ({ ...g, isExpanded: prev.find((p) => p.type === g.type)?.isExpanded ?? true })),
        );
        setLoadedFor(`${projectId}\n${branch ?? ""}`);
      } catch (err) {
        if (!cancelled) {
          setError(apiErrorMessage(err, "Failed to load properties"));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchProperties();
    return () => { cancelled = true; };
  }, [projectId, branch, refreshKey]);

  const entityNodes = useMemo((): EntityTreeNode[] => {
    return groups.map((group) => ({
      iri: `__group__${group.type}`,
      label: group.label,
      children: group.items.map((prop) => ({
        iri: prop.iri,
        label: prop.label || getLocalName(prop.iri),
        children: [],
        isExpanded: false,
        isLoading: false,
        hasChildren: false,
        entityType: "property" as const,
        deprecated: prop.deprecated,
      })),
      isExpanded: group.isExpanded,
      isLoading: false,
      hasChildren: group.items.length > 0,
      isGroupHeader: true,
    }));
  }, [groups]);

  const handleExpand = (iri: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        `__group__${g.type}` === iri ? { ...g, isExpanded: true } : g,
      ),
    );
  };

  const handleCollapse = (iri: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        `__group__${g.type}` === iri ? { ...g, isExpanded: false } : g,
      ),
    );
  };

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

  if (groups.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No properties found in this ontology
        </p>
      </div>
    );
  }

  return (
    <EntityTree
      nodes={entityNodes}
      selectedIri={selectedIri}
      onSelect={onSelect}
      onExpand={handleExpand}
      onCollapse={handleCollapse}
    />
  );
}
