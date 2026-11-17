import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";
import { DisclosureBody, DisclosureSection, DisclosureToggle } from "@/components/editor/shared/Disclosure";

const render = (ui: ReactElement) => rtlRender(<TooltipPrimitive.Provider>{ui}</TooltipPrimitive.Provider>);

describe("Disclosure", () => {
  it("shows a right chevron while closed and a down chevron while open, and toggles", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<DisclosureToggle open={false} onToggle={onToggle}>Used By (3)</DisclosureToggle>);
    const button = screen.getByRole("button", { name: "Used By (3)" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.querySelector("[data-testid='disclosure-chevron']")!.getAttribute("class")).toContain("lucide-chevron-right");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<TooltipPrimitive.Provider><DisclosureToggle open onToggle={onToggle}>Used By (3)</DisclosureToggle></TooltipPrimitive.Provider>);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.querySelector("[data-testid='disclosure-chevron']")!.getAttribute("class")).toContain("lucide-chevron-down");
  });

  it("renders the body only while open", () => {
    const { rerender } = render(<DisclosureBody open={false}>Items</DisclosureBody>);
    expect(screen.queryByText("Items")).toBeNull();
    rerender(<TooltipPrimitive.Provider><DisclosureBody open>Items</DisclosureBody></TooltipPrimitive.Provider>);
    expect(screen.getByTestId("disclosure-body").textContent).toBe("Items");
  });

  it("puts the open content under the heading, beside a line, and the aside beside the heading", () => {
    render(
      <DisclosureSection icon={null} title="Used By" count={2} defaultOpen aside={<button>Add</button>}>
        refs
      </DisclosureSection>,
    );
    const toggle = screen.getByRole("button", { name: "Used By (2)" });
    const line = screen.getByTestId("disclosure-line");
    const openRow = line.parentElement!;
    // Second row: the line and the content together, not the heading.
    expect(openRow.contains(screen.getByText("refs"))).toBe(true);
    expect(openRow.contains(toggle)).toBe(false);
    expect(toggle.compareDocumentPosition(openRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The aside stays on the heading row, so opening and closing can't move it.
    expect(openRow.contains(screen.getByRole("button", { name: "Add" }))).toBe(false);
    fireEvent.click(toggle);
    expect(screen.queryByTestId("disclosure-line")).toBeNull();
    expect(screen.queryByText("refs")).toBeNull();
  });

  it("starts a section open or closed as asked, toggles it from its label, and starts again under a new key", () => {
    const section = (key: string, defaultOpen: boolean) => (
      <TooltipPrimitive.Provider>
        <DisclosureSection key={key} icon={null} title="Subclasses" count={2} defaultOpen={defaultOpen}>
          Cat, Dog
        </DisclosureSection>
      </TooltipPrimitive.Provider>
    );
    const { rerender } = rtlRender(section("A", true));
    expect(screen.getByText("Cat, Dog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Subclasses (2)" }));
    expect(screen.queryByText("Cat, Dog")).toBeNull();
    rerender(section("B", true));
    expect(screen.getByText("Cat, Dog")).toBeDefined();
    rerender(section("C", false));
    expect(screen.queryByText("Cat, Dog")).toBeNull();
  });

  it("shows a label without a chevron when there is nothing to open", () => {
    render(
      <DisclosureSection icon={null} title="Individuals" count={0} defaultOpen openable={false} aside={<button>Add individual</button>}>
        nothing
      </DisclosureSection>,
    );
    expect(screen.getByText("Individuals (0)")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Individuals/ })).toBeNull();
    expect(screen.queryByText("nothing")).toBeNull();
    expect(screen.getByRole("button", { name: "Add individual" })).toBeDefined();
  });
});
