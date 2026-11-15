import { describe, it, expect, vi, beforeAll } from "vitest";
import { render as rtlRender, screen, fireEvent, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";
import { RightSidebar, lintSeverity } from "@/components/editor/RightSidebar";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function setup(lintSummary = { total_issues: 3, error_count: 0, warning_count: 2 }) {
  const onClose = vi.fn();
  const health = vi.fn((active: boolean) => <div>Health content {active ? "active" : "inactive"}</div>);
  const utils = render(
    <RightSidebar onClose={onClose} lintSummary={lintSummary} agent={<div>Agent content</div>} health={health} />,
  );
  return { ...utils, onClose, health };
}

describe("RightSidebar", () => {
  it("opens on the Agent tab", () => {
    setup();
    expect(screen.getByRole("tab", { name: /Agent/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Agent content")).toBeDefined();
    expect(screen.getByText("Health content inactive")).toBeDefined();
  });

  it("switches to Health and keeps the agent mounted", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /Health/ }));
    expect(screen.getByRole("tab", { name: /Health/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Health content active")).toBeDefined();
    expect(screen.getByText("Agent content")).toBeDefined();
  });

  it("shows the lint issue badge on the Health tab", () => {
    setup();
    expect(screen.getByTestId("health-tab-badge").textContent).toBe("3");
  });

  it("hides the badge when there are no issues", () => {
    setup({ total_issues: 0, error_count: 0, warning_count: 0 });
    expect(screen.queryByTestId("health-tab-badge")).toBeNull();
  });

  it("calls onClose from the close button", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByLabelText("Close panel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("starts on the Agent tab again after reopening", () => {
    const { unmount } = setup();
    fireEvent.click(screen.getByRole("tab", { name: /Health/ }));
    unmount();
    setup();
    expect(screen.getByRole("tab", { name: /Agent/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("computes lint severity", () => {
    expect(lintSeverity(null)).toBeNull();
    expect(lintSeverity({ total_issues: 1, error_count: 1, warning_count: 0 })).toBe("error");
    expect(lintSeverity({ total_issues: 1, error_count: 0, warning_count: 1 })).toBe("warning");
    expect(lintSeverity({ total_issues: 1, error_count: 0, warning_count: 0 })).toBe("info");
  });
});
