import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/hooks/useCrossReferences", () => ({
  useCrossReferences: vi.fn(),
}));

import { CrossReferencesPanel } from "@/components/editor/CrossReferencesPanel";
import { useCrossReferences } from "@/lib/hooks/useCrossReferences";

const mockUseCrossReferences = vi.mocked(useCrossReferences);

describe("CrossReferencesPanel", () => {
  it("returns null when entityIri is null", () => {
    mockUseCrossReferences.mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<typeof useCrossReferences>);
    const { container } = render(
      <CrossReferencesPanel projectId="p1" entityIri={null} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows Used By (0) with nothing to open when nothing refers to the entity", () => {
    mockUseCrossReferences.mockReturnValue({
      data: { target_iri: "http://example.org/A", total: 0, groups: [] },
      isLoading: false,
    } as unknown as ReturnType<typeof useCrossReferences>);
    render(<CrossReferencesPanel projectId="p1" entityIri="http://example.org/A" />);
    expect(screen.getByText("Used By (0)")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Used By/ })).toBeNull();
  });

  it("shows loading indicator", () => {
    mockUseCrossReferences.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useCrossReferences>);
    render(
      <CrossReferencesPanel projectId="p1" entityIri="http://example.org/A" />
    );
    expect(screen.getByText("Used By (...)")).toBeDefined();
  });

  it("shows total count when loaded", () => {
    mockUseCrossReferences.mockReturnValue({
      data: {
        total: 3,
        groups: [
          {
            context: "parent_iris" as const,
            context_label: "As parent class",
            references: [
              { source_iri: "http://example.org/B", source_label: "B", source_type: "class", reference_context: "parent_iris" },
              { source_iri: "http://example.org/C", source_label: "C", source_type: "class", reference_context: "parent_iris" },
              { source_iri: "http://example.org/D", source_label: "D", source_type: "class", reference_context: "parent_iris" },
            ],
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCrossReferences>);
    render(
      <CrossReferencesPanel projectId="p1" entityIri="http://example.org/A" />
    );
    expect(screen.getByText("Used By (3)")).toBeDefined();
  });

  it("expands to show reference groups on click", async () => {
    mockUseCrossReferences.mockReturnValue({
      data: {
        total: 1,
        groups: [
          {
            context: "parent_iris" as const,
            context_label: "As parent class",
            references: [
              { source_iri: "http://example.org/B", source_label: "ClassB", source_type: "class", reference_context: "parent_iris" },
            ],
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCrossReferences>);
    render(
      <CrossReferencesPanel projectId="p1" entityIri="http://example.org/A" />
    );
    // Open from the start; the label closes it.
    expect(screen.getByText("As parent class (1)")).toBeDefined();
    expect(screen.getByText("ClassB")).toBeDefined();
    await userEvent.click(screen.getByText("Used By (1)"));
    expect(screen.queryByText("As parent class (1)")).toBeNull();
  });

  it("calls onNavigateToClass when a reference is clicked", async () => {
    const onNavigate = vi.fn();
    mockUseCrossReferences.mockReturnValue({
      data: {
        total: 1,
        groups: [
          {
            context: "domain_iris" as const,
            context_label: "As domain",
            references: [
              { source_iri: "http://example.org/B", source_label: "ClassB", source_type: "property", reference_context: "domain_iris" },
            ],
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useCrossReferences>);
    render(
      <CrossReferencesPanel
        projectId="p1"
        entityIri="http://example.org/A"
        onNavigateToClass={onNavigate}
      />
    );
    await userEvent.click(screen.getByText("ClassB"));
    expect(onNavigate).toHaveBeenCalledWith("http://example.org/B");
  });
});
