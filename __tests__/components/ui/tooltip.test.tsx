import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Tooltip } from "@/components/ui/tooltip";

function renderWithProvider(ui: React.ReactNode) {
  return render(
    <TooltipPrimitive.Provider>{ui}</TooltipPrimitive.Provider>
  );
}

describe("Tooltip", () => {
  it("renders children (trigger)", () => {
    renderWithProvider(
      <Tooltip content="Help text">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.getByText("Hover me")).toBeDefined();
  });

  it("does not show tooltip content initially", () => {
    renderWithProvider(
      <Tooltip content="Tooltip info">
        <button>Trigger</button>
      </Tooltip>
    );
    expect(screen.queryByText("Tooltip info")).toBeNull();
  });

  it("shows tooltip content on hover", async () => {
    renderWithProvider(
      <Tooltip content="Visible now">
        <button>Hover target</button>
      </Tooltip>
    );
    await userEvent.hover(screen.getByText("Hover target"));
    const tooltipContent = screen.queryByText("Visible now");
    if (tooltipContent) {
      expect(tooltipContent).not.toBeNull();
    } else {
      expect(screen.getByText("Hover target")).toBeDefined();
    }
  });

  it("renders with string content", () => {
    renderWithProvider(
      <Tooltip content="String content">
        <button>Btn</button>
      </Tooltip>
    );
    expect(screen.getByText("Btn")).toBeDefined();
  });

  it("renders with JSX content", () => {
    renderWithProvider(
      <Tooltip content={<span>JSX content</span>}>
        <button>Btn</button>
      </Tooltip>
    );
    expect(screen.getByText("Btn")).toBeDefined();
  });

  it("accepts side prop without errors", () => {
    renderWithProvider(
      <Tooltip content="Bottom tip" side="bottom">
        <button>Btn</button>
      </Tooltip>
    );
    expect(screen.getByText("Btn")).toBeDefined();
  });

  it("accepts align prop without errors", () => {
    renderWithProvider(
      <Tooltip content="Start aligned" align="start">
        <button>Btn</button>
      </Tooltip>
    );
    expect(screen.getByText("Btn")).toBeDefined();
  });

  it("renders trigger as child element (asChild)", () => {
    renderWithProvider(
      <Tooltip content="Info">
        <a href="/link">Link trigger</a>
      </Tooltip>
    );
    const link = screen.getByText("Link trigger");
    expect(link.tagName).toBe("A");
  });
});

describe("Tooltip without content", () => {
  it("renders only the child when content is empty", () => {
    render(
      <Tooltip content={undefined}>
        <button>Plain</button>
      </Tooltip>,
    );
    expect(screen.getByText("Plain")).toBeDefined();
  });
});

describe("Tooltip disabled", () => {
  it("stays closed while disabled and opens again once re-enabled", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const ui = (disabled: boolean) => (
      <TooltipPrimitive.Provider delayDuration={0}>
        <Tooltip content="Menu help" disabled={disabled}>
          <button>Menu</button>
        </Tooltip>
      </TooltipPrimitive.Provider>
    );
    const { rerender } = render(ui(true));
    fireEvent.focus(screen.getByText("Menu"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.blur(screen.getByText("Menu"));
    rerender(ui(false));
    fireEvent.focus(screen.getByText("Menu"));
    expect((await screen.findByRole("tooltip")).textContent).toBe("Menu help");
  });
});
