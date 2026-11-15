import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });

import { ResizablePanelDivider } from "@/components/editor/ResizablePanelDivider";

describe("ResizablePanelDivider", () => {
  const defaultProps = {
    width: 320,
    onWidthChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with drag-to-resize tooltip", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const { container } = render(<ResizablePanelDivider {...defaultProps} />);
    fireEvent.focus(container.querySelector(".cursor-col-resize")!);
    expect((await screen.findAllByText("Drag to resize")).length).toBeGreaterThan(0);
  });

  it("renders with cursor-col-resize class", () => {
    const { container } = render(<ResizablePanelDivider {...defaultProps} />);
    const divider = container.querySelector(".cursor-col-resize");
    expect(divider).not.toBeNull();
  });

  it("calls onWidthChange during mouse drag", () => {
    const { container } = render(<ResizablePanelDivider {...defaultProps} />);
    const divider = container.querySelector(".cursor-col-resize")!;

    fireEvent.mouseDown(divider, { clientX: 320 });
    fireEvent.mouseMove(document, { clientX: 400 });

    expect(defaultProps.onWidthChange).toHaveBeenCalledWith(400);
  });

  it("clamps width to minWidth", () => {
    const { container } = render(<ResizablePanelDivider {...defaultProps} minWidth={200} />);
    const divider = container.querySelector(".cursor-col-resize")!;

    fireEvent.mouseDown(divider, { clientX: 320 });
    fireEvent.mouseMove(document, { clientX: 120 });

    expect(defaultProps.onWidthChange).toHaveBeenCalledWith(200);
  });

  it("clamps width to maxWidth", () => {
    const { container } = render(<ResizablePanelDivider {...defaultProps} maxWidth={600} />);
    const divider = container.querySelector(".cursor-col-resize")!;

    fireEvent.mouseDown(divider, { clientX: 320 });
    fireEvent.mouseMove(document, { clientX: 720 });

    expect(defaultProps.onWidthChange).toHaveBeenCalledWith(600);
  });

  it("stops dragging on mouseup", () => {
    const { container } = render(<ResizablePanelDivider {...defaultProps} />);
    const divider = container.querySelector(".cursor-col-resize")!;

    fireEvent.mouseDown(divider, { clientX: 320 });
    fireEvent.mouseUp(document);

    defaultProps.onWidthChange.mockClear();
    fireEvent.mouseMove(document, { clientX: 500 });
    expect(defaultProps.onWidthChange).not.toHaveBeenCalled();
  });

  it("sets cursor and userSelect during drag", () => {
    const { container } = render(<ResizablePanelDivider {...defaultProps} />);
    const divider = container.querySelector(".cursor-col-resize")!;

    fireEvent.mouseDown(divider, { clientX: 320 });
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    fireEvent.mouseUp(document);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("uses default minWidth of 200 and maxWidth of 600", () => {
    const { container } = render(<ResizablePanelDivider width={300} onWidthChange={defaultProps.onWidthChange} />);
    const divider = container.querySelector(".cursor-col-resize")!;

    fireEvent.mouseDown(divider, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 0 });
    expect(defaultProps.onWidthChange).toHaveBeenCalledWith(200);

    fireEvent.mouseUp(document);
    defaultProps.onWidthChange.mockClear();

    fireEvent.mouseDown(divider, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 1000 });
    expect(defaultProps.onWidthChange).toHaveBeenCalledWith(600);
  });
});
