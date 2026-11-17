import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import React from "react";

import { useSelectionStore } from "@/lib/stores/selectionStore";

vi.hoisted(() => {
  if (!globalThis.localStorage || typeof globalThis.localStorage.setItem !== "function") {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (index: number) => [...store.keys()][index] ?? null,
    };
  }
});

vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => () => <div data-testid="ontology-graph" />,
}));

let _classTreeProps: Record<string, unknown> = {};
vi.mock("@/components/editor/ClassTree", () => ({
  ClassTree: (props: Record<string, unknown>) => {
    _classTreeProps = props;
    return <div data-testid="class-tree" data-selected={props.selectedIri} />;
  },
}));

let _classDetailProps: Record<string, unknown> = {};
let _classDetailMounts = 0;
vi.mock("@/components/editor/ClassDetailPanel", () => ({
  ClassDetailPanel: (props: Record<string, unknown>) => {
    _classDetailProps = props;
    React.useEffect(() => { _classDetailMounts++; }, []);
    return (
      <div data-testid="class-detail-panel">
        {props.headerActions as React.ReactNode}
      </div>
    );
  },
}));

vi.mock("@/components/editor/standard/EntityTabBar", () => ({
  EntityTabBar: (props: Record<string, unknown>) => (
    <div data-testid="entity-tab-bar" data-counts={JSON.stringify(props.counts ?? null)}>
      <button onClick={() => (props.onTabChange as (id: string) => void)?.("classes")}>Classes</button>
      <button onClick={() => (props.onTabChange as (id: string) => void)?.("properties")}>Properties</button>
      <button onClick={() => (props.onTabChange as (id: string) => void)?.("individuals")}>Individuals</button>
    </div>
  ),
}));

let _propertyTreeProps: Record<string, unknown> = {};
vi.mock("@/components/editor/standard/PropertyTree", () => ({
  PropertyTree: (props: Record<string, unknown>) => {
    _propertyTreeProps = props;
    return <div data-testid="property-tree" />;
  },
}));

let _individualListProps: Record<string, unknown> = {};
vi.mock("@/components/editor/standard/IndividualList", () => ({
  IndividualList: (props: Record<string, unknown>) => {
    _individualListProps = props;
    return <div data-testid="individual-list" />;
  },
}));

let _propertyDetailProps: Record<string, unknown> = {};
vi.mock("@/components/editor/PropertyDetailPanel", () => ({
  PropertyDetailPanel: (props: Record<string, unknown>) => {
    _propertyDetailProps = props;
    return <div data-testid="property-detail-panel" />;
  },
}));

let _individualDetailProps: Record<string, unknown> = {};
vi.mock("@/components/editor/IndividualDetailPanel", () => ({
  IndividualDetailPanel: (props: Record<string, unknown>) => {
    _individualDetailProps = props;
    return <div data-testid="individual-detail-panel" />;
  },
}));

vi.mock("@/components/editor/ResizablePanelDivider", () => ({
  ResizablePanelDivider: () => <div data-testid="panel-divider" />,
}));

let _toolbarProps: Record<string, unknown> = {};
vi.mock("@/components/editor/shared/EntityTreeToolbar", () => ({
  EntityTreeToolbar: (props: Record<string, unknown>) => {
    _toolbarProps = props;
    return <div data-testid="entity-tree-toolbar" />;
  },
}));

vi.mock("@/components/editor/shared/DraggableTreeWrapper", () => ({
  DraggableTreeWrapper: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="draggable-wrapper">{children}</div>
  ),
}));

const _closeSearchFn = vi.fn();
const _baseSearchSelectFn = vi.fn();
let _useTreeSearchOverride: Record<string, unknown> | null = null;
vi.mock("@/lib/hooks/useTreeSearch", () => ({
  useTreeSearch: () => (_useTreeSearchOverride ?? {
    showSearch: false,
    searchQuery: "",
    searchResults: [],
    isSearching: false,
    searchInputRef: { current: null },
    toggleSearch: vi.fn(),
    closeSearch: _closeSearchFn,
    setSearchQuery: vi.fn(),
    handleSearchSelect: _baseSearchSelectFn,
  }),
}));

vi.mock("@/lib/hooks/useFilteredTree", () => ({
  useFilteredTree: () => ({
    filteredNodes: null,
    isBuilding: false,
    truncated: false,
  }),
}));

let _useTreeDragDropOverride: Record<string, unknown> | null = null;
let _lastDragDropOptions: Record<string, unknown> | null = null;
vi.mock("@/lib/hooks/useTreeDragDrop", () => ({
  useTreeDragDrop: (opts: Record<string, unknown>) => {
    _lastDragDropOptions = opts;
    return (_useTreeDragDropOverride ?? {
      dragState: {
        draggedIri: null,
        draggedLabel: null,
        dropTargetIri: null,
        isValidDropTarget: false,
        isDragActive: false,
        dragMode: "move",
      },
      undoAction: null,
      handleDragStart: vi.fn(),
      handleDragOver: vi.fn(),
      handleDragEnd: vi.fn(),
      handleDragCancel: vi.fn(),
      handleUndo: vi.fn(),
      clearUndo: vi.fn(),
      handleDragEnterNode: vi.fn(),
      handleDragLeaveNode: vi.fn(),
    });
  },
}));

const _toastErrorFn = vi.fn();
const _toastAddFn = vi.fn();
vi.mock("@/lib/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: _toastErrorFn,
    info: vi.fn(),
    addToast: _toastAddFn,
  }),
}));

vi.mock("@/lib/stores/draftStore", () => ({
  useDraftStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      getDraftIris: () => [],
      drafts: {},
      getDraft: vi.fn(),
      setDraft: vi.fn(),
      removeDraft: vi.fn(),
      hasDraft: vi.fn(() => false),
    }),
}));

vi.mock("@/lib/graph/buildGraphData", () => ({
  extractTreeLabelMap: vi.fn(() => new Map()),
}));

vi.mock("@/components/ui/ScreenReaderAnnouncer", () => ({
  useAnnounce: () => ({ announce: vi.fn() }),
}));

import { StandardEditorLayout, type StandardEditorLayoutProps } from "@/components/editor/standard/StandardEditorLayout";
import type { ClassTreeNode } from "@/lib/ontology/types";

function defaultProps(overrides: Partial<StandardEditorLayoutProps> = {}): StandardEditorLayoutProps {
  return {
    projectId: "proj-1",
    activeBranch: "main",
    canEdit: false,
    nodes: [],
    isTreeLoading: false,
    treeError: null,
    selectedIri: null,
    selectNode: vi.fn(),
    expandNode: vi.fn(),
    collapseNode: vi.fn(),
    expandOneLevel: vi.fn().mockResolvedValue(undefined),
    expandAllFully: vi.fn().mockResolvedValue(undefined),
    collapseAll: vi.fn(),
    collapseOneLevel: vi.fn(),
    hasExpandableNodes: false,
    hasExpandedNodes: false,
    isExpandingAll: false,
    navigateToNode: vi.fn().mockResolvedValue(undefined),
    onAddEntity: vi.fn(),
    selectedNodeFallback: null,
    ...overrides,
  };
}

const sampleNodes: ClassTreeNode[] = [
  {
    iri: "http://example.org/ClassA",
    label: "Class A",
    children: [],
    isExpanded: false,
    isLoading: false,
    hasChildren: false,
  },
];

describe("StandardEditorLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _useTreeSearchOverride = null;
    _useTreeDragDropOverride = null;
    _lastDragDropOptions = null;
    _toolbarProps = {};
    _classTreeProps = {};
    _classDetailProps = {};
    _propertyTreeProps = {};
    _individualListProps = {};
    _propertyDetailProps = {};
    _individualDetailProps = {};
  });

  it("renders entity tab bar", () => {
    render(<StandardEditorLayout {...defaultProps()} />);
    expect(screen.getByTestId("entity-tab-bar")).toBeDefined();
  });

  it("passes entity counts to the tab bar", () => {
    render(<StandardEditorLayout {...defaultProps({ entityCounts: { classes: 3, individuals: 0 } })} />);
    expect(JSON.parse(screen.getByTestId("entity-tab-bar").getAttribute("data-counts")!)).toEqual({ classes: 3, individuals: 0 });
  });

  it("renders entity tree toolbar", () => {
    render(<StandardEditorLayout {...defaultProps()} />);
    expect(screen.getByTestId("entity-tree-toolbar")).toBeDefined();
  });

  it("renders panel divider", () => {
    render(<StandardEditorLayout {...defaultProps()} />);
    expect(screen.getByTestId("panel-divider")).toBeDefined();
  });

  it("hides the tree panel and its divider when treePanelOpen is false, keeping the tree mounted", () => {
    const props = defaultProps({ treePanelOpen: false, nodes: sampleNodes });
    const { rerender } = render(<StandardEditorLayout {...props} />);
    expect(screen.getByTestId("entity-tree-panel").hidden).toBe(true);
    expect(screen.queryByTestId("panel-divider")).toBeNull();
    expect(Object.keys(_classTreeProps).length).toBeGreaterThan(0);

    rerender(<StandardEditorLayout {...props} treePanelOpen />);
    expect(screen.getByTestId("entity-tree-panel").hidden).toBe(false);
    expect(screen.getByTestId("panel-divider")).toBeDefined();
  });

  it("still navigates to an entity while the tree panel is hidden", () => {
    const ref = { current: null } as React.RefObject<((iri: string, type?: string) => void) | null>;
    const props = defaultProps({ treePanelOpen: false, entityNavigationRef: ref });
    render(<StandardEditorLayout {...props} />);
    act(() => ref.current!("http://example.org/Foo", "class"));
    expect(props.navigateToNode).toHaveBeenCalledWith("http://example.org/Foo");
  });

  it("shows loading spinner when tree is loading and no nodes", () => {
    render(<StandardEditorLayout {...defaultProps({ isTreeLoading: true, nodes: [] })} />);
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });

  it("shows error message when treeError is set", () => {
    render(<StandardEditorLayout {...defaultProps({ treeError: "Something went wrong" })} />);
    expect(screen.getByText("Something went wrong")).toBeDefined();
  });

  it("renders the tree error with renderTreeError when given", () => {
    const renderTreeError = vi.fn((message: string) => <div data-testid="custom-tree-error">{`custom: ${message}`}</div>);
    render(<StandardEditorLayout {...defaultProps({ treeError: "File missing", renderTreeError })} />);
    expect(screen.getByTestId("custom-tree-error").textContent).toBe("custom: File missing");
    expect(renderTreeError).toHaveBeenCalledWith("File missing");
  });

  it("shows empty message when no classes found", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: [], isTreeLoading: false })} />);
    expect(screen.getByText("No classes found in this ontology")).toBeDefined();
  });

  it("renders class tree when nodes exist", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    expect(screen.getByTestId("class-tree")).toBeDefined();
    expect(screen.getByTestId("draggable-wrapper")).toBeDefined();
  });

  it("renders ClassDetailPanel when classes tab is active (default)", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    expect(screen.getByTestId("class-detail-panel")).toBeDefined();
  });

  it("shows PropertyTree and PropertyDetailPanel when properties tab selected", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    fireEvent.click(screen.getByText("Properties"));
    expect(screen.getByTestId("property-tree")).toBeDefined();
    expect(screen.getByTestId("property-detail-panel")).toBeDefined();
  });

  it("shows IndividualList and IndividualDetailPanel when individuals tab selected", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    fireEvent.click(screen.getByText("Individuals"));
    expect(screen.getByTestId("individual-list")).toBeDefined();
    expect(screen.getByTestId("individual-detail-panel")).toBeDefined();
  });

  it("switches back to classes tab", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    fireEvent.click(screen.getByText("Properties"));
    expect(screen.getByTestId("property-tree")).toBeDefined();
    fireEvent.click(screen.getByText("Classes"));
    expect(screen.getByTestId("class-tree")).toBeDefined();
    expect(screen.getByTestId("class-detail-panel")).toBeDefined();
  });

  it("has no Graph button in the class header: the graph opens from the sub-header's More menu", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, selectedIri: "http://example.org/ClassA" })}
      />
    );
    expect(screen.queryByText("Graph")).toBeNull();
    expect(_classDetailProps.headerActions).toBeUndefined();
  });

  it("shows the graph when the page asks for it", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, selectedIri: "http://example.org/ClassA" })}
        showGraph
      />
    );
    expect(screen.getByTestId("ontology-graph")).toBeDefined();
    expect(screen.getByText("Back to Details")).toBeDefined();
  });

  it("asks the page to close the graph via the Back button", () => {
    const onShowGraphChange = vi.fn();
    const { rerender } = render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, selectedIri: "http://example.org/ClassA" })}
        showGraph
        onShowGraphChange={onShowGraphChange}
      />
    );
    fireEvent.click(screen.getByText("Back to Details"));
    expect(onShowGraphChange).toHaveBeenCalledWith(false);
    rerender(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, selectedIri: "http://example.org/ClassA" })}
        showGraph={false}
        onShowGraphChange={onShowGraphChange}
      />
    );
    expect(screen.getByTestId("class-detail-panel")).toBeDefined();
  });

  it("renders with minimal props", () => {
    render(<StandardEditorLayout {...defaultProps()} />);
    expect(screen.getByTestId("entity-tab-bar")).toBeDefined();
  });

  it("does not show tree when properties tab is active", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    fireEvent.click(screen.getByText("Properties"));
    expect(screen.queryByTestId("class-tree")).toBeNull();
  });

  it("passes expand/collapse callbacks to toolbar on classes tab", () => {
    const expandOneLevel = vi.fn().mockResolvedValue(undefined);
    const expandAllFully = vi.fn().mockResolvedValue(undefined);
    const collapseAll = vi.fn();
    const collapseOneLevel = vi.fn();
    render(
      <StandardEditorLayout
        {...defaultProps({
          nodes: sampleNodes,
          expandOneLevel,
          expandAllFully,
          collapseAll,
          collapseOneLevel,
          hasExpandableNodes: true,
          hasExpandedNodes: true,
          isExpandingAll: false,
        })}
      />
    );
    expect(_toolbarProps.onExpandOneLevel).toBe(expandOneLevel);
    expect(_toolbarProps.onExpandAllFully).toBe(expandAllFully);
    expect(_toolbarProps.onCollapseAll).toBe(collapseAll);
    expect(_toolbarProps.onCollapseOneLevel).toBe(collapseOneLevel);
    expect(_toolbarProps.hasExpandableNodes).toBe(true);
    expect(_toolbarProps.hasExpandedNodes).toBe(true);
    expect(_toolbarProps.isExpandingAll).toBe(false);
  });

  it("passes undefined expand/collapse to toolbar on properties tab", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    fireEvent.click(screen.getByText("Properties"));
    expect(_toolbarProps.onExpandOneLevel).toBeUndefined();
    expect(_toolbarProps.onExpandAllFully).toBeUndefined();
    expect(_toolbarProps.onCollapseAll).toBeUndefined();
    expect(_toolbarProps.onCollapseOneLevel).toBeUndefined();
    expect(_toolbarProps.hasExpandableNodes).toBe(false);
    expect(_toolbarProps.hasExpandedNodes).toBe(false);
    expect(_toolbarProps.isExpandingAll).toBe(false);
  });

  it("passes undefined expand/collapse to toolbar on individuals tab", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    fireEvent.click(screen.getByText("Individuals"));
    expect(_toolbarProps.onExpandOneLevel).toBeUndefined();
    expect(_toolbarProps.hasExpandableNodes).toBe(false);
  });

  it("sets canAdd=true on toolbar only for classes tab with canEdit", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes, canEdit: true })} />);
    expect(_toolbarProps.canAdd).toBe(true);
    fireEvent.click(screen.getByText("Properties"));
    expect(_toolbarProps.canAdd).toBe(false);
  });

  it("sets canAdd=false on toolbar when canEdit is false", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes, canEdit: false })} />);
    expect(_toolbarProps.canAdd).toBe(false);
  });

  it("forwards detailRefreshKey to ClassDetailPanel", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, detailRefreshKey: 42 })}
      />
    );
    expect(_classDetailProps.refreshKey).toBe(42);
  });

  it("forwards sourceContent and callbacks to PropertyDetailPanel", () => {
    const onUpdateProperty = vi.fn();
    const onCopyIri = vi.fn();
    render(
      <StandardEditorLayout
        {...defaultProps({
          nodes: sampleNodes,
          sourceContent: "@prefix ex: <http://example.org/> .",
          onUpdateProperty,
          onCopyIri,
          detailRefreshKey: 7,
          canEdit: true,
        })}
      />
    );
    fireEvent.click(screen.getByText("Properties"));
    expect(_propertyDetailProps.sourceContent).toBe("@prefix ex: <http://example.org/> .");
    expect(_propertyDetailProps.onUpdateProperty).toBe(onUpdateProperty);
    expect(_propertyDetailProps.onCopyIri).toBe(onCopyIri);
    expect(_propertyDetailProps.canEdit).toBe(true);
    expect(_propertyDetailProps.refreshKey).toBe(7);
  });

  it("forwards sourceContent and callbacks to IndividualDetailPanel", () => {
    const onUpdateIndividual = vi.fn();
    const onCopyIri = vi.fn();
    render(
      <StandardEditorLayout
        {...defaultProps({
          nodes: sampleNodes,
          sourceContent: "@prefix ex: <http://example.org/> .",
          onUpdateIndividual,
          onCopyIri,
          detailRefreshKey: 9,
          canEdit: true,
        })}
      />
    );
    fireEvent.click(screen.getByText("Individuals"));
    expect(_individualDetailProps.sourceContent).toBe("@prefix ex: <http://example.org/> .");
    expect(_individualDetailProps.onUpdateIndividual).toBe(onUpdateIndividual);
    expect(_individualDetailProps.onCopyIri).toBe(onCopyIri);
    expect(_individualDetailProps.canEdit).toBe(true);
    expect(_individualDetailProps.refreshKey).toBe(9);
  });

  it("defaults sourceContent to empty string when undefined", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, sourceContent: undefined })}
      />
    );
    fireEvent.click(screen.getByText("Properties"));
    expect(_propertyDetailProps.sourceContent).toBe("");
  });

  it("forwards projectId and branch to PropertyTree", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, activeBranch: "dev" })}
      />
    );
    fireEvent.click(screen.getByText("Properties"));
    expect(_propertyTreeProps.projectId).toBe("proj-1");
    expect(_propertyTreeProps.branch).toBe("dev");
  });

  it("forwards projectId and branch to IndividualList", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, activeBranch: "feature" })}
      />
    );
    fireEvent.click(screen.getByText("Individuals"));
    expect(_individualListProps.projectId).toBe("proj-1");
    expect(_individualListProps.branch).toBe("feature");
  });

  it("passes selectedPropertyIri=null initially to PropertyTree", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    fireEvent.click(screen.getByText("Properties"));
    expect(_propertyTreeProps.selectedIri).toBeNull();
    expect(_propertyDetailProps.propertyIri).toBeNull();
  });

  it("passes selectedIndividualIri=null initially to IndividualList", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    fireEvent.click(screen.getByText("Individuals"));
    expect(_individualListProps.selectedIri).toBeNull();
    expect(_individualDetailProps.individualIri).toBeNull();
  });

  it("passes onDelete to ClassTree when canEdit is true", () => {
    const onDeleteClass = vi.fn();
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, canEdit: true, onDeleteClass })}
      />
    );
    expect(_classTreeProps.onDelete).toBe(onDeleteClass);
  });

  it("passes undefined onDelete to ClassTree when canEdit is false", () => {
    const onDeleteClass = vi.fn();
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, canEdit: false, onDeleteClass })}
      />
    );
    expect(_classTreeProps.onDelete).toBeUndefined();
  });

  it("passes onAddChild to ClassTree when canEdit is true", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, canEdit: true })}
      />
    );
    expect(_classTreeProps.onAddChild).toBeDefined();
  });

  it("passes undefined onAddChild to ClassTree when canEdit is false", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, canEdit: false })}
      />
    );
    expect(_classTreeProps.onAddChild).toBeUndefined();
  });

  it("passes onCopyIri to ClassTree", () => {
    const onCopyIri = vi.fn();
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, onCopyIri })}
      />
    );
    expect(_classTreeProps.onCopyIri).toBe(onCopyIri);
  });

  it("passes draftIris set to ClassTree", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    expect(_classTreeProps.draftIris).toBeInstanceOf(Set);
  });

  it("passes dragState to ClassTree when search is not active", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, canEdit: true })}
      />
    );
    expect(_classTreeProps.dragState).toBeDefined();
  });

  it("passes canEdit to useTreeDragDrop", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, canEdit: true })}
      />
    );
    expect(_lastDragDropOptions).not.toBeNull();
    expect(_lastDragDropOptions!.canEdit).toBe(true);
  });

  it("shows tree when loading but nodes already exist", () => {
    render(
      <StandardEditorLayout
        {...defaultProps({ isTreeLoading: true, nodes: sampleNodes })}
      />
    );
    expect(screen.getByTestId("class-tree")).toBeDefined();
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("fires addToast when undoAction is set", () => {
    const clearUndoFn = vi.fn();
    _useTreeDragDropOverride = {
      dragState: {
        draggedIri: null,
        draggedLabel: null,
        dropTargetIri: null,
        isValidDropTarget: false,
        isDragActive: false,
        dragMode: "move",
      },
      undoAction: {
        classIri: "http://example.org/Moved",
        classLabel: "Moved Class",
        oldParentIris: ["http://example.org/OldParent"],
        newParentIris: ["http://example.org/NewParent"],
      },
      handleDragStart: vi.fn(),
      handleDragOver: vi.fn(),
      handleDragEnd: vi.fn(),
      handleDragCancel: vi.fn(),
      handleUndo: vi.fn(),
      clearUndo: clearUndoFn,
      handleDragEnterNode: vi.fn(),
      handleDragLeaveNode: vi.fn(),
    };
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    expect(_toastAddFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: 'Moved "Moved Class"',
      })
    );
    expect(clearUndoFn).toHaveBeenCalled();
  });

  it("uses local name from IRI when undoAction has no classLabel", () => {
    _useTreeDragDropOverride = {
      dragState: {
        draggedIri: null,
        draggedLabel: null,
        dropTargetIri: null,
        isValidDropTarget: false,
        isDragActive: false,
        dragMode: "move",
      },
      undoAction: {
        classIri: "http://example.org/MyEntity",
        classLabel: "",
        oldParentIris: [],
        newParentIris: [],
      },
      handleDragStart: vi.fn(),
      handleDragOver: vi.fn(),
      handleDragEnd: vi.fn(),
      handleDragCancel: vi.fn(),
      handleUndo: vi.fn(),
      clearUndo: vi.fn(),
      handleDragEnterNode: vi.fn(),
      handleDragLeaveNode: vi.fn(),
    };
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    expect(_toastAddFn).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Moved "MyEntity"',
      })
    );
  });

  it("calls rollbackReparent and toast.error when onReparentClass rejects", async () => {
    const reparentError = new Error("Server error");
    const onReparentClass = vi.fn().mockRejectedValue(reparentError);
    const reparentOptimistic = vi.fn().mockReturnValue({ previousNodes: sampleNodes });
    const rollbackReparent = vi.fn();

    _useTreeDragDropOverride = null;
    render(
      <StandardEditorLayout
        {...defaultProps({
          nodes: sampleNodes,
          canEdit: true,
          onReparentClass,
          reparentOptimistic,
          rollbackReparent,
        })}
      />
    );

    expect(_lastDragDropOptions).not.toBeNull();
    const capturedOnReparent = _lastDragDropOptions!.onReparent as (
      classIri: string,
      oldParentIris: string[],
      newParentIris: string[],
      mode: string,
    ) => Promise<void>;
    expect(capturedOnReparent).toBeDefined();

    await capturedOnReparent(
      "http://example.org/ClassA",
      ["http://example.org/OldParent"],
      ["http://example.org/NewParent"],
      "move",
    );

    expect(reparentOptimistic).toHaveBeenCalledWith(
      "http://example.org/ClassA",
      "http://example.org/OldParent",
      "http://example.org/NewParent",
    );
    expect(onReparentClass).toHaveBeenCalled();
    expect(rollbackReparent).toHaveBeenCalledWith({ previousNodes: sampleNodes });
    expect(_toastErrorFn).toHaveBeenCalledWith("Failed to reparent class", "Server error");
  });

  it("does nothing in handleDndReparent when reparent callbacks are not provided", async () => {
    render(
      <StandardEditorLayout
        {...defaultProps({
          nodes: sampleNodes,
          canEdit: true,
          onReparentClass: undefined,
          reparentOptimistic: undefined,
          rollbackReparent: undefined,
        })}
      />
    );

    const capturedOnReparent = _lastDragDropOptions!.onReparent as (
      classIri: string,
      oldParentIris: string[],
      newParentIris: string[],
      mode: string,
    ) => Promise<void>;

    await capturedOnReparent(
      "http://example.org/ClassA",
      ["http://example.org/OldParent"],
      ["http://example.org/NewParent"],
      "move",
    );
  });

  it("calls reparentOptimistic with null when parentIris arrays are empty", async () => {
    const onReparentClass = vi.fn().mockResolvedValue(undefined);
    const reparentOptimistic = vi.fn().mockReturnValue({ previousNodes: [] });
    const rollbackReparent = vi.fn();

    render(
      <StandardEditorLayout
        {...defaultProps({
          nodes: sampleNodes,
          canEdit: true,
          onReparentClass,
          reparentOptimistic,
          rollbackReparent,
        })}
      />
    );

    const capturedOnReparent = _lastDragDropOptions!.onReparent as (
      classIri: string,
      oldParentIris: string[],
      newParentIris: string[],
      mode: string,
    ) => Promise<void>;

    await capturedOnReparent("http://example.org/ClassA", [], [], "move");

    expect(reparentOptimistic).toHaveBeenCalledWith(
      "http://example.org/ClassA",
      null,
      null,
    );
    expect(rollbackReparent).not.toHaveBeenCalled();
  });

  it("passes onNavigateToClass to ClassDetailPanel", () => {
    const navigateToNode = vi.fn().mockResolvedValue(undefined);
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, navigateToNode })}
      />
    );
    expect(_classDetailProps.onNavigateToClass).toBeDefined();
    (_classDetailProps.onNavigateToClass as (iri: string) => void)("http://example.org/Target");
    expect(navigateToNode).toHaveBeenCalledWith("http://example.org/Target");
  });

  it("passes onNavigateToEntity to PropertyDetailPanel", () => {
    const navigateToNode = vi.fn().mockResolvedValue(undefined);
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, navigateToNode })}
      />
    );
    fireEvent.click(screen.getByText("Properties"));
    expect(_propertyDetailProps.onNavigateToEntity).toBeDefined();
    (_propertyDetailProps.onNavigateToEntity as (iri: string) => void)("http://example.org/Prop");
    expect(navigateToNode).toHaveBeenCalledWith("http://example.org/Prop");
  });

  it("passes onNavigateToEntity to IndividualDetailPanel", () => {
    const navigateToNode = vi.fn().mockResolvedValue(undefined);
    render(
      <StandardEditorLayout
        {...defaultProps({ nodes: sampleNodes, navigateToNode })}
      />
    );
    fireEvent.click(screen.getByText("Individuals"));
    expect(_individualDetailProps.onNavigateToEntity).toBeDefined();
    (_individualDetailProps.onNavigateToEntity as (iri: string) => void)("http://example.org/Ind");
    expect(navigateToNode).toHaveBeenCalledWith("http://example.org/Ind");
  });

  it("sets initial tree panel width to 320px", () => {
    const { container } = render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    const treePanel = container.querySelector("[style]");
    expect(treePanel).not.toBeNull();
    expect(treePanel!.getAttribute("style")).toContain("width: 320px");
  });

  it("does not pass searchResults to ClassTree when search is hidden", () => {
    render(<StandardEditorLayout {...defaultProps({ nodes: sampleNodes })} />);
    expect(_classTreeProps.searchResults).toBeUndefined();
  });

  it("works with undefined activeBranch", () => {
    render(<StandardEditorLayout {...defaultProps({ activeBranch: undefined })} />);
    expect(screen.getByTestId("entity-tab-bar")).toBeDefined();
  });

  it("shows 'Unknown error' toast when reparent throws non-Error", async () => {
    const onReparentClass = vi.fn().mockRejectedValue("string error");
    const reparentOptimistic = vi.fn().mockReturnValue({ previousNodes: [] });
    const rollbackReparent = vi.fn();

    render(
      <StandardEditorLayout
        {...defaultProps({
          nodes: sampleNodes,
          canEdit: true,
          onReparentClass,
          reparentOptimistic,
          rollbackReparent,
        })}
      />
    );

    const capturedOnReparent = _lastDragDropOptions!.onReparent as (
      classIri: string,
      oldParentIris: string[],
      newParentIris: string[],
      mode: string,
    ) => Promise<void>;

    await capturedOnReparent(
      "http://example.org/ClassA",
      ["http://example.org/Old"],
      ["http://example.org/New"],
      "move",
    );

    expect(_toastErrorFn).toHaveBeenCalledWith("Failed to reparent class", "Unknown error");
  });

  describe("entityNavigationRef", () => {
    it("populates ref with navigation function on mount", () => {
      const ref = { current: null } as React.RefObject<((iri: string, type?: string) => void) | null>;
      render(<StandardEditorLayout {...defaultProps({ entityNavigationRef: ref })} />);
      expect(ref.current).toBeTypeOf("function");
    });

    it("clears ref on unmount", () => {
      const ref = { current: null } as React.RefObject<((iri: string, type?: string) => void) | null>;
      const { unmount } = render(<StandardEditorLayout {...defaultProps({ entityNavigationRef: ref })} />);
      expect(ref.current).toBeTypeOf("function");
      unmount();
      expect(ref.current).toBeNull();
    });

    it("navigates to class tab when type is class", () => {
      const navigateToNode = vi.fn().mockResolvedValue(undefined);
      const ref = { current: null } as React.RefObject<((iri: string, type?: string) => void) | null>;
      render(<StandardEditorLayout {...defaultProps({ entityNavigationRef: ref, navigateToNode })} />);
      ref.current!("http://example.org/ClassA", "class");
      expect(navigateToNode).toHaveBeenCalledWith("http://example.org/ClassA");
    });

    it("switches to properties tab when type is property", () => {
      const ref = { current: null } as React.RefObject<((iri: string, type?: string) => void) | null>;
      render(<StandardEditorLayout {...defaultProps({ entityNavigationRef: ref, nodes: sampleNodes })} />);
      expect(screen.getByTestId("class-tree")).toBeDefined();

      act(() => {
        ref.current!("http://example.org/hasFoo", "property");
      });

      expect(screen.getByTestId("property-tree")).toBeDefined();
      expect(screen.getByTestId("property-detail-panel")).toBeDefined();
      expect(screen.queryByTestId("class-tree")).toBeNull();
    });

    it("switches to individuals tab when type is individual", () => {
      const ref = { current: null } as React.RefObject<((iri: string, type?: string) => void) | null>;
      render(<StandardEditorLayout {...defaultProps({ entityNavigationRef: ref, nodes: sampleNodes })} />);
      expect(screen.getByTestId("class-tree")).toBeDefined();

      act(() => {
        ref.current!("http://example.org/foo1", "individual");
      });

      expect(screen.getByTestId("individual-list")).toBeDefined();
      expect(screen.getByTestId("individual-detail-panel")).toBeDefined();
      expect(screen.queryByTestId("class-tree")).toBeNull();
    });

    it("defaults to class navigation when type is undefined", () => {
      const navigateToNode = vi.fn().mockResolvedValue(undefined);
      const ref = { current: null } as React.RefObject<((iri: string, type?: string) => void) | null>;
      render(<StandardEditorLayout {...defaultProps({ entityNavigationRef: ref, navigateToNode })} />);
      ref.current!("http://example.org/ClassA");
      expect(navigateToNode).toHaveBeenCalledWith("http://example.org/ClassA");
    });

    it("navigates to class tree for 'other' type (triggers 404 error message)", () => {
      const navigateToNode = vi.fn().mockResolvedValue(undefined);
      const ref = { current: null } as React.RefObject<((iri: string, type?: string) => void) | null>;
      render(<StandardEditorLayout {...defaultProps({ entityNavigationRef: ref, navigateToNode })} />);
      ref.current!("http://example.org/Unknown", "other");
      expect(navigateToNode).toHaveBeenCalledWith("http://example.org/Unknown");
    });
  });

  describe("selection store cross-page contract", () => {
    beforeEach(() => useSelectionStore.getState().clear());

    it("populates the selection store from selectedIri on mount", () => {
      render(
        <StandardEditorLayout
          {...defaultProps({ selectedIri: "http://example.org/Foo" })}
        />,
      );
      expect(useSelectionStore.getState().iri).toBe("http://example.org/Foo");
      expect(useSelectionStore.getState().type).toBe("class");
    });

    it("preserves the selection store on unmount so side-page Back-to-project links can read it", () => {
      const { unmount } = render(
        <StandardEditorLayout
          {...defaultProps({ selectedIri: "http://example.org/Foo" })}
        />,
      );
      unmount();
      expect(useSelectionStore.getState().iri).toBe("http://example.org/Foo");
      expect(useSelectionStore.getState().type).toBe("class");
    });
  });

  describe("refreshing after agent changes", () => {
    it("remounts the open detail panel when detailEpoch changes, not on other re-renders", () => {
      _classDetailMounts = 0;
      const props = defaultProps({ selectedIri: "http://example.org/ClassA", nodes: sampleNodes, detailEpoch: 0 });
      const { rerender } = render(<StandardEditorLayout {...props} />);
      expect(_classDetailMounts).toBe(1);
      rerender(<StandardEditorLayout {...props} detailRefreshKey={5} />);
      expect(_classDetailMounts).toBe(1);
      rerender(<StandardEditorLayout {...props} detailEpoch={1} />);
      expect(_classDetailMounts).toBe(2);
    });

    it("marks the detail area so focus inside it can be detected", () => {
      const { container } = render(<StandardEditorLayout {...defaultProps()} />);
      const area = container.querySelector("[data-entity-detail-panel]");
      expect(area?.contains(screen.getByTestId("class-detail-panel"))).toBe(true);
    });

    it("forwards entityListRefreshKey to the property and individual lists", () => {
      const ref = { current: null } as React.RefObject<((iri: string, type?: string) => void) | null>;
      render(<StandardEditorLayout {...defaultProps({ entityNavigationRef: ref, entityListRefreshKey: 3 })} />);
      act(() => ref.current!("http://example.org/hasFoo", "property"));
      expect(_propertyTreeProps.refreshKey).toBe(3);
      act(() => ref.current!("http://example.org/foo1", "individual"));
      expect(_individualListProps.refreshKey).toBe(3);
    });

    it("clears a deleted property or individual selection through entityRemovalRef", () => {
      const nav = { current: null } as React.RefObject<((iri: string, type?: string) => void) | null>;
      const removal = { current: null } as React.RefObject<((iris: string[]) => void) | null>;
      const { unmount } = render(
        <StandardEditorLayout {...defaultProps({ entityNavigationRef: nav, entityRemovalRef: removal })} />,
      );
      act(() => nav.current!("http://example.org/hasFoo", "property"));
      expect(_propertyTreeProps.selectedIri).toBe("http://example.org/hasFoo");
      act(() => removal.current!(["http://example.org/other"]));
      expect(_propertyTreeProps.selectedIri).toBe("http://example.org/hasFoo");
      act(() => removal.current!(["http://example.org/hasFoo"]));
      expect(_propertyTreeProps.selectedIri).toBeNull();
      expect(useSelectionStore.getState().iri).toBeNull();
      unmount();
      expect(removal.current).toBeNull();
    });
  });
});

