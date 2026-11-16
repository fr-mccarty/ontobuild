import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useEditorSidebars,
  visibleSidebars,
  EDITOR_SIDEBARS_KEY,
  NARROW_EDITOR_QUERY,
} from "@/lib/hooks/useEditorSidebars";

/** A controllable matchMedia: `setNarrow` flips the query and notifies listeners. */
function mockMatchMedia(initialNarrow: boolean) {
  let narrow = initialNarrow;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === NARROW_EDITOR_QUERY && narrow;
    },
    media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
  return {
    setNarrow(next: boolean) {
      narrow = next;
      act(() => listeners.forEach((l) => l()));
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("visibleSidebars", () => {
  it("shows both when wide", () => {
    expect(visibleSidebars({ left: true, right: true, last: "left" }, false)).toEqual({ left: true, right: true });
  });
  it("shows only the most recently opened one when narrow", () => {
    expect(visibleSidebars({ left: true, right: true, last: "left" }, true)).toEqual({ left: true, right: false });
    expect(visibleSidebars({ left: true, right: true, last: "right" }, true)).toEqual({ left: false, right: true });
  });
  it("prefers the right panel when it is unknown which opened last", () => {
    expect(visibleSidebars({ left: true, right: true }, true)).toEqual({ left: false, right: true });
  });
  it("shows a single open sidebar either way", () => {
    expect(visibleSidebars({ left: true, right: false }, true)).toEqual({ left: true, right: false });
  });
});

describe("useEditorSidebars on a wide window", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("opens both sidebars by default", () => {
    const { result } = renderHook(() => useEditorSidebars());
    expect(result.current.leftOpen).toBe(true);
    expect(result.current.rightOpen).toBe(true);
  });

  it("toggles each sidebar independently", () => {
    const { result } = renderHook(() => useEditorSidebars());
    act(() => result.current.toggleLeft());
    expect(result.current.leftOpen).toBe(false);
    expect(result.current.rightOpen).toBe(true);
    act(() => result.current.toggleLeft());
    expect(result.current.leftOpen).toBe(true);
    expect(result.current.rightOpen).toBe(true);
    act(() => result.current.closeRight());
    expect(result.current.rightOpen).toBe(false);
    expect(result.current.leftOpen).toBe(true);
  });
});

describe("useEditorSidebars on a narrow window", () => {
  it("shows only one sidebar, and opening one closes the other", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useEditorSidebars());
    expect(result.current.rightOpen).toBe(true);
    expect(result.current.leftOpen).toBe(false);

    act(() => result.current.toggleLeft());
    expect(result.current.leftOpen).toBe(true);
    expect(result.current.rightOpen).toBe(false);
    expect(result.current.state).toEqual({ left: true, right: false, last: "left" });

    act(() => result.current.toggleRight());
    expect(result.current.rightOpen).toBe(true);
    expect(result.current.leftOpen).toBe(false);
    expect(result.current.state).toEqual({ left: false, right: true, last: "right" });

    act(() => result.current.closeRight());
    expect(result.current.rightOpen).toBe(false);
    expect(result.current.leftOpen).toBe(false);
  });

  it("keeps only the last opened sidebar when the window narrows, and shows both again when it widens", () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useEditorSidebars());
    act(() => result.current.toggleLeft());
    act(() => result.current.toggleLeft()); // left closed then reopened last
    expect(result.current.leftOpen).toBe(true);
    expect(result.current.rightOpen).toBe(true);

    media.setNarrow(true);
    expect(result.current.leftOpen).toBe(true);
    expect(result.current.rightOpen).toBe(false);

    media.setNarrow(false);
    expect(result.current.leftOpen).toBe(true);
    expect(result.current.rightOpen).toBe(true);
  });

  it("shows the right panel when narrowing with both open and no recorded order", () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useEditorSidebars());
    media.setNarrow(true);
    expect(result.current.rightOpen).toBe(true);
    expect(result.current.leftOpen).toBe(false);
  });

  it("brings a hidden open sidebar forward when its toggle is pressed", () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useEditorSidebars());
    media.setNarrow(true);
    expect(result.current.leftOpen).toBe(false);
    act(() => result.current.toggleLeft());
    expect(result.current.leftOpen).toBe(true);
    expect(result.current.rightOpen).toBe(false);
  });
});

describe("useEditorSidebars persistence", () => {
  it("persists the open states and restores them", () => {
    mockMatchMedia(false);
    const first = renderHook(() => useEditorSidebars());
    act(() => first.result.current.closeRight());
    expect(JSON.parse(localStorage.getItem(EDITOR_SIDEBARS_KEY)!)).toEqual({ left: true, right: false });
    first.unmount();
    const second = renderHook(() => useEditorSidebars());
    expect(second.result.current.rightOpen).toBe(false);
    expect(second.result.current.leftOpen).toBe(true);
  });

  it("falls back to the default for unreadable stored state", () => {
    mockMatchMedia(false);
    localStorage.setItem(EDITOR_SIDEBARS_KEY, "garbage");
    const { result } = renderHook(() => useEditorSidebars());
    expect(result.current.state).toEqual({ left: true, right: true });
  });

  it("still works when storage is unavailable", () => {
    mockMatchMedia(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useEditorSidebars());
    act(() => result.current.toggleLeft());
    expect(result.current.leftOpen).toBe(true);
    expect(result.current.rightOpen).toBe(false);
  });
});
