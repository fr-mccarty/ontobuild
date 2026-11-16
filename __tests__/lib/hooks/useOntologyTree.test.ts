import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/api/client", () => ({
  projectOntologyApi: {
    getRootClasses: vi.fn(),
    getClassChildren: vi.fn(),
    getClassAncestors: vi.fn(),
  },
}));

import { useOntologyTree } from "@/lib/hooks/useOntologyTree";
import { projectOntologyApi } from "@/lib/api/client";

const mockedGetRootClasses = projectOntologyApi.getRootClasses as ReturnType<typeof vi.fn>;
const mockedGetClassChildren = projectOntologyApi.getClassChildren as ReturnType<typeof vi.fn>;
const mockedGetClassAncestors = projectOntologyApi.getClassAncestors as ReturnType<typeof vi.fn>;

function makeApiNode(iri: string, label: string, childCount = 0) {
  return { iri, label, child_count: childCount, deprecated: false };
}

describe("useOntologyTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads root classes on mount", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [
        makeApiNode("urn:A", "Class A", 2),
        makeApiNode("urn:B", "Class B", 0),
      ],
      total_classes: 5,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.nodes[0].iri).toBe("urn:A");
    expect(result.current.nodes[0].hasChildren).toBe(true);
    expect(result.current.nodes[0].isExpanded).toBe(false);
    expect(result.current.nodes[1].hasChildren).toBe(false);
    expect(result.current.totalClasses).toBe(5);
    expect(result.current.error).toBeNull();
  });

  it("sets error when loadRootClasses fails", async () => {
    mockedGetRootClasses.mockRejectedValue(new Error("Network down"));

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Network down");
    expect(result.current.nodes).toHaveLength(0);
  });

  it("does not fetch when projectId is empty", async () => {
    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "" })
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(mockedGetRootClasses).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it("expands a node and loads children", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A", 2)],
      total_classes: 3,
    });
    mockedGetClassChildren.mockResolvedValue({
      nodes: [makeApiNode("urn:C1", "Child 1"), makeApiNode("urn:C2", "Child 2")],
      total_classes: 3,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.expandNode("urn:A");
    });

    expect(result.current.nodes[0].isExpanded).toBe(true);
    expect(result.current.nodes[0].children).toHaveLength(2);
    expect(result.current.nodes[0].children[0].iri).toBe("urn:C1");
  });

  it("handles expandNode failure gracefully", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A", 1)],
      total_classes: 1,
    });
    mockedGetClassChildren.mockRejectedValue(new Error("expand fail"));

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.expandNode("urn:A");
    });

    expect(result.current.nodes[0].isExpanded).toBe(false);
    expect(result.current.nodes[0].isLoading).toBe(false);
  });

  it("collapses a node", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A", 1)],
      total_classes: 1,
    });
    mockedGetClassChildren.mockResolvedValue({
      nodes: [makeApiNode("urn:C", "Child")],
      total_classes: 1,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.expandNode("urn:A");
    });
    expect(result.current.nodes[0].isExpanded).toBe(true);

    act(() => {
      result.current.collapseNode("urn:A");
    });
    expect(result.current.nodes[0].isExpanded).toBe(false);
  });

  it("selects a node", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A")],
      total_classes: 1,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.selectNode("urn:A");
    });
    expect(result.current.selectedIri).toBe("urn:A");
  });

  it("adds an optimistic node to the root", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A")],
      total_classes: 1,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.addOptimisticNode("urn:New", "New Class");
    });

    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.nodes[1].iri).toBe("urn:New");
    expect(result.current.nodes[1].label).toBe("New Class");
    expect(result.current.totalClasses).toBe(2);
    expect(result.current.selectedIri).toBe("urn:New");
  });

  it("adds an optimistic node as a child of a parent", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A", 1)],
      total_classes: 1,
    });
    mockedGetClassChildren.mockResolvedValue({
      nodes: [makeApiNode("urn:C1", "Child 1")],
      total_classes: 1,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.expandNode("urn:A");
    });

    act(() => {
      result.current.addOptimisticNode("urn:New", "New Child", "urn:A");
    });

    expect(result.current.nodes[0].children).toHaveLength(2);
    expect(result.current.nodes[0].children[1].iri).toBe("urn:New");
    expect(result.current.nodes[0].isExpanded).toBe(true);
    expect(result.current.nodes[0].hasChildren).toBe(true);
  });

  it("removes an optimistic node and clears selection if selected", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A"), makeApiNode("urn:B", "B")],
      total_classes: 2,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.selectNode("urn:A");
    });
    expect(result.current.selectedIri).toBe("urn:A");

    act(() => {
      result.current.removeOptimisticNode("urn:A");
    });

    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0].iri).toBe("urn:B");
    expect(result.current.totalClasses).toBe(1);
    expect(result.current.selectedIri).toBeNull();
  });

  it("removeOptimisticNode keeps selection if different node removed", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A"), makeApiNode("urn:B", "B")],
      total_classes: 2,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.selectNode("urn:A");
    });

    act(() => {
      result.current.removeOptimisticNode("urn:B");
    });

    expect(result.current.selectedIri).toBe("urn:A");
  });

  it("updates a node label in place", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "Old Label")],
      total_classes: 1,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.updateNodeLabel("urn:A", "New Label");
    });

    expect(result.current.nodes[0].label).toBe("New Label");
  });

  it("collapseAll collapses all expanded nodes", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A", 1), makeApiNode("urn:B", "B", 1)],
      total_classes: 4,
    });
    mockedGetClassChildren.mockResolvedValue({
      nodes: [makeApiNode("urn:C", "C")],
      total_classes: 4,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.expandNode("urn:A");
    });
    await act(async () => {
      await result.current.expandNode("urn:B");
    });

    expect(result.current.nodes[0].isExpanded).toBe(true);
    expect(result.current.nodes[1].isExpanded).toBe(true);

    act(() => {
      result.current.collapseAll();
    });

    expect(result.current.nodes[0].isExpanded).toBe(false);
    expect(result.current.nodes[1].isExpanded).toBe(false);
  });

  it("collapseOneLevel collapses leaf-expanded nodes only", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A", 1)],
      total_classes: 3,
    });
    mockedGetClassChildren
      .mockResolvedValueOnce({
        nodes: [makeApiNode("urn:C", "C", 1)],
        total_classes: 3,
      })
      .mockResolvedValueOnce({
        nodes: [makeApiNode("urn:D", "D", 0)],
        total_classes: 3,
      });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.expandNode("urn:A");
    });
    await act(async () => {
      await result.current.expandNode("urn:C");
    });

    expect(result.current.nodes[0].isExpanded).toBe(true);
    expect(result.current.nodes[0].children[0].isExpanded).toBe(true);

    act(() => {
      result.current.collapseOneLevel();
    });

    expect(result.current.nodes[0].isExpanded).toBe(true);
    expect(result.current.nodes[0].children[0].isExpanded).toBe(false);
  });

  it("hasExpandableNodes and hasExpandedNodes compute correctly", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A", 1)],
      total_classes: 2,
    });
    mockedGetClassChildren.mockResolvedValue({
      nodes: [makeApiNode("urn:C", "C", 0)],
      total_classes: 2,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasExpandableNodes).toBe(true);
    expect(result.current.hasExpandedNodes).toBe(false);

    await act(async () => {
      await result.current.expandNode("urn:A");
    });

    expect(result.current.hasExpandedNodes).toBe(true);
    expect(result.current.hasExpandableNodes).toBe(false);
  });

  it("navigateToNode expands ancestors and selects target", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:Root", "Root", 1)],
      total_classes: 3,
    });
    mockedGetClassAncestors.mockResolvedValue({
      nodes: [makeApiNode("urn:Root", "Root", 1)],
      total_classes: 3,
    });
    mockedGetClassChildren.mockResolvedValue({
      nodes: [makeApiNode("urn:Target", "Target", 0)],
      total_classes: 3,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.navigateToNode("urn:Target");
    });

    expect(result.current.selectedIri).toBe("urn:Target");
    expect(mockedGetClassAncestors).toHaveBeenCalledWith("p1", "urn:Target", undefined);

    const rootNode = result.current.nodes.find((n) => n.iri === "urn:Root");
    expect(rootNode).toBeDefined();
    expect(rootNode!.children.length).toBeGreaterThan(0);
    const targetNode = rootNode!.children.find((c) => c.iri === "urn:Target");
    expect(targetNode).toBeDefined();
    expect(targetNode!.label).toBe("Target");
  });

  it("navigateToNode still selects target when ancestor fetch fails", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:Root", "Root", 1)],
      total_classes: 1,
    });
    mockedGetClassAncestors.mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.navigateToNode("urn:Target");
    });

    expect(result.current.selectedIri).toBe("urn:Target");
  });

  it("reparentOptimistic moves a node and rollback restores", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [
        makeApiNode("urn:A", "A", 1),
        makeApiNode("urn:B", "B", 0),
      ],
      total_classes: 3,
    });
    mockedGetClassChildren.mockResolvedValue({
      nodes: [makeApiNode("urn:C", "Child", 0)],
      total_classes: 3,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.expandNode("urn:A");
    });

    expect(result.current.nodes[0].children).toHaveLength(1);
    expect(result.current.nodes[0].children[0].iri).toBe("urn:C");

    let snapshot: ReturnType<typeof result.current.reparentOptimistic>;
    act(() => {
      snapshot = result.current.reparentOptimistic("urn:C", "urn:A", "urn:B");
    });

    expect(result.current.nodes[0].children).toHaveLength(0);
    const nodeB = result.current.nodes[1];
    expect(nodeB.children).toHaveLength(1);
    expect(nodeB.children[0].iri).toBe("urn:C");

    act(() => {
      result.current.rollbackReparent(snapshot!);
    });

    expect(result.current.nodes[0].children).toHaveLength(1);
    expect(result.current.nodes[0].children[0].iri).toBe("urn:C");
  });

  it("reparentOptimistic moves a node to root when newParentIri is null", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A", 1)],
      total_classes: 2,
    });
    mockedGetClassChildren.mockResolvedValue({
      nodes: [makeApiNode("urn:C", "Child", 0)],
      total_classes: 2,
    });

    const { result } = renderHook(() =>
      useOntologyTree({ projectId: "p1" })
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.expandNode("urn:A");
    });

    act(() => {
      result.current.reparentOptimistic("urn:C", "urn:A", null);
    });

    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.nodes[1].iri).toBe("urn:C");
    expect(result.current.nodes[0].children).toHaveLength(0);
  });

  it("resets tree when branchKey changes", async () => {
    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:A", "A")],
      total_classes: 1,
    });

    const { result, rerender } = renderHook(
      ({ branchKey }) =>
        useOntologyTree({ projectId: "p1", branchKey }),
      {
        initialProps: { branchKey: "main" },
      }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.nodes).toHaveLength(1);

    mockedGetRootClasses.mockResolvedValue({
      nodes: [makeApiNode("urn:X", "X"), makeApiNode("urn:Y", "Y")],
      total_classes: 2,
    });

    rerender({ branchKey: "dev" });

    await waitFor(() => expect(result.current.nodes).toHaveLength(2));
    expect(result.current.nodes[0].iri).toBe("urn:X");
  });
});

describe("useOntologyTree refreshTree", () => {
  // A small fake server: class IRI -> label and child IRIs, plus the root list.
  let classes: Record<string, { label: string; children: string[] }>;
  let roots: string[];

  const node = (iri: string) => makeApiNode(iri, classes[iri].label, classes[iri].children.length);
  const parentOf = (iri: string) => Object.keys(classes).find((p) => classes[p].children.includes(iri));

  function serve() {
    mockedGetRootClasses.mockImplementation(async () => ({
      nodes: roots.map(node),
      total_classes: Object.keys(classes).length,
    }));
    mockedGetClassChildren.mockImplementation(async (_p: string, iri: string) => ({
      nodes: (classes[iri]?.children ?? []).map(node),
      total_classes: Object.keys(classes).length,
    }));
    mockedGetClassAncestors.mockImplementation(async (_p: string, iri: string) => {
      if (!classes[iri]) throw new Error("Entity not found (404)");
      const path: string[] = [];
      for (let p = parentOf(iri); p; p = parentOf(p)) path.unshift(p);
      return { nodes: path.map(node), total_classes: Object.keys(classes).length };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    classes = {
      "urn:Food": { label: "Food", children: ["urn:Pizza", "urn:Pasta"] },
      "urn:Pizza": { label: "Pizza", children: ["urn:Margherita"] },
      "urn:Margherita": { label: "Margherita", children: [] },
      "urn:Pasta": { label: "Pasta", children: [] },
      "urn:Topping": { label: "Topping", children: ["urn:Cheese"] },
      "urn:Cheese": { label: "Cheese", children: [] },
    };
    roots = ["urn:Food", "urn:Topping"];
    serve();
  });

  async function renderExpanded() {
    const hook = renderHook(() => useOntologyTree({ projectId: "p1", branchKey: "main" }));
    await waitFor(() => expect(hook.result.current.nodes).toHaveLength(2));
    await act(async () => {
      await hook.result.current.expandNode("urn:Food");
      await hook.result.current.expandNode("urn:Pizza");
    });
    return hook;
  }

  const find = (nodes: ClassTreeNodeLike[], iri: string): ClassTreeNodeLike | undefined => {
    for (const n of nodes) {
      if (n.iri === iri) return n;
      const hit = find(n.children, iri);
      if (hit) return hit;
    }
    return undefined;
  };
  type ClassTreeNodeLike = { iri: string; label: string; isExpanded: boolean; children: ClassTreeNodeLike[] };

  it("adds a new class under its expanded parent without collapsing the tree or showing a spinner", async () => {
    const { result } = await renderExpanded();
    act(() => result.current.selectNode("urn:Margherita"));
    classes["urn:Hawaiian"] = { label: "Hawaiian", children: [] };
    classes["urn:Pizza"].children.push("urn:Hawaiian");

    const loadingStates: boolean[] = [];
    await act(async () => {
      const done = result.current.refreshTree();
      loadingStates.push(result.current.isLoading);
      await done;
    });

    expect(loadingStates).toEqual([false]);
    const pizza = find(result.current.nodes, "urn:Pizza")!;
    expect(pizza.isExpanded).toBe(true);
    expect(pizza.children.map((c) => c.iri)).toEqual(["urn:Margherita", "urn:Hawaiian"]);
    expect(find(result.current.nodes, "urn:Food")!.isExpanded).toBe(true);
    expect(find(result.current.nodes, "urn:Topping")!.isExpanded).toBe(false);
    expect(result.current.selectedIri).toBe("urn:Margherita");
    expect(result.current.totalClasses).toBe(7);
    // Collapsed subtrees are not fetched.
    expect(mockedGetClassChildren.mock.calls.map((c) => c[1])).not.toContain("urn:Topping");
  });

  it("updates a renamed label inside an expanded subtree", async () => {
    const { result } = await renderExpanded();
    classes["urn:Margherita"].label = "Margherita Pizza";
    await act(() => result.current.refreshTree());
    expect(find(result.current.nodes, "urn:Margherita")!.label).toBe("Margherita Pizza");
  });

  it("moves a re-parented class, and reveals it at its new place when it was selected", async () => {
    const { result } = await renderExpanded();
    act(() => result.current.selectNode("urn:Margherita"));
    classes["urn:Pizza"].children = [];
    classes["urn:Cheese"].children.push("urn:Margherita");

    await act(() => result.current.refreshTree());

    await waitFor(() => expect(find(result.current.nodes, "urn:Cheese")?.isExpanded).toBe(true));
    expect(find(result.current.nodes, "urn:Pizza")!.children).toEqual([]);
    expect(find(result.current.nodes, "urn:Topping")!.isExpanded).toBe(true);
    expect(find(result.current.nodes, "urn:Cheese")!.children.map((c) => c.iri)).toEqual(["urn:Margherita"]);
    expect(result.current.selectedIri).toBe("urn:Margherita");
  });

  it("removes a deleted class and clears the selection when it was selected", async () => {
    const { result } = await renderExpanded();
    act(() => result.current.selectNode("urn:Margherita"));
    delete classes["urn:Margherita"];
    classes["urn:Pizza"].children = [];

    await act(() => result.current.refreshTree({ removedIris: ["urn:Margherita"] }));

    expect(find(result.current.nodes, "urn:Margherita")).toBeUndefined();
    expect(result.current.selectedIri).toBeNull();
    expect(result.current.totalClasses).toBe(5);
  });

  it("clears the selection when the selected class vanished without being reported", async () => {
    const { result } = await renderExpanded();
    act(() => result.current.selectNode("urn:Pasta"));
    delete classes["urn:Pasta"];
    classes["urn:Food"].children = ["urn:Pizza"];

    await act(() => result.current.refreshTree());

    await waitFor(() => expect(result.current.selectedIri).toBeNull());
    expect(find(result.current.nodes, "urn:Pasta")).toBeUndefined();
  });

  it("keeps the selection when it was not on screen", async () => {
    const { result } = await renderExpanded();
    act(() => {
      result.current.collapseNode("urn:Food");
      result.current.selectNode("urn:Pasta");
    });
    await act(() => result.current.refreshTree());
    expect(result.current.selectedIri).toBe("urn:Pasta");
    expect(find(result.current.nodes, "urn:Food")!.isExpanded).toBe(false);
    expect(mockedGetClassAncestors).not.toHaveBeenCalled();
  });

  it("ignores the results of a refresh that a newer one overtook", async () => {
    const { result } = await renderExpanded();
    let releaseFirst: () => void = () => {};
    mockedGetRootClasses.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ nodes: [makeApiNode("urn:Stale", "Stale")], total_classes: 1 });
        }),
    );
    await act(async () => {
      const first = result.current.refreshTree();
      await result.current.refreshTree();
      releaseFirst();
      await first;
    });
    expect(find(result.current.nodes, "urn:Stale")).toBeUndefined();
    expect(result.current.nodes.map((n) => n.iri)).toEqual(["urn:Food", "urn:Topping"]);
  });
});
