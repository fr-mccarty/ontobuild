import React, { type ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEntityCounts } from "@/lib/hooks/useEntityCounts";

vi.mock("@/lib/api/client", () => ({
  projectOntologyApi: {
    searchEntities: vi.fn(),
  },
}));

import { projectOntologyApi } from "@/lib/api/client";

const mockedSearch = projectOntologyApi.searchEntities as ReturnType<typeof vi.fn>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useEntityCounts", () => {
  it("counts properties and individuals on the branch", async () => {
    mockedSearch.mockImplementation(async (_p: string, _q: string, _b: string, type: string) => ({
      results: [],
      total: type === "property" ? 12 : 4,
    }));
    const { result } = renderHook(() => useEntityCounts("proj-1", "main"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ properties: 12, individuals: 4 });
    expect(mockedSearch).toHaveBeenCalledWith("proj-1", "*", "main", "property", 0);
    expect(mockedSearch).toHaveBeenCalledWith("proj-1", "*", "main", "individual", 0);
  });

  it("waits for a branch", () => {
    const { result } = renderHook(() => useEntityCounts("proj-1", undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockedSearch).not.toHaveBeenCalled();
  });
});
