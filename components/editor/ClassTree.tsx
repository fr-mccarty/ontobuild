"use client";

import { useMemo } from "react";
import { cn, getLocalName } from "@/lib/utils";
import { EntityTypeIcon } from "@/components/editor/shared/EntityTypeIcon";
import { EntityTree } from "@/components/editor/shared/EntityTree";
import { Tooltip } from "@/components/ui/tooltip";
import { classTreeNodesToEntityNodes } from "@/lib/ontology/types";
import type { ClassTreeNode, ImportedMarker } from "@/lib/ontology/types";
import type { EntitySearchResult } from "@/lib/api/client";
import type { DragState } from "@/lib/hooks/useTreeDragDrop";

interface ClassTreeProps {
  nodes: ClassTreeNode[];
  selectedIri?: string | null;
  onSelect: (iri: string) => void;
  onExpand: (iri: string) => void;
  onCollapse: (iri: string) => void;
  onAddChild?: (parentIri: string) => void;
  onCopyIri?: (iri: string) => void;
  onDelete?: (iri: string, label: string) => void;
  searchResults?: EntitySearchResult[] | null;
  isSearching?: boolean;
  onSearchSelect?: (iri: string) => void;
  draftIris?: Set<string>;
  dragState?: DragState;
  onDragEnterNode?: (iri: string) => void;
  onDragLeaveNode?: () => void;
}

export function ClassTree({
  nodes,
  selectedIri,
  onSelect,
  onExpand,
  onCollapse,
  onAddChild,
  onCopyIri,
  onDelete,
  searchResults,
  isSearching,
  onSearchSelect,
  draftIris,
  dragState,
  onDragEnterNode,
  onDragLeaveNode,
}: ClassTreeProps) {
  const entityNodes = useMemo(
    () => classTreeNodesToEntityNodes(nodes),
    [nodes],
  );

  if (searchResults !== null && searchResults !== undefined) {
    // Classes first, then properties and individuals, all as the same flat rows.
    const ordered = [
      ...searchResults.filter((r) => r.entity_type === "class"),
      ...searchResults.filter((r) => r.entity_type !== "class"),
    ];

    return (
      <div className="py-2">
        {isSearching ? (
          <div className="flex h-20 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
          </div>
        ) : ordered.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No results found
            </p>
          </div>
        ) : (
          ordered.map((result, index) => (
            <SearchResultItem
              key={`${result.iri}-${index}`}
              result={result}
              onSelect={onSearchSelect || onSelect}
            />
          ))
        )}
      </div>
    );
  }

  return (
    <EntityTree
      nodes={entityNodes}
      selectedIri={selectedIri}
      onSelect={onSelect}
      onExpand={onExpand}
      onCollapse={onCollapse}
      onAddChild={onAddChild}
      onCopyIri={onCopyIri}
      onDelete={onDelete}
      draftIris={draftIris}
      enableKeyboardNav
      dragState={dragState}
      onDragEnterNode={onDragEnterNode}
      onDragLeaveNode={onDragLeaveNode}
    />
  );
}

interface SearchResultItemProps {
  result: EntitySearchResult & ImportedMarker;
  onSelect: (iri: string) => void;
}

function SearchResultItem({ result, onSelect }: SearchResultItemProps) {
  const localName = getLocalName(result.iri);
  const showLocalName = localName !== result.label;

  const importedFrom = result.imported_from
    ? result.imported_from_label
      ? `${result.imported_from_label} (${result.imported_from})`
      : result.imported_from
    : null;

  return (
    <button
      className={cn("tree-item group w-full text-left", importedFrom && "text-slate-500 dark:text-slate-400")}
      style={{ paddingLeft: "8px" }}
      onClick={() => onSelect(result.iri)}
      data-imported={importedFrom ? "true" : undefined}
    >
      <EntityTypeIcon type={result.entity_type} className="h-4 w-4" />

      <div className="flex-1 min-w-0">
        <span className={cn("text-sm truncate block", result.deprecated && "line-through opacity-60")}>
          {result.label}
        </span>
        {showLocalName && (
          <span className="text-xs text-slate-400 dark:text-slate-500 truncate block">
            {localName}
          </span>
        )}
      </div>

      {importedFrom ? (
        <Tooltip content={`Imported from ${importedFrom}. Read-only here.`}>
          <span className="text-[8px] uppercase tracking-wider text-slate-300 dark:text-slate-600 flex-shrink-0">
            imported {result.entity_type}
          </span>
        </Tooltip>
      ) : (
        <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 flex-shrink-0">
          {result.entity_type}
        </span>
      )}
    </button>
  );
}
