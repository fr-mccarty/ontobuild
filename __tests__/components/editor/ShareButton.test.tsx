import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, act, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });

const mockSuccess = vi.fn();
const mockError = vi.fn();

vi.mock("@/lib/context/ToastContext", () => ({
  useToast: vi.fn(() => ({ success: mockSuccess, error: mockError })),
}));

import { ShareButton } from "@/components/editor/ShareButton";

describe("ShareButton", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
    mockSuccess.mockClear();
    mockError.mockClear();
  });

  afterEach(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  const open = () => fireEvent.click(screen.getByLabelText("Share options"));

  it("renders only a caret trigger with the menu closed", () => {
    render(<ShareButton projectId="proj-1" selectedIri="http://example.org/Foo" />);
    const trigger = screen.getByLabelText("Share options");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText(/Share “/)).toBeNull();
  });

  it("shows only the project link when no class is selected", () => {
    render(<ShareButton projectId="proj-1" />);
    open();
    expect(screen.getByText("Copy project link")).toBeDefined();
    expect(screen.queryByText(/Copy link to/)).toBeNull();
  });

  it("copies the project URL", async () => {
    render(<ShareButton projectId="proj-1" />);
    open();
    await act(async () => {
      screen.getByText("Copy project link").click();
    });
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining("/projects/proj-1"));
    expect(mockSuccess).toHaveBeenCalledWith("Copied project link");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows an error toast when the clipboard fails", async () => {
    writeTextMock.mockRejectedValueOnce(new Error("fail"));
    render(<ShareButton projectId="proj-1" />);
    open();
    await act(async () => {
      screen.getByText("Copy project link").click();
    });
    expect(mockError).toHaveBeenCalledWith("Failed to copy link");
  });

  it("offers both links when a class is selected and copies the class URL", async () => {
    render(<ShareButton projectId="proj-1" selectedIri="http://example.org/Foo" selectedLabel="Foo" />);
    open();
    expect(screen.getByLabelText("Share options").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Copy project link")).toBeDefined();
    await act(async () => {
      screen.getByText(/Copy link to/).click();
    });
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining(`classIri=${encodeURIComponent("http://example.org/Foo")}`),
    );
    expect(mockSuccess).toHaveBeenCalledWith('Copied link to "Foo"');
  });

  it("truncates long labels and falls back to the local name", () => {
    const { unmount } = render(
      <ShareButton projectId="p" selectedIri="http://e.org/X" selectedLabel={"A".repeat(30)} />,
    );
    open();
    expect(screen.getByText(new RegExp(`${"A".repeat(23)}…`))).toBeDefined();
    unmount();
    render(<ShareButton projectId="p" selectedIri="http://e.org/ns#LocalThing" />);
    open();
    expect(screen.getByText(/LocalThing/)).toBeDefined();
  });

  it("closes on Escape and on outside click", () => {
    render(<ShareButton projectId="p" />);
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    open();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("ShareButton tooltip", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });

  it("explains the menu, mentioning the selected class and open PRs", async () => {
    render(<ShareButton projectId="p" selectedIri="http://e.org/X" openPRCount={3} />);
    fireEvent.focus(screen.getByLabelText("Share options"));
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Share: copy a link to this project or the selected class, or open pull requests (3 open)",
    );
  });

  it("does not show over the open menu", async () => {
    render(<ShareButton projectId="p" />);
    const trigger = screen.getByLabelText("Share options");
    fireEvent.focus(trigger);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Share: copy a link to this project, or open pull requests",
    );
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.pointerUp(document);
    expect(screen.getByRole("menu")).toBeDefined();
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.blur(trigger);
    fireEvent.focus(trigger);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  describe("overflow items", () => {
    const moreItems = (closeMenu: () => void) => (
      <button type="button" role="menuitem" className="lg:hidden" onClick={closeMenu}>
        Keyboard shortcuts
      </button>
    );

    it("renders the overflow items above the share items in a section that hides responsively", () => {
      render(<ShareButton projectId="p" moreItems={moreItems} moreHiddenClass="lg:hidden" />);
      fireEvent.click(screen.getByRole("button", { name: /^Share options/ }));
      const items = screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
      expect(items[0]).toBe("Keyboard shortcuts");
      expect(items).toContain("Copy project link");
      const section = screen.getByRole("menuitem", { name: "Keyboard shortcuts" }).parentElement!;
      expect(section.className).toBe("lg:hidden");
    });

    it("passes a function that closes the menu", () => {
      render(<ShareButton projectId="p" moreItems={moreItems} moreHiddenClass="lg:hidden" />);
      fireEvent.click(screen.getByRole("button", { name: /^Share options/ }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Keyboard shortcuts" }));
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("names the trigger 'and more' only at widths where overflow items exist", () => {
      render(<ShareButton projectId="p" moreItems={moreItems} moreHiddenClass="xl:hidden" />);
      const trigger = screen.getByRole("button", { name: /^Share options\s*and more$/ });
      expect(trigger.getAttribute("aria-label")).toBeNull();
      const more = Array.from(trigger.querySelectorAll("span.sr-only")).find((el) => el.textContent === " and more")!;
      expect(more.className).toContain("xl:hidden");
    });

    it("mentions the overflow in the tooltip, hidden from the same breakpoint", async () => {
      render(<ShareButton projectId="p" moreItems={moreItems} moreHiddenClass="lg:hidden" />);
      fireEvent.focus(screen.getByRole("button", { name: /^Share options/ }));
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toContain("Also holds the editor controls that don't fit in the bar at this width");
      expect(tooltip.querySelector("span.lg\\:hidden")).not.toBeNull();
    });

    it("keeps the plain 'Share options' label without overflow items", () => {
      render(<ShareButton projectId="p" />);
      expect(screen.getByRole("button", { name: "Share options" }).getAttribute("aria-label")).toBe("Share options");
    });
  });
});
