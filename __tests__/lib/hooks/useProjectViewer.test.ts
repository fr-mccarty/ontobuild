import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Project } from "@/lib/api/projects";

const mockUseProject = vi.fn();
const mockDerivePermissions = vi.fn();

vi.mock("@/lib/hooks/useProject", () => ({
  useProject: (...args: unknown[]) => mockUseProject(...args),
  derivePermissions: (...args: unknown[]) => mockDerivePermissions(...args),
}));

vi.mock("@/lib/hooks/useOntologyTree", () => ({
  useOntologyTree: vi.fn().mockReturnValue({
    nodes: [],
    totalClasses: 0,
    isLoading: false,
    error: null,
    selectedIri: null,
    loadRootClasses: vi.fn(),
    refreshTree: vi.fn(),
    expandNode: vi.fn(),
    collapseNode: vi.fn(),
    selectNode: vi.fn(),
    navigateToNode: vi.fn(),
    addOptimisticNode: vi.fn(),
    removeOptimisticNode: vi.fn(),
    updateNodeLabel: vi.fn(),
    collapseAll: vi.fn(),
    collapseOneLevel: vi.fn(),
    expandOneLevel: vi.fn(),
    expandAllFully: vi.fn(),
    hasExpandableNodes: false,
    hasExpandedNodes: false,
    isExpandingAll: false,
    reparentOptimistic: vi.fn(),
    rollbackReparent: vi.fn(),
  }),
}));

const mockUseOpenPRCount = vi.fn();
const mockUseLintSummary = vi.fn();
const mockUseNormalizationStatus = vi.fn();

vi.mock("@/lib/hooks/useOpenPRCount", () => ({
  useOpenPRCount: (...args: unknown[]) => mockUseOpenPRCount(...args),
}));

vi.mock("@/lib/hooks/useLintSummary", () => ({
  useLintSummary: (...args: unknown[]) => mockUseLintSummary(...args),
}));

vi.mock("@/lib/hooks/useNormalizationStatus", () => ({
  useNormalizationStatus: (...args: unknown[]) => mockUseNormalizationStatus(...args),
}));

vi.mock("@/lib/api/revisions", () => ({
  revisionsApi: {
    getFileAtVersion: vi.fn().mockResolvedValue({ content: "@prefix ex: <http://example.org/> .\nex:A a owl:Class ." }),
  },
}));

import { useProjectViewer } from "@/lib/hooks/useProjectViewer";
import { revisionsApi, type RevisionFileResponse } from "@/lib/api/revisions";
import { useOntologyTree } from "@/lib/hooks/useOntologyTree";

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "p1",
    name: "Test Ontology",
    is_public: true,
    owner_id: "u1",
    created_at: "2025-01-01T00:00:00Z",
    member_count: 1,
    source_file_path: "ontology.ttl",
    git_ontology_path: "ontology.ttl",
    user_role: "editor",
    ...overrides,
  } as Project;
}

function defaultPermissions(overrides?: Record<string, unknown>) {
  return {
    canManage: false,
    canEdit: true,
    hasValidAccess: true,
    hasOntology: true,
    ...overrides,
  };
}

describe("useProjectViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseProject.mockReturnValue({
      project: null,
      isLoading: true,
      error: null,
      errorKind: null,
    });
    mockDerivePermissions.mockReturnValue(defaultPermissions());

    mockUseOpenPRCount.mockReturnValue({ data: 3 });
    mockUseLintSummary.mockReturnValue({
      data: {
        project_id: "p1",
        last_run: null,
        error_count: 1,
        warning_count: 2,
        info_count: 0,
        total_issues: 3,
      },
    });
    mockUseNormalizationStatus.mockReturnValue({
      data: {
        needs_normalization: false,
        last_run: null,
        last_run_id: null,
        last_check: null,
        preview_report: null,
        error: null,
      },
    });
  });

  it("returns loading state initially", () => {
    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.project).toBeNull();
  });

  it("propagates project data once loaded", async () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.project).toBe(project);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("propagates error state", () => {
    mockUseProject.mockReturnValue({
      project: null,
      isLoading: false,
      error: "Not found",
      errorKind: "not-found",
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.error).toBe("Not found");
    expect(result.current.errorKind).toBe("not-found");
  });

  it("passes through permission flags from derivePermissions", () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });
    mockDerivePermissions.mockReturnValue(
      defaultPermissions({ canManage: true, canEdit: true })
    );

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.canManage).toBe(true);
    expect(result.current.canEdit).toBe(true);
    expect(result.current.hasOntology).toBe(true);
  });

  it("overrides hasValidAccess based on sessionStatus", () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });
    mockDerivePermissions.mockReturnValue(
      defaultPermissions({ hasValidAccess: true })
    );

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: undefined,
        sessionStatus: "unauthenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.hasValidAccess).toBe(false);
  });

  it("returns secondary data (openPRCount, lintSummary) from React Query hooks", () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.openPRCount).toBe(3);
    expect(result.current.lintSummary).not.toBeNull();
    expect(result.current.lintSummary?.total_issues).toBe(3);

    expect(mockUseOpenPRCount).toHaveBeenCalledWith("p1", "tok");
    expect(mockUseLintSummary).toHaveBeenCalledWith("p1", "tok");
  });

  it("passes normalization status from React Query hook", () => {
    const project = makeProject({ source_file_path: "ont.ttl" });
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.normalizationStatus).not.toBeNull();
    expect(mockUseNormalizationStatus).toHaveBeenCalledWith(
      "p1",
      "tok",
      { enabled: true },
    );
  });

  it("disables normalization status hook when no source_file_path", () => {
    const project = makeProject({ source_file_path: undefined });
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });
    mockDerivePermissions.mockReturnValue(defaultPermissions({ hasOntology: false }));
    mockUseNormalizationStatus.mockReturnValue({ data: undefined });

    renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(mockUseNormalizationStatus).toHaveBeenCalledWith(
      "p1",
      "tok",
      { enabled: false },
    );
  });

  it("exposes tree properties from useOntologyTree", () => {
    mockUseProject.mockReturnValue({
      project: makeProject(),
      isLoading: false,
      error: null,
      errorKind: null,
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.nodes).toEqual([]);
    expect(result.current.totalClasses).toBe(0);
    expect(result.current.isTreeLoading).toBe(false);
    expect(result.current.treeError).toBeNull();
  });

  it("exposes source state with defaults", () => {
    mockUseProject.mockReturnValue({
      project: makeProject(),
      isLoading: false,
      error: null,
      errorKind: null,
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.sourceContent).toBe("");
    expect(result.current.isLoadingSource).toBe(false);
    expect(result.current.sourceError).toBeNull();
    expect(result.current.isPreloading).toBe(false);
    expect(result.current.sourceIriIndex.size).toBe(0);
    expect(result.current.isIndexing).toBe(false);
    expect(typeof result.current.loadSourceContent).toBe("function");
    expect(typeof result.current.resetSourceState).toBe("function");
  });

  it("returns default values when project is null", () => {
    mockUseProject.mockReturnValue({
      project: null,
      isLoading: false,
      error: "Not found",
      errorKind: "not-found",
    });
    mockUseOpenPRCount.mockReturnValue({ data: undefined });
    mockUseLintSummary.mockReturnValue({ data: undefined });
    mockUseNormalizationStatus.mockReturnValue({ data: undefined });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.openPRCount).toBe(0);
    expect(result.current.lintSummary).toBeNull();
    expect(result.current.normalizationStatus).toBeNull();
  });

  it("loadSourceContent fetches and sets sourceContent", async () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    await act(async () => {
      await result.current.loadSourceContent();
    });

    expect(revisionsApi.getFileAtVersion).toHaveBeenCalledWith(
      "p1",
      "main",
      "tok",
      "ontology.ttl"
    );
    expect(result.current.sourceContent).toBe(
      "@prefix ex: <http://example.org/> .\nex:A a owl:Class ."
    );
    expect(result.current.isLoadingSource).toBe(false);
    expect(result.current.sourceError).toBeNull();
  });

  it("loadSourceContent sets sourceError on failure", async () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });
    vi.mocked(revisionsApi.getFileAtVersion).mockRejectedValueOnce(
      new Error("Network error")
    );

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    await act(async () => {
      await result.current.loadSourceContent();
    });

    expect(result.current.sourceError).toBe("Network error");
    expect(result.current.sourceContent).toBe("");
    expect(result.current.isLoadingSource).toBe(false);
  });

  it("loadSourceContent is a no-op when sourceContent is already set", async () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    await act(async () => {
      await result.current.loadSourceContent();
    });
    expect(revisionsApi.getFileAtVersion).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.loadSourceContent();
    });
    expect(revisionsApi.getFileAtVersion).toHaveBeenCalledTimes(1);
  });

  it("loadSourceContent in preload mode sets isPreloading instead of isLoadingSource", async () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });

    let resolveLoad!: (value: RevisionFileResponse) => void;
    vi.mocked(revisionsApi.getFileAtVersion).mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = resolve; })
    );

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    let loadPromise: Promise<void>;
    act(() => {
      loadPromise = result.current.loadSourceContent(true);
    });

    await waitFor(() => {
      expect(result.current.isPreloading).toBe(true);
    });
    expect(result.current.isLoadingSource).toBe(false);

    await act(async () => {
      resolveLoad({ project_id: "p1", version: "main", filename: "ontology.ttl", content: "@prefix ex: <http://example.org/> .\nex:A a owl:Class ." });
      await loadPromise!;
    });

    expect(result.current.isPreloading).toBe(false);
    expect(result.current.sourceContent).toBe(
      "@prefix ex: <http://example.org/> .\nex:A a owl:Class ."
    );
  });

  it("loadSourceContent in preload mode does not set sourceError on failure", async () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });
    vi.mocked(revisionsApi.getFileAtVersion).mockRejectedValueOnce(
      new Error("Preload failed")
    );

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    await act(async () => {
      await result.current.loadSourceContent(true);
    });

    expect(result.current.sourceError).toBeNull();
    expect(result.current.isPreloading).toBe(false);
  });

  it("selectedNodeFallback returns null when selectedIri is null", () => {
    mockUseProject.mockReturnValue({
      project: makeProject(),
      isLoading: false,
      error: null,
      errorKind: null,
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.selectedNodeFallback).toBeNull();
  });

  it("selectedNodeFallback returns node data for selected root node", () => {
    mockUseProject.mockReturnValue({
      project: makeProject(),
      isLoading: false,
      error: null,
      errorKind: null,
    });

    vi.mocked(useOntologyTree).mockReturnValue({
      nodes: [
        {
          iri: "http://example.org/A",
          label: "Class A",
          children: [],
          isExpanded: false,
          isLoading: false,
          hasChildren: false,
        },
      ],
      totalClasses: 1,
      isLoading: false,
      error: null,
      selectedIri: "http://example.org/A",
      loadRootClasses: vi.fn(),
      refreshTree: vi.fn(),
      expandNode: vi.fn(),
      collapseNode: vi.fn(),
      selectNode: vi.fn(),
      navigateToNode: vi.fn(),
      addOptimisticNode: vi.fn(),
      removeOptimisticNode: vi.fn(),
      updateNodeLabel: vi.fn(),
      collapseAll: vi.fn(),
      collapseOneLevel: vi.fn(),
      expandOneLevel: vi.fn(),
      expandAllFully: vi.fn(),
      hasExpandableNodes: false,
      hasExpandedNodes: false,
      isExpandingAll: false,
      reparentOptimistic: vi.fn(),
      rollbackReparent: vi.fn(),
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.selectedNodeFallback).toEqual({
      iri: "http://example.org/A",
      label: "Class A",
      parentIri: undefined,
      parentLabel: undefined,
    });
  });

  it("selectedNodeFallback returns node data with parent info for nested node", () => {
    mockUseProject.mockReturnValue({
      project: makeProject(),
      isLoading: false,
      error: null,
      errorKind: null,
    });

    vi.mocked(useOntologyTree).mockReturnValue({
      nodes: [
        {
          iri: "http://example.org/Parent",
          label: "Parent Class",
          children: [
            {
              iri: "http://example.org/Child",
              label: "Child Class",
              children: [],
              isExpanded: false,
              isLoading: false,
              hasChildren: false,
            },
          ],
          isExpanded: true,
          isLoading: false,
          hasChildren: true,
        },
      ],
      totalClasses: 2,
      isLoading: false,
      error: null,
      selectedIri: "http://example.org/Child",
      loadRootClasses: vi.fn(),
      refreshTree: vi.fn(),
      expandNode: vi.fn(),
      collapseNode: vi.fn(),
      selectNode: vi.fn(),
      navigateToNode: vi.fn(),
      addOptimisticNode: vi.fn(),
      removeOptimisticNode: vi.fn(),
      updateNodeLabel: vi.fn(),
      collapseAll: vi.fn(),
      collapseOneLevel: vi.fn(),
      expandOneLevel: vi.fn(),
      expandAllFully: vi.fn(),
      hasExpandableNodes: false,
      hasExpandedNodes: true,
      isExpandingAll: false,
      reparentOptimistic: vi.fn(),
      rollbackReparent: vi.fn(),
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(result.current.selectedNodeFallback).toEqual({
      iri: "http://example.org/Child",
      label: "Child Class",
      parentIri: "http://example.org/Parent",
      parentLabel: "Parent Class",
    });
  });

  it("resetSourceState clears sourceContent, sourceError, and sourceIriIndex", async () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    await act(async () => {
      await result.current.loadSourceContent();
    });
    expect(result.current.sourceContent).not.toBe("");

    await waitFor(() => {
      expect(result.current.sourceIriIndex.size).toBeGreaterThan(0);
    });

    act(() => {
      result.current.resetSourceState();
    });

    expect(result.current.sourceContent).toBe("");
    expect(result.current.sourceError).toBeNull();
    expect(result.current.sourceIriIndex.size).toBe(0);
  });

  it("builds sourceIriIndex from sourceContent after loading", async () => {
    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });

    const { result } = renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    await act(async () => {
      await result.current.loadSourceContent();
    });

    await waitFor(() => {
      expect(result.current.isIndexing).toBe(false);
      expect(result.current.sourceIriIndex.size).toBeGreaterThan(0);
    });

    expect(result.current.sourceIriIndex.has("http://example.org/A")).toBe(true);
    const entry = result.current.sourceIriIndex.get("http://example.org/A");
    expect(entry).toBeDefined();
    expect(entry!.line).toBe(2);
  });

  it("background preload fires after 2 seconds when hasOntology is true", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const project = makeProject();
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });
    mockDerivePermissions.mockReturnValue(defaultPermissions({ hasOntology: true }));

    renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    expect(revisionsApi.getFileAtVersion).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(revisionsApi.getFileAtVersion).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("background preload does not fire when hasOntology is false", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const project = makeProject({ source_file_path: undefined });
    mockUseProject.mockReturnValue({
      project,
      isLoading: false,
      error: null,
      errorKind: null,
    });
    mockDerivePermissions.mockReturnValue(defaultPermissions({ hasOntology: false }));

    renderHook(() =>
      useProjectViewer({
        projectId: "p1",
        accessToken: "tok",
        sessionStatus: "authenticated",
        activeBranch: "main",
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(revisionsApi.getFileAtVersion).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
