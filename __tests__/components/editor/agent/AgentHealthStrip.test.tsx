import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { AgentHealthSummary } from "@/lib/agent/healthSummary";
import { AgentHealthStrip } from "@/components/editor/agent/AgentHealthStrip";

const health = (consistency: number): AgentHealthSummary =>
  ({ lint: null, consistency: { count: consistency, checkedAt: "2026-11-17T10:00:00Z" }, duplicates: null }) as AgentHealthSummary;

const strip = (h: AgentHealthSummary) => (
  <TooltipPrimitive.Provider>
    <AgentHealthStrip health={h} onFix={vi.fn()} />
  </TooltipPrimitive.Provider>
);

describe("AgentHealthStrip", () => {
  it("closes with the X, and comes back when the issues change", () => {
    const { rerender } = render(strip(health(2)));
    expect(screen.getByTestId("agent-health-strip")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("agent-health-strip")).toBeNull();

    // Same issues: stays closed.
    rerender(strip(health(2)));
    expect(screen.queryByTestId("agent-health-strip")).toBeNull();

    // A change: shows again.
    rerender(strip(health(3)));
    expect(screen.getByTestId("agent-health-strip")).toBeDefined();
  });
});
