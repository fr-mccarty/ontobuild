import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const nav = vi.hoisted(() => ({ params: null as Record<string, string> | null }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  useSearchParams: () => new URLSearchParams("branch=main"),
}));

const lookup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/provenance", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/provenance")>();
  return { ...actual, provenanceApi: { ...actual.provenanceApi, lookup } };
});

import { RunAsPromptButton } from "@/components/editor/RunAsPromptButton";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";

const COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";
const PIZZA = "http://example.org/pizza#Pizza";

function wrap(children: ReactNode, withClient = false) {
  const inner = <TooltipPrimitive.Provider>{children}</TooltipPrimitive.Provider>;
  if (!withClient) return inner;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{inner}</QueryClientProvider>;
}

function provenance(status: string, pr: number | null) {
  return {
    iri: PIZZA,
    property: COMMENT,
    value: "Describe a pizza",
    status,
    introduced_in: null,
    on_default_branch: status !== "pending",
    pull_request: pr === null ? null : { number: pr, title: "t", status: status === "approved" ? "merged" : "open", merged_at: null, merged_by: null, approvals: status === "approved" ? [{ reviewer: "Ann", at: "2026-01-01T00:00:00Z" }] : [] },
  };
}

describe("RunAsPromptButton", () => {
  beforeEach(() => {
    nav.params = null;
    lookup.mockReset();
    useWorkspaceStore.setState({ pendingPrompt: null, rightTab: "files" });
  });

  it("is disabled when the text is empty", () => {
    render(wrap(<RunAsPromptButton text="  " propertyIri={COMMENT} subjectIri={PIZZA} />));
    expect((screen.getByRole("button", { name: "Run as prompt" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks before using unapproved text, and can be cancelled", () => {
    render(wrap(<RunAsPromptButton text="Describe a pizza" propertyIri={COMMENT} subjectIri={PIZZA} />));
    fireEvent.click(screen.getByRole("button", { name: "Run as prompt" }));
    expect(screen.getByRole("dialog").textContent).toContain("hasn't been approved through a pull request yet");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useWorkspaceStore.getState().pendingPrompt).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Run as prompt" }));
    fireEvent.click(screen.getByRole("button", { name: "Use anyway" }));
    expect(useWorkspaceStore.getState().pendingPrompt).toEqual({ text: "Describe a pizza", source: "Pizza · comment" });
    expect(useWorkspaceStore.getState().rightTab).toBe("agent");
  });

  it("queues approved text straight away with its PR in the source", async () => {
    nav.params = { id: "p1" };
    lookup.mockResolvedValue(provenance("approved", 12));
    render(wrap(<RunAsPromptButton text="Describe a pizza" propertyIri={COMMENT} subjectIri={PIZZA} />, true));
    const button = screen.getByRole("button", { name: "Run as prompt" });
    await waitFor(() => expect(button.getAttribute("data-status")).toBe("approved"), { timeout: 2000 });
    expect(lookup).toHaveBeenCalledWith("p1", { iri: PIZZA, property: COMMENT, value: "Describe a pizza" }, "main");
    expect(screen.getByTestId("prompt-approval-dot").className).toContain("bg-emerald-500");
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useWorkspaceStore.getState().pendingPrompt).toEqual({
      text: "Describe a pizza",
      source: "Pizza · comment (approved in PR #12)",
    });
  });

  it("shows pending text as not approved and confirms first", async () => {
    nav.params = { id: "p1" };
    lookup.mockResolvedValue(provenance("pending", 3));
    render(wrap(<RunAsPromptButton text="Describe a pizza" propertyIri={COMMENT} subjectIri={PIZZA} />, true));
    const button = screen.getByRole("button", { name: "Run as prompt" });
    await waitFor(() => expect(button.getAttribute("data-status")).toBe("pending"), { timeout: 2000 });
    expect(screen.getByTestId("prompt-approval-dot").className).toContain("bg-amber-500");
    fireEvent.click(button);
    expect(screen.getByRole("dialog").textContent).toContain("pending in pull request #3");
    fireEvent.click(screen.getByRole("button", { name: "Use anyway" }));
    expect(useWorkspaceStore.getState().pendingPrompt?.source).toBe("Pizza · comment (pending in PR #3)");
  });
});
