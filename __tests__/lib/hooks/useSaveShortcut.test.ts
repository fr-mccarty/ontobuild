import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { requestSave, useSaveShortcut } from "@/lib/hooks/useSaveShortcut";

describe("useSaveShortcut", () => {
  it("runs the save while enabled", () => {
    const save = vi.fn();
    renderHook(() => useSaveShortcut(true, save));
    requestSave();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("ignores save requests while disabled, and after unmount", () => {
    const save = vi.fn();
    const { rerender, unmount } = renderHook(({ on }) => useSaveShortcut(on, save), { initialProps: { on: false } });
    requestSave();
    expect(save).not.toHaveBeenCalled();
    rerender({ on: true });
    requestSave();
    expect(save).toHaveBeenCalledTimes(1);
    unmount();
    requestSave();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("calls the latest save function", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => useSaveShortcut(true, fn), { initialProps: { fn: first } });
    rerender({ fn: second });
    requestSave();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
