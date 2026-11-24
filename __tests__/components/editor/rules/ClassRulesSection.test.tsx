import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { Rule } from "@/lib/api/rules";

vi.mock("@/lib/api/rules", () => ({
  rulesApi: {
    list: vi.fn(),
    getViolations: vi.fn(),
    create: vi.fn(),
    replace: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("@/components/editor/ParentClassPicker", () => ({ ParentClassPicker: () => null }));

import { ClassRulesSection } from "@/components/editor/rules/ClassRulesSection";
import { rulesApi } from "@/lib/api/rules";
import { ApiError } from "@/lib/api/client";

const api = vi.mocked(rulesApi);

const CLASS_IRI = "http://example.org/Book";

function makeRule(overrides: Partial<Rule>): Rule {
  return {
    iri: "http://example.org/rule-own",
    applies_to_iri: CLASS_IRI,
    property_iri: "http://example.org/isbn",
    min_count: 1,
    max_count: null,
    value_class_iri: null,
    value_datatype_iri: null,
    allowed_values: null,
    pattern: null,
    min_length: null,
    max_length: null,
    closed: false,
    severity: "error",
    label: null,
    message: null,
    read_only: false,
    imported_from: null,
    ...overrides,
  };
}

function renderSection(props: { canEdit?: boolean; onRulesChanged?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipPrimitive.Provider>
        <ClassRulesSection projectId="p1" classIri={CLASS_IRI} classLabel="Book" canEdit={props.canEdit ?? true} onRulesChanged={props.onRulesChanged} />
      </TooltipPrimitive.Provider>
    </QueryClientProvider>,
  );
}

const noViolations = { counts: { error: 0, warning: 0, info: 0, total: 0 }, violations: [], stale: false };

describe("ClassRulesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getViolations.mockResolvedValue(noViolations as never);
  });

  it("offers edit and delete only on the class's own rules", async () => {
    api.list.mockResolvedValue({
      rules: [
        makeRule({ iri: "http://example.org/rule-own" }),
        makeRule({ iri: "http://example.org/rule-imported", read_only: true, imported_from: "http://example.org/other" }),
        makeRule({ iri: "http://example.org/rule-inherited", applies_to_iri: "http://example.org/Work" }),
      ],
    });
    renderSection();
    await waitFor(() => expect(screen.getAllByTestId("rule-row")).toHaveLength(3));
    expect(screen.getAllByRole("button", { name: "Edit rule" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete rule" })).toHaveLength(1);
    expect(screen.getAllByTestId("rule-origin")).toHaveLength(2);
  });

  it("offers no add, edit or delete to someone who cannot edit", async () => {
    api.list.mockResolvedValue({ rules: [makeRule({})] });
    renderSection({ canEdit: false });
    await waitFor(() => expect(screen.getAllByTestId("rule-row")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Edit rule" })).toBeNull();
    expect(screen.queryByRole("button", { name: /add rule/i })).toBeNull();
  });

  it("shows the server's message when it refuses a rule, and does not report the change", async () => {
    api.list.mockResolvedValue({ rules: [] });
    api.create.mockRejectedValue(new ApiError(422, "Unprocessable", JSON.stringify({ detail: "A rule needs a property and one constraint" })));
    const onRulesChanged = vi.fn();
    renderSection({ onRulesChanged });
    fireEvent.click(await screen.findByRole("button", { name: /add rule/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Save rule" }));
    expect((await screen.findByRole("alert")).textContent).toBe("A rule needs a property and one constraint");
    expect(onRulesChanged).not.toHaveBeenCalled();
  });

  it("reports the change after a rule is deleted", async () => {
    api.list.mockResolvedValue({ rules: [makeRule({})] });
    api.remove.mockResolvedValue(undefined);
    const onRulesChanged = vi.fn();
    renderSection({ onRulesChanged });
    fireEvent.click(await screen.findByRole("button", { name: "Delete rule" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onRulesChanged).toHaveBeenCalledTimes(1));
    expect(api.remove).toHaveBeenCalledWith("p1", "http://example.org/rule-own", undefined);
  });
});
