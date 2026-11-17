import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Node 26's experimental global localStorage shadows jsdom's and has no methods without a backing file.
vi.hoisted(() => {
  if (!globalThis.localStorage || typeof globalThis.localStorage.setItem !== "function") {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (index: number) => [...store.keys()][index] ?? null,
    };
  }
});

const toast = { addToast: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() };
vi.mock("@/lib/context/ToastContext", () => ({ useToast: () => toast }));

import { AGENT_REFRESH_DELAY_MS, useAgentEditorSync } from "@/components/editor/agent/useAgentEditorSync";
import { useDraftStore, draftKey } from "@/lib/stores/draftStore";
import { useSelectionStore } from "@/lib/stores/selectionStore";
import type { AgentOntologyChange } from "@/lib/api/agentChat";

const change = (over: Partial<AgentOntologyChange> = {}): AgentOntologyChange => ({
  tool_use_id: "t1",
  name: "create_entity",
  branch: "main",
  commit_hash: "c1",
  deleted_iris: [],
  ...over,
});

function setup(activeBranch = "main") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  const refreshTree = vi.fn().mockResolvedValue(undefined);
  const reloadSource = vi.fn().mockResolvedValue(undefined);
  const refreshDetail = vi.fn();
  const navigate = vi.fn();
  const removeFromSelection = vi.fn();
  const entityNavigationRef = { current: navigate as ((iri: string, type?: string) => void) | null };
  const entityRemovalRef = { current: removeFromSelection as ((iris: string[]) => void) | null };
  const navigateToNode = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(
    () =>
      useAgentEditorSync({
        projectId: "p1",
        activeBranch,
        refreshTree,
        reloadSource,
        refreshDetail,
        entityNavigationRef,
        entityRemovalRef,
        navigateToNode,
      }),
    { wrapper },
  );
  return { hook, invalidate, refreshTree, reloadSource, refreshDetail, navigate, removeFromSelection, entityNavigationRef, navigateToNode };
}

const PIZZA = "http://example.org/pizza#Pizza";

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(AGENT_REFRESH_DELAY_MS + 10);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useDraftStore.setState({ drafts: {} });
  useSelectionStore.setState({ iri: null, type: null });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useAgentEditorSync", () => {
  it("refreshes the tree, source, lists, detail and project queries once for a burst of changes", async () => {
    const s = setup();
    act(() => {
      s.hook.result.current.onProjectChanged();
      s.hook.result.current.onOntologyChanged(change());
      s.hook.result.current.onProjectChanged();
      s.hook.result.current.onOntologyChanged(change({ tool_use_id: "t2", commit_hash: "c2" }));
    });
    expect(s.refreshTree).not.toHaveBeenCalled();
    await settle();

    expect(s.refreshTree).toHaveBeenCalledTimes(1);
    expect(s.refreshTree).toHaveBeenCalledWith({ removedIris: [] });
    expect(s.reloadSource).toHaveBeenCalledTimes(1);
    expect(s.refreshDetail).toHaveBeenCalledTimes(1);
    expect(s.invalidate).toHaveBeenCalledTimes(1);
    const { predicate } = s.invalidate.mock.calls[0][0] as unknown as { predicate: (q: { queryKey: unknown[] }) => boolean };
    expect(predicate({ queryKey: ["branches", "p1", true] })).toBe(true);
    expect(predicate({ queryKey: ["entityHistory", "p1", "iri", true, "main", 20] })).toBe(true);
    expect(predicate({ queryKey: ["agent", "status"] })).toBe(false);
    const { entityListRefreshKey, detailEpoch, sidePanelsRefreshKey } = s.hook.result.current;
    expect([entityListRefreshKey, detailEpoch, sidePanelsRefreshKey]).toEqual([1, 1, 1]);

    // Nothing pending: no more refreshes.
    await settle();
    expect(s.refreshTree).toHaveBeenCalledTimes(1);
  });

  it("only refreshes project queries for non-ontology changes and for commits to another branch", async () => {
    const s = setup("main");
    act(() => {
      s.hook.result.current.onProjectChanged();
      s.hook.result.current.onOntologyChanged(change({ branch: "feature" }));
    });
    await settle();
    expect(s.invalidate).toHaveBeenCalledTimes(1);
    expect(s.refreshTree).not.toHaveBeenCalled();
    expect(s.reloadSource).not.toHaveBeenCalled();
    expect(s.hook.result.current.detailEpoch).toBe(0);
    expect(s.hook.result.current.sidePanelsRefreshKey).toBe(1);
  });

  it("treats a change with an unknown branch as a change to the open branch", async () => {
    const s = setup("main");
    act(() => s.hook.result.current.onOntologyChanged(change({ branch: "", commit_hash: null })));
    await settle();
    expect(s.refreshTree).toHaveBeenCalledTimes(1);
  });

  it("passes deleted IRIs to the tree and the property/individual selection", async () => {
    const s = setup();
    act(() => s.hook.result.current.onOntologyChanged(change({ name: "delete_entity", deleted_iris: ["urn:Gone"] })));
    await settle();
    expect(s.refreshTree).toHaveBeenCalledWith({ removedIris: ["urn:Gone"] });
    expect(s.removeFromSelection).toHaveBeenCalledWith(["urn:Gone"]);
  });

  it("keeps the detail panel and warns when the shown entity has an unsaved draft", async () => {
    const s = setup();
    useSelectionStore.setState({ iri: PIZZA, type: "class" });
    useDraftStore.getState().setDraft(draftKey("p1", "main", PIZZA), {
      labels: [{ value: "My pizza" }],
      comments: [],
      parentIris: [],
      parentLabels: {},
      annotations: [],
      relationships: [],
      updatedAt: 1,
    });
    act(() => s.hook.result.current.onOntologyChanged(change()));
    await settle();

    expect(s.refreshTree).toHaveBeenCalledTimes(1);
    expect(s.hook.result.current.detailEpoch).toBe(0);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const [title, description, shown] = toast.warning.mock.calls[0];
    expect(title).toBe("The agent changed the ontology");
    expect(description).toContain('Your unsaved edits to "Pizza" are kept');
    expect(useDraftStore.getState().hasDraft(draftKey("p1", "main", PIZZA))).toBe(true);

    act(() => shown.action.onClick());
    expect(useDraftStore.getState().hasDraft(draftKey("p1", "main", PIZZA))).toBe(false);
    expect(s.hook.result.current.detailEpoch).toBe(1);
  });

  it("keeps the detail panel while the user is typing in it", async () => {
    const s = setup();
    useSelectionStore.setState({ iri: "urn:Pizza", type: "class" });
    const panel = document.createElement("div");
    panel.setAttribute("data-entity-detail-panel", "");
    const input = document.createElement("input");
    panel.appendChild(input);
    document.body.appendChild(panel);
    input.focus();

    act(() => s.hook.result.current.onOntologyChanged(change()));
    await settle();
    expect(s.hook.result.current.detailEpoch).toBe(0);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("remounts the detail panel when the shown entity has no pending edits", async () => {
    const s = setup();
    useSelectionStore.setState({ iri: "urn:Pizza", type: "class" });
    useDraftStore.getState().setDraft(draftKey("p1", "main", "urn:Other"), {
      labels: [],
      comments: [],
      parentIris: [],
      parentLabels: {},
      annotations: [],
      relationships: [],
      updatedAt: 1,
    });
    act(() => s.hook.result.current.onOntologyChanged(change()));
    await settle();
    expect(s.hook.result.current.detailEpoch).toBe(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("selects an entity after applying pending refreshes", async () => {
    const s = setup();
    const order: string[] = [];
    s.refreshTree.mockImplementation(async () => {
      order.push("refresh");
    });
    s.navigate.mockImplementation(() => order.push("select"));
    act(() => s.hook.result.current.onOntologyChanged(change()));
    await act(() =>
      s.hook.result.current.onUiAction({
        action: "select_entity",
        iri: "urn:Hawaiian",
        entity_type: "class",
        label: "Hawaiian",
        branch: "main",
      }),
    );
    expect(order).toEqual(["refresh", "select"]);
    expect(s.navigate).toHaveBeenCalledWith("urn:Hawaiian", "class");

    // The debounce timer was consumed: no second refresh.
    await settle();
    expect(s.refreshTree).toHaveBeenCalledTimes(1);
  });

  it("selects properties and individuals through the layout's navigation", async () => {
    const s = setup();
    await act(() =>
      s.hook.result.current.onUiAction({ action: "select_entity", iri: "urn:hasTopping", entity_type: "property", label: "", branch: "main" }),
    );
    await act(() =>
      s.hook.result.current.onUiAction({ action: "select_entity", iri: "urn:Mozzarella", entity_type: "individual", label: "", branch: "main" }),
    );
    expect(s.navigate.mock.calls).toEqual([
      ["urn:hasTopping", "property"],
      ["urn:Mozzarella", "individual"],
    ]);
    expect(s.refreshTree).not.toHaveBeenCalled();
  });

  it("falls back to the tree for classes before the layout registers navigation", async () => {
    const s = setup();
    s.entityNavigationRef.current = null;
    await act(() =>
      s.hook.result.current.onUiAction({ action: "select_entity", iri: "urn:Pizza", entity_type: "class", label: "Pizza", branch: "main" }),
    );
    expect(s.navigateToNode).toHaveBeenCalledWith("urn:Pizza");
  });

  it("does not select an entity on a branch the editor is not showing", async () => {
    const s = setup("main");
    await act(() =>
      s.hook.result.current.onUiAction({ action: "select_entity", iri: "urn:Pizza", entity_type: "class", label: "Pizza", branch: "feature" }),
    );
    expect(s.navigate).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('"Pizza" is on branch feature', "The editor shows main.");
  });
});
