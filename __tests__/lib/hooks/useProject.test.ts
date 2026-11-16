import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useProject } from "@/lib/hooks/useProject";
import { ApiError } from "@/lib/api/client";
import type { Project } from "@/lib/api/projects";

vi.mock("@/lib/api/projects", () => ({
  projectApi: {
    get: vi.fn(),
  },
}));

import { projectApi } from "@/lib/api/projects";

const mockedGet = projectApi.get as ReturnType<typeof vi.fn>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    is_public: true,
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns loading state initially", () => {
    mockedGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useProject("proj-1"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.project).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.errorKind).toBeNull();
  });

  it("returns project data on success", async () => {
    const project = makeProject({ id: "proj-1", name: "My Project" });
    mockedGet.mockResolvedValue(project);

    const { result } = renderHook(() => useProject("proj-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.project).toEqual(project);
    expect(result.current.error).toBeNull();
    expect(result.current.errorKind).toBeNull();
  });

  it("classifies 403 with token as no-access", async () => {
    mockedGet.mockRejectedValue(
      new ApiError(403, "Forbidden", "Not allowed")
    );

    const { result } = renderHook(() => useProject("proj-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.errorKind).toBe("no-access");
    expect(result.current.error).toBe("You don't have access to this project");
  });

  it("classifies 404 as not-found", async () => {
    mockedGet.mockRejectedValue(
      new ApiError(404, "Not Found", "Project not found")
    );

    const { result } = renderHook(() => useProject("proj-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.errorKind).toBe("not-found");
    expect(result.current.error).toBe("Project not found");
  });

  it("classifies other errors as generic with the error message", async () => {
    mockedGet.mockRejectedValue(new Error("Network failure"));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useProject("proj-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    expect(result.current.errorKind).toBe("generic");
    expect(result.current.error).toBe("Network failure");
  });

  it("classifies non-Error throwable as generic with fallback message", async () => {
    mockedGet.mockRejectedValue("something weird");

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useProject("proj-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    expect(result.current.errorKind).toBe("generic");
    expect(result.current.error).toBe("Failed to load project");
  });

  it("does not fetch when projectId is empty", async () => {
    const { result } = renderHook(() => useProject(""), {
      wrapper: createWrapper(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockedGet).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it("provides a refetch function", async () => {
    mockedGet.mockResolvedValue(makeProject());

    const { result } = renderHook(() => useProject("proj-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(typeof result.current.refetch).toBe("function");
  });
});
