import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { AgentNotice } from "@/components/editor/agent/AgentNotice";

describe("AgentNotice", () => {
  it("always has an X that closes it, after its actions", () => {
    const onDismiss = vi.fn();
    render(
      <TooltipPrimitive.Provider>
        <AgentNotice tone="error" icon={null} onDismiss={onDismiss} actions={<button>Retry</button>} role="alert">
          Something failed
        </AgentNotice>
      </TooltipPrimitive.Provider>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something failed");
    const buttons = Array.from(alert.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Retry", "Dismiss"]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
