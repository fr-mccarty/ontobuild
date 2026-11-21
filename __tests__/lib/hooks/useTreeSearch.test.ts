import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useTreeSearch } from "@/lib/hooks/useTreeSearch";

vi.mock("@/lib/api/client", () => ({
  projectOntologyApi: {
    searchEntities: vi.fn(),
  },
}));

import { projectOntologyApi } from "@/lib/api/client";

const mockedSearchEntities = projectOntologyApi.searchEntities as ReturnType<typeof vi.fn>;

const mockSearchResponse = {
  results: [
    { iri: "http://example.org/Person", label: "Person", entity_type: "class", deprecated: false },
    { iri: "http://example.org/Animal", label: "Animal", entity_type: "class", deprecated: false },
  ],
  total: 2,
};

describe("useTreeSearch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const defaultOpts = {
    projectId: "proj-1",
    branch: "main",
    onSearchSelect: vi.fn(),
  };

  it("initializes with search hidden", () => {
    const { result } = renderHook(() => useTreeSearch(defaultOpts));
    expect(result.current.showSearch).toBe(false);
    expect(result.current.searchQuery).toBe("");
    expect(result.current.searchResults).toBeNull();
    expect(result.current.isSearching).toBe(false);
  });

  it("toggleSearch shows search panel", () => {
    const { result } = renderHook(() => useTreeSearch(defaultOpts));

    act(() => {
      result.current.toggleSearch();
    });

    expect(result.current.showSearch).toBe(true);
  });

  it("toggleSearch hides search and resets state", () => {
    const { result } = renderHook(() => useTreeSearch(defaultOpts));

    act(() => {
      result.current.toggleSearch();
    });
    act(() => {
      result.current.setSearchQuery("test");
    });
    act(() => {
      result.current.toggleSearch();
    });

    expect(result.current.showSearch).toBe(false);
    expect(result.current.searchQuery).toBe("");
    expect(result.current.searchResults).toBeNull();
  });

  it("closeSearch resets all search state", () => {
    const { result } = renderHook(() => useTreeSearch(defaultOpts));

    act(() => {
      result.current.toggleSearch();
    });
    act(() => {
      result.current.setSearchQuery("test");
    });
    act(() => {
      result.current.closeSearch();
    });

    expect(result.current.showSearch).toBe(false);
    expect(result.current.searchQuery).toBe("");
    expect(result.current.searchResults).toBeNull();
  });

  it("debounces search and returns results", async () => {
    mockedSearchEntities.mockResolvedValue(mockSearchResponse);
    const { result } = renderHook(() => useTreeSearch(defaultOpts));

    act(() => {
      result.current.toggleSearch();
    });
    act(() => {
      result.current.setSearchQuery("Person");
    });

    expect(result.current.isSearching).toBe(true);

    await waitFor(() => {
      expect(result.current.isSearching).toBe(false);
      expect(result.current.searchResults).toEqual(mockSearchResponse.results);
    }, { timeout: 2000 });

    expect(mockedSearchEntities).toHaveBeenCalledWith("proj-1", "Person", "main");
  });

  it("does not search when query is whitespace", async () => {
    const { result } = renderHook(() => useTreeSearch(defaultOpts));

    act(() => {
      result.current.toggleSearch();
    });
    act(() => {
      result.current.setSearchQuery("   ");
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(mockedSearchEntities).not.toHaveBeenCalled();
    expect(result.current.searchResults).toBeNull();
  });

  it("does not search when search is not shown", async () => {
    const { result } = renderHook(() => useTreeSearch(defaultOpts));

    act(() => {
      result.current.setSearchQuery("test");
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(mockedSearchEntities).not.toHaveBeenCalled();
  });

  it("handleSearchSelect calls onSearchSelect and closes search", () => {
    const onSearchSelect = vi.fn();
    const { result } = renderHook(() =>
      useTreeSearch({ ...defaultOpts, onSearchSelect }),
    );

    act(() => {
      result.current.toggleSearch();
    });
    act(() => {
      result.current.handleSearchSelect("http://example.org/Person");
    });

    expect(onSearchSelect).toHaveBeenCalledWith("http://example.org/Person");
    expect(result.current.showSearch).toBe(false);
    expect(result.current.searchQuery).toBe("");
  });

  it("sets empty results on search error", async () => {
    mockedSearchEntities.mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useTreeSearch(defaultOpts));

    act(() => {
      result.current.toggleSearch();
    });
    act(() => {
      result.current.setSearchQuery("test");
    });

    await waitFor(() => {
      expect(result.current.isSearching).toBe(false);
      expect(result.current.searchResults).toEqual([]);
    }, { timeout: 2000 });
  });

  it("opens search on Cmd+K and Ctrl+K", () => {
    const { result } = renderHook(() => useTreeSearch(defaultOpts));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    });
    expect(result.current.showSearch).toBe(true);

    act(() => {
      result.current.closeSearch();
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(result.current.showSearch).toBe(true);
  });

  it("ignores K without a modifier", () => {
    const { result } = renderHook(() => useTreeSearch(defaultOpts));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    });
    expect(result.current.showSearch).toBe(false);
  });
});
