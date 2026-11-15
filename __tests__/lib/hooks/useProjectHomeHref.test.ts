import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useProjectHomeHref } from "@/lib/hooks/useProjectHomeHref";
import { useSelectionStore } from "@/lib/stores/selectionStore";

let mockSearch = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

const ENCODED_PERSON = encodeURIComponent("http://example.org/Person");
const ENCODED_HAS_NAME = encodeURIComponent("http://example.org/hasName");
const ENCODED_ALICE = encodeURIComponent("http://example.org/alice");

describe("useProjectHomeHref", () => {
  beforeEach(() => {
    mockSearch = "";
    useSelectionStore.getState().clear();
  });

  it("returns the bare project URL when no selection is set", () => {
    const { result } = renderHook(() => useProjectHomeHref("proj-1"));
    expect(result.current).toBe("/projects/proj-1");
  });

  it("appends a class IRI selection from the store", () => {
    useSelectionStore.getState().setSelection("http://example.org/Person", "class");
    const { result } = renderHook(() => useProjectHomeHref("proj-1"));
    expect(result.current).toBe(`/projects/proj-1?classIri=${ENCODED_PERSON}`);
  });

  it("appends a property IRI selection from the store", () => {
    useSelectionStore.getState().setSelection("http://example.org/hasName", "property");
    const { result } = renderHook(() => useProjectHomeHref("proj-1"));
    expect(result.current).toBe(`/projects/proj-1?propertyIri=${ENCODED_HAS_NAME}`);
  });

  it("appends an individual IRI selection from the store", () => {
    useSelectionStore.getState().setSelection("http://example.org/alice", "individual");
    const { result } = renderHook(() => useProjectHomeHref("proj-1"));
    expect(result.current).toBe(`/projects/proj-1?individualIri=${ENCODED_ALICE}`);
  });

  it("falls back to URL params when the store is empty", () => {
    mockSearch = `individualIri=${ENCODED_ALICE}`;
    const { result } = renderHook(() => useProjectHomeHref("proj-1"));
    expect(result.current).toBe(`/projects/proj-1?individualIri=${ENCODED_ALICE}`);
  });

  it("prefers the store over URL params when both are set", () => {
    mockSearch = `classIri=${encodeURIComponent("http://example.org/Stale")}`;
    useSelectionStore.getState().setSelection("http://example.org/hasName", "property");
    const { result } = renderHook(() => useProjectHomeHref("proj-1"));
    expect(result.current).toBe(`/projects/proj-1?propertyIri=${ENCODED_HAS_NAME}`);
  });
});
