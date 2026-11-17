import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockHideSaveNow = false;
vi.mock("@/lib/stores/preferencesStore", () => ({
  usePreferencesStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ hideSaveButton: mockHideSaveNow }),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { AutoSaveAffordanceBar } from "@/components/editor/AutoSaveAffordanceBar";

const statusButton = () => screen.getByRole("button", { name: /about saving/ });
const openPanel = async () => {
  await userEvent.click(statusButton());
  return screen.getByRole("dialog", { name: "About saving" });
};

describe("AutoSaveAffordanceBar", () => {
  beforeEach(() => {
    mockHideSaveNow = false;
  });

  it.each([
    ["idle", "Saved"],
    ["saved", "Saved"],
    ["draft", "Unsaved changes"],
    ["saving", "Saving…"],
    ["error", "Not saved"],
  ] as const)("shows %s as '%s'", (status, label) => {
    render(<AutoSaveAffordanceBar status={status} />);
    expect(statusButton().textContent).toContain(label);
  });

  it("shows a validation error as \"Can't save\" and explains it in the panel", async () => {
    render(<AutoSaveAffordanceBar status="draft" validationError="Label is required" />);
    expect(statusButton().textContent).toContain("Can't save");
    expect((await openPanel()).textContent).toContain("Label is required");
  });

  it("has no Save, Cancel or info buttons beside the status", () => {
    render(<AutoSaveAffordanceBar status="draft" onManualSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("wraps the status in role=status, assertive only for errors", () => {
    const { rerender } = render(<AutoSaveAffordanceBar status="idle" />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    rerender(<AutoSaveAffordanceBar status="error" />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("assertive");
  });

  it("explains how saving works and links to the save setting", async () => {
    render(<AutoSaveAffordanceBar status="idle" />);
    const panel = await openPanel();
    expect(panel.textContent).toContain("Everything is saved");
    expect(panel.textContent).toContain("Edits save automatically");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings#save-button");
  });

  it("offers Save now and Discard changes for a draft", async () => {
    const onManualSave = vi.fn();
    const onCancel = vi.fn();
    render(<AutoSaveAffordanceBar status="draft" onManualSave={onManualSave} onCancel={onCancel} />);
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(onManualSave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("hides Save now when the setting says so", async () => {
    mockHideSaveNow = true;
    render(<AutoSaveAffordanceBar status="draft" onManualSave={vi.fn()} onCancel={vi.fn()} />);
    await openPanel();
    expect(screen.queryByRole("button", { name: "Save now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDefined();
  });

  it("offers no actions once everything is saved", async () => {
    render(<AutoSaveAffordanceBar status="idle" onManualSave={vi.fn()} onCancel={vi.fn()} onRetry={vi.fn()} />);
    await openPanel();
    expect(screen.queryByRole("button", { name: "Save now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows Retry beside a failed save and the reason in the panel", async () => {
    const onRetry = vi.fn();
    render(<AutoSaveAffordanceBar status="error" error="Connection lost" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect((await openPanel()).textContent).toContain("Connection lost");
  });

  it("closes the panel on Escape and on a click outside", async () => {
    render(<AutoSaveAffordanceBar status="idle" />);
    await openPanel();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await openPanel();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
