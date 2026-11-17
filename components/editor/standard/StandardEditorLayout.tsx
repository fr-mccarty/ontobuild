"use client";

import { useState, useMemo, useCallback, useEffect, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { ClassTree } from "@/components/editor/ClassTree";
import { ClassDetailPanel, type TreeNodeFallback } from "@/components/editor/ClassDetailPanel";
import { EntityTabBar, type EntityTab } from "@/components/editor/standard/EntityTabBar";
import { PropertyTree } from "@/components/editor/standard/PropertyTree";
import { IndividualList } from "@/components/editor/standard/IndividualList";
import { PropertyDetailPanel } from "@/components/editor/PropertyDetailPanel";
import { IndividualDetailPanel } from "@/components/editor/IndividualDetailPanel";
import { ResizablePanelDivider } from "@/components/editor/ResizablePanelDivider";
import { EntityTreeToolbar } from "@/components/editor/shared/EntityTreeToolbar";
import { useTreeSearch } from "@/lib/hooks/useTreeSearch";
import { useFilteredTree } from "@/lib/hooks/useFilteredTree";
import { Share2, ArrowLeft } from "lucide-react";
import { DraggableTreeWrapper } from "@/components/editor/shared/DraggableTreeWrapper";
import { useTreeDragDrop, type DragMode } from "@/lib/hooks/useTreeDragDrop";
import { useToast } from "@/lib/context/ToastContext";
import { useSelectionStore } from "@/lib/stores/selectionStore";

const OntologyGraph = dynamic(
  () => import("@/components/graph/OntologyGraph").then((mod) => mod.OntologyGraph),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-white dark:bg-slate-800">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    ),
  }
);
import type { ClassUpdatePayload } from "@/lib/api/client";
import type { TurtlePropertyUpdateData } from "@/lib/ontology/turtlePropertyUpdater";
import type { TurtleIndividualUpdateData } from "@/lib/ontology/turtleIndividualUpdater";
import type { ClassTreeNode } from "@/lib/ontology/types";
import { useDraftStore } from "@/lib/stores/draftStore";
import { getLocalName } from "@/lib/utils";
import { extractTreeLabelMap } from "@/lib/graph/buildGraphData";
import { useAnnounce } from "@/components/ui/ScreenReaderAnnouncer";

export interface StandardEditorLayoutProps {
  projectId: string;
  activeBranch?: string;
  canEdit: boolean;

  nodes: ClassTreeNode[];
  isTreeLoading: boolean;
  treeError: string | null;
  /**
   * Renders a load error in the entity tree pane (the class tree, properties and individuals),
   * e.g. a "file isn't on this branch" notice. Defaults to the error text in a plain box.
   */
  renderTreeError?: (message: string) => ReactNode;
  selectedIri: string | null;
  selectNode: (iri: string) => void;
  expandNode: (iri: string) => void;
  collapseNode: (iri: string) => void;
  expandOneLevel: () => Promise<void>;
  expandAllFully: () => Promise<void>;
  collapseAll: () => void;
  collapseOneLevel: () => void;
  hasExpandableNodes: boolean;
  hasExpandedNodes: boolean;
  isExpandingAll: boolean;
  navigateToNode: (iri: string) => Promise<void>;

  onAddEntity: (parentIri?: string, entityType?: "individual") => void;
  onDeleteClass?: (iri: string, label: string) => void;
  onCopyIri?: (iri: string) => void;

  selectedNodeFallback: TreeNodeFallback | null;

  onUpdateClass?: (classIri: string, data: ClassUpdatePayload) => Promise<void>;
  detailRefreshKey?: number;

  sourceContent?: string;
  onUpdateProperty?: (propertyIri: string, data: TurtlePropertyUpdateData) => Promise<void>;
  onUpdateIndividual?: (individualIri: string, data: TurtleIndividualUpdateData) => Promise<void>;

  onReparentClass?: (classIri: string, oldParentIris: string[], newParentIris: string[], mode: DragMode) => Promise<void>;
  reparentOptimistic?: (iri: string, oldParentIri: string | null, newParentIri: string | null) => { previousNodes: ClassTreeNode[] };
  rollbackReparent?: (snapshot: { previousNodes: ClassTreeNode[] }) => void;

  entityNavigationRef?: React.RefObject<((iri: string, type?: string) => void) | null>;
  /** Filled with a function that clears the property or individual selection if it is one of the given IRIs. */
  entityRemovalRef?: React.RefObject<((iris: string[]) => void) | null>;

  /** Change to reload the property and individual lists in place. */
  entityListRefreshKey?: number;
  /** Change to remount the open detail panel so it re-reads the entity from scratch. */
  detailEpoch?: number;

  onActiveTabChange?: (tab: EntityTab) => void;

  /**
   * Whether the entity tree panel shows (default true). When hidden it stays mounted, so
   * its tab, search and expanded nodes survive, and selecting an entity (from the detail
   * panel or the agent) still updates it for when it opens again.
   */
  treePanelOpen?: boolean;
  /** Counts shown on the Classes / Properties / Individuals tabs. */
  entityCounts?: Partial<Record<EntityTab, number>>;
}

export function StandardEditorLayout(props: StandardEditorLayoutProps) {
  const {
    projectId,
    activeBranch,
    canEdit,
    nodes,
    isTreeLoading,
    treeError,
    renderTreeError,
    selectedIri,
    selectNode,
    expandNode,
    collapseNode,
    expandOneLevel,
    expandAllFully,
    collapseAll,
    collapseOneLevel,
    hasExpandableNodes,
    hasExpandedNodes,
    isExpandingAll,
    navigateToNode,
    onAddEntity,
    onDeleteClass,
    onCopyIri,
    selectedNodeFallback,
    onUpdateClass,
    detailRefreshKey,
    sourceContent,
    onUpdateProperty,
    onUpdateIndividual,
    onReparentClass,
    reparentOptimistic,
    rollbackReparent,
  } = props;

  const toast = useToast();
  const { announce } = useAnnounce();

  const getDraftIris = useDraftStore((s) => s.getDraftIris);
  const drafts = useDraftStore((s) => s.drafts);
  const draftIris = useMemo(
    () => new Set(getDraftIris(projectId, activeBranch || "main")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getDraftIris, projectId, activeBranch, drafts],
  );

  const treeLabelHints = useMemo(() => extractTreeLabelMap(nodes), [nodes]);
  const treeLabelHintsRecord = useMemo(() => Object.fromEntries(treeLabelHints), [treeLabelHints]);

  const handleDndReparent = useCallback(async (
    classIri: string,
    oldParentIris: string[],
    newParentIris: string[],
    mode: DragMode,
  ) => {
    if (!onReparentClass || !reparentOptimistic || !rollbackReparent) return;

    const oldTreeParent = oldParentIris[0] || null;
    const newTreeParent = newParentIris[0] || null;
    const snapshot = reparentOptimistic(classIri, oldTreeParent, newTreeParent);

    try {
      await onReparentClass(classIri, oldParentIris, newParentIris, mode);
    } catch (err) {
      rollbackReparent(snapshot);
      toast.error(
        "Failed to reparent class",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }, [onReparentClass, reparentOptimistic, rollbackReparent, toast]);

  const {
    dragState,
    undoAction,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    handleUndo,
    clearUndo,
    handleDragEnterNode,
    handleDragLeaveNode,
  } = useTreeDragDrop({
    nodes,
    canEdit,
    expandNode,
    onReparent: handleDndReparent,
    onAnnounce: announce,
  });

  useEffect(() => {
    if (undoAction) {
      const label = undoAction.classLabel || getLocalName(undoAction.classIri);
      const undoFn = handleUndo;
      toast.addToast({
        type: "success",
        title: `Moved "${label}"`,
        duration: 5000,
        action: {
          label: "Undo",
          onClick: undoFn,
        },
      });
      clearUndo();
    }
  }, [undoAction, toast, handleUndo, clearUndo]);

  const [treePanelWidth, setTreePanelWidth] = useState(320);

  const [showGraph, setShowGraph] = useState(false);

  const [activeTab, setActiveTab] = useState<EntityTab>("classes");

  const [selectedPropertyIri, setSelectedPropertyIri] = useState<string | null>(null);
  const [selectedIndividualIri, setSelectedIndividualIri] = useState<string | null>(null);

  const { entityNavigationRef, entityRemovalRef, navigateToNode: navToNode, onActiveTabChange } = props;
  const treePanelOpen = props.treePanelOpen ?? true;
  const entityListRefreshKey = props.entityListRefreshKey ?? 0;
  const detailEpoch = props.detailEpoch ?? 0;

  useEffect(() => {
    if (!entityRemovalRef) return;
    const handler = (iris: string[]) => {
      const removed = new Set(iris);
      setSelectedPropertyIri((prev) => (prev && removed.has(prev) ? null : prev));
      setSelectedIndividualIri((prev) => (prev && removed.has(prev) ? null : prev));
    };
    entityRemovalRef.current = handler;
    return () => {
      if (entityRemovalRef.current === handler) entityRemovalRef.current = null;
    };
  }, [entityRemovalRef]);

  useEffect(() => {
    onActiveTabChange?.(activeTab);
  }, [activeTab, onActiveTabChange]);
  useEffect(() => {
    if (!entityNavigationRef) return;

    const handler = (iri: string, type?: string) => {
      setShowGraph(false);
      if (type === "property") {
        setActiveTab("properties");
        setSelectedPropertyIri(iri);
      } else if (type === "individual") {
        setActiveTab("individuals");
        setSelectedIndividualIri(iri);
      } else {
        setActiveTab("classes");
        navToNode(iri);
      }
    };

    entityNavigationRef.current = handler;
    return () => {
      if (entityNavigationRef.current === handler) {
        entityNavigationRef.current = null;
      }
    };
  }, [entityNavigationRef, navToNode]);

  const setSelection = useSelectionStore((s) => s.setSelection);
  useEffect(() => {
    if (activeTab === "classes") {
      setSelection(selectedIri ?? null, selectedIri ? "class" : null);
    } else if (activeTab === "properties") {
      setSelection(selectedPropertyIri ?? null, selectedPropertyIri ? "property" : null);
    } else {
      setSelection(selectedIndividualIri ?? null, selectedIndividualIri ? "individual" : null);
    }
  }, [activeTab, selectedIri, selectedPropertyIri, selectedIndividualIri, setSelection]);

  const {
    showSearch,
    searchQuery,
    searchResults,
    isSearching,
    searchInputRef,
    toggleSearch,
    closeSearch,
    setSearchQuery,
    handleSearchSelect: baseSearchSelect,
  } = useTreeSearch({
    projectId,
    branch: activeBranch,
    onSearchSelect: navigateToNode,
  });

  const { filteredNodes, isBuilding: isFilteredTreeBuilding, truncated: filteredTreeTruncated } = useFilteredTree({
    searchResults: showSearch ? searchResults : null,
    projectId,
    branch: activeBranch,
  });

  const handleSearchSelect = (iri: string) => {
    baseSearchSelect(iri);
    closeSearch();
  };

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div
        data-testid="entity-tree-panel"
        hidden={!treePanelOpen}
        className="flex-shrink-0 bg-white dark:bg-slate-800"
        style={{ width: treePanelWidth }}
      >
        <EntityTabBar activeTab={activeTab} onTabChange={setActiveTab} counts={props.entityCounts} />

        <EntityTreeToolbar
          canAdd={canEdit && activeTab === "classes"}
          onAdd={() => onAddEntity()}
          showSearch={showSearch}
          searchQuery={searchQuery}
          onToggleSearch={toggleSearch}
          onSearchChange={setSearchQuery}
          onCloseSearch={closeSearch}
          searchInputRef={searchInputRef}
          onExpandOneLevel={activeTab === "classes" ? expandOneLevel : undefined}
          onExpandAllFully={activeTab === "classes" ? expandAllFully : undefined}
          onCollapseAll={activeTab === "classes" ? collapseAll : undefined}
          onCollapseOneLevel={activeTab === "classes" ? collapseOneLevel : undefined}
          hasExpandableNodes={activeTab === "classes" ? hasExpandableNodes : false}
          hasExpandedNodes={activeTab === "classes" ? hasExpandedNodes : false}
          isExpandingAll={activeTab === "classes" ? isExpandingAll : false}
        />

        <div className="h-[calc(100%-5.5rem)] overflow-y-auto">
          {activeTab === "classes" && (
            <>
              {isTreeLoading && nodes.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
                </div>
              ) : treeError ? (
                renderTreeError ? (
                  renderTreeError(treeError)
                ) : (
                  <div className="p-4">
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center dark:border-red-900/50 dark:bg-red-900/20">
                      <p className="text-sm text-red-700 dark:text-red-400">{treeError}</p>
                    </div>
                  </div>
                )
              ) : nodes.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No classes found in this ontology
                  </p>
                </div>
              ) : (
                <DraggableTreeWrapper
                  isDragActive={dragState.isDragActive}
                  draggedLabel={dragState.draggedLabel}
                  dragMode={dragState.dragMode}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                >
                  <ClassTree
                    nodes={nodes}
                    selectedIri={selectedIri}
                    onSelect={selectNode}
                    onExpand={expandNode}
                    onCollapse={collapseNode}
                    onAddChild={canEdit ? (parentIri: string) => onAddEntity(parentIri) : undefined}
                    onCopyIri={onCopyIri}
                    onDelete={canEdit ? onDeleteClass : undefined}
                    searchResults={showSearch ? searchResults : undefined}
                    isSearching={isSearching}
                    onSearchSelect={handleSearchSelect}
                    searchQuery={searchQuery}
                    draftIris={draftIris}
                    filteredTree={filteredNodes}
                    isFilteredTreeBuilding={isFilteredTreeBuilding}
                    filteredTreeTruncated={filteredTreeTruncated}
                    dragState={!showSearch && canEdit ? dragState : undefined}
                    onDragEnterNode={handleDragEnterNode}
                    onDragLeaveNode={handleDragLeaveNode}
                  />
                </DraggableTreeWrapper>
              )}
            </>
          )}

          {activeTab === "properties" && (
            <PropertyTree
              projectId={projectId}
              branch={activeBranch}
              selectedIri={selectedPropertyIri}
              onSelect={setSelectedPropertyIri}
              refreshKey={entityListRefreshKey}
              renderError={renderTreeError}
            />
          )}

          {activeTab === "individuals" && (
            <IndividualList
              projectId={projectId}
              branch={activeBranch}
              selectedIri={selectedIndividualIri}
              onSelect={setSelectedIndividualIri}
              refreshKey={entityListRefreshKey}
              renderError={renderTreeError}
            />
          )}
        </div>
      </div>

      {treePanelOpen && (
        <ResizablePanelDivider
          width={treePanelWidth}
          onWidthChange={setTreePanelWidth}
          minWidth={200}
          maxWidth={600}
        />
      )}

      <div className="min-w-0 flex-1 bg-white dark:bg-slate-800" data-entity-detail-panel>
        {showGraph ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 dark:border-slate-700">
              <button
                onClick={() => setShowGraph(false)}
                className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                aria-label="Back to details"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Details
              </button>
            </div>
            <div className="flex-1">
              <OntologyGraph
                focusIri={selectedIri}
                projectId={projectId}
                branch={activeBranch}
                labelHints={treeLabelHints}
                onNavigateToClass={(iri) => {
                  setShowGraph(false);
                  navigateToNode(iri);
                }}
              />
            </div>
          </div>
        ) : activeTab === "classes" ? (
          <ClassDetailPanel
            key={`${selectedIri ?? "no-class"}:${detailEpoch}`}
            projectId={projectId}
            classIri={selectedIri}
            branch={activeBranch}
            onNavigateToClass={(iri) => navigateToNode(iri)}
            onCopyIri={onCopyIri}
            selectedNodeFallback={selectedNodeFallback}
            canEdit={canEdit}
            onUpdateClass={onUpdateClass}
            onAddIndividual={canEdit ? (iri: string) => onAddEntity(iri, "individual") : undefined}
            onNavigateToIndividual={(iri: string) => { setActiveTab("individuals"); setSelectedIndividualIri(iri); }}
            refreshKey={detailRefreshKey}
            headerActions={selectedIri ? (
              <button
                onClick={() => setShowGraph(true)}
                className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
                aria-label="Show relationship graph"
              >
                <Share2 className="h-3.5 w-3.5" />
                Graph
              </button>
            ) : undefined}
          />
        ) : activeTab === "properties" ? (
          <PropertyDetailPanel
            key={`${selectedPropertyIri ?? "no-property"}:${detailEpoch}`}
            projectId={projectId}
            propertyIri={selectedPropertyIri}
            sourceContent={sourceContent || ""}
            canEdit={canEdit}
            onUpdateProperty={onUpdateProperty}
            branch={activeBranch}
            refreshKey={detailRefreshKey}
            onNavigateToEntity={(iri) => navigateToNode(iri)}
            onCopyIri={onCopyIri}
            labelHints={treeLabelHintsRecord}
          />
        ) : (
          <IndividualDetailPanel
            key={`${selectedIndividualIri ?? "no-individual"}:${detailEpoch}`}
            projectId={projectId}
            individualIri={selectedIndividualIri}
            sourceContent={sourceContent || ""}
            canEdit={canEdit}
            onUpdateIndividual={onUpdateIndividual}
            branch={activeBranch}
            refreshKey={detailRefreshKey}
            onNavigateToEntity={(iri) => navigateToNode(iri)}
            onCopyIri={onCopyIri}
            labelHints={treeLabelHintsRecord}
          />
        )}
      </div>
    </div>
  );
}
