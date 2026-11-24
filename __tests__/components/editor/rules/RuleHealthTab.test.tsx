import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

vi.mock("@/lib/api/rules", () => ({
  rulesApi: {
    getViolations: vi.fn(),
    validate: vi.fn(),
    getJobResult: vi.fn(),
    shaclUrl: () => "/shacl",
  },
}));

import { RuleHealthTab } from "@/components/editor/rules/RuleHealthTab";
import { rulesApi } from "@/lib/api/rules";

const api = vi.mocked(rulesApi);

const violation = {
  rule_iri: "http://example.org/rule-1",
  applies_to_iri: "http://example.org/Book",
  focus_node: "http://example.org/book-1",
  property_iri: "http://example.org/isbn",
  value: "12",
  constraint: "pattern",
  severity: "error",
  message: "ISBN must have 13 digits",
};

const latest = (overrides: Record<string, unknown>) => ({
  project_id: "p1",
  branch: "main",
  commit_hash: "abc",
  checked_at: "2026-11-20T10:00:00Z",
  duration_ms: 5,
  rule_count: 1,
  counts: { error: 1, warning: 0, info: 0, total: 1 },
  violations: [violation],
  stale: false,
  ...overrides,
});

function renderTab(onNavigate = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipPrimitive.Provider>
        <RuleHealthTab projectId="p1" onNavigate={onNavigate} />
      </TooltipPrimitive.Provider>
    </QueryClientProvider>,
  );
  return onNavigate;
}

describe("RuleHealthTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the entity that a violation names", async () => {
    api.getViolations.mockResolvedValue(latest({}) as never);
    const onNavigate = renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /book-1/ }));
    expect(onNavigate).toHaveBeenCalledWith("http://example.org/book-1", "individual");
  });

  it("warns only when the results are for an older commit", async () => {
    api.getViolations.mockResolvedValue(latest({ stale: true }) as never);
    renderTab();
    expect(await screen.findByTestId("rule-results-stale")).toBeDefined();
  });

  it("shows no stale notice for current results", async () => {
    api.getViolations.mockResolvedValue(latest({}) as never);
    renderTab();
    await screen.findByTestId("rule-violations");
    expect(screen.queryByTestId("rule-results-stale")).toBeNull();
  });

  it("shows the server's error when validation cannot start", async () => {
    api.getViolations.mockResolvedValue(latest({ violations: [], counts: { error: 0, warning: 0, info: 0, total: 0 } }) as never);
    api.validate.mockRejectedValue(new Error("Ontology could not be parsed"));
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /run validation/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Ontology could not be parsed"));
  });
});
