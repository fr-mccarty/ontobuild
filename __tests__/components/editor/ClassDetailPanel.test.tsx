import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { render as rtlRender, screen, waitFor, fireEvent, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });
import userEvent from "@testing-library/user-event";

const mockTriggerSave = vi.fn();
const mockFlushToGit = vi.fn().mockResolvedValue(true);
const mockDiscardDraft = vi.fn();
const mockClearRestoredDraft = vi.fn();
const mockEditStateRef = { current: null as Record<string, unknown> | null };

let autoSaveOverrides: Record<string, unknown> = {};

let preferencesOverrides: Record<string, unknown> = {};

vi.mock("@/lib/api/client", () => ({
  projectOntologyApi: {
    getClassDetail: vi.fn(),
    updateClass: vi.fn(),
    searchEntities: vi.fn(),
  },
}));

vi.mock("@/lib/api/lint", () => ({
  lintApi: { getIssues: vi.fn() },
}));

vi.mock("@/lib/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/hooks/useAutoSave", () => ({
  useAutoSave: () => ({
    saveStatus: "idle",
    saveError: null,
    validationError: null,
    isDirty: false,
    triggerSave: mockTriggerSave,
    flushToGit: mockFlushToGit,
    discardDraft: mockDiscardDraft,
    editStateRef: mockEditStateRef,
    restoredDraft: null,
    clearRestoredDraft: mockClearRestoredDraft,
    ...autoSaveOverrides,
  }),
}));

vi.mock("@/lib/stores/preferencesStore", () => ({
  usePreferencesStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ ...preferencesOverrides }),
}));

vi.mock("@/components/editor/ParentClassPicker", () => ({
  ParentClassPicker: () => null,
}));
let capturedAnnotationRowProps: Array<Record<string, unknown>> = [];
vi.mock("@/components/editor/standard/AnnotationRow", () => ({
  AnnotationRow: (props: Record<string, unknown>) => {
    capturedAnnotationRowProps.push(props);
    return null;
  },
}));
let capturedInlineAnnotationAdderProps: Record<string, unknown> | null = null;
vi.mock("@/components/editor/standard/InlineAnnotationAdder", () => ({
  InlineAnnotationAdder: (props: Record<string, unknown>) => {
    capturedInlineAnnotationAdderProps = props;
    return null;
  },
}));
let capturedRelationshipSectionProps: Record<string, unknown> | null = null;
vi.mock("@/components/editor/standard/RelationshipSection", () => ({
  RelationshipSection: (props: Record<string, unknown>) => {
    capturedRelationshipSectionProps = props;
    return null;
  },
}));
let _autoSaveBarProps: Record<string, unknown> = {};
vi.mock("@/components/editor/AutoSaveAffordanceBar", () => ({
  AutoSaveAffordanceBar: (props: Record<string, unknown>) => {
    _autoSaveBarProps = props;
    return (
      <div data-testid="auto-save-bar">
        {typeof props.onCancel === "function" && (
          <button data-testid="cancel-edit" onClick={props.onCancel as () => void}>Cancel</button>
        )}
        {typeof props.onManualSave === "function" && (
          <button data-testid="manual-save" onClick={props.onManualSave as () => void}>Save</button>
        )}
      </div>
    );
  },
}));
vi.mock("@/components/editor/rules/ClassRulesSection", () => ({
  ClassRulesSection: () => null,
}));
vi.mock("@/components/editor/CrossReferencesPanel", () => ({
  CrossReferencesPanel: () => null,
}));
vi.mock("@/components/editor/EntityHistoryTab", () => ({
  EntityHistoryTab: () => null,
}));

import { ClassDetailPanel, ensureTrailingEmpty } from "@/components/editor/ClassDetailPanel";
import { projectOntologyApi } from "@/lib/api/client";
import { lintApi } from "@/lib/api/lint";

const mockGetClassDetail = projectOntologyApi.getClassDetail as Mock;
const mockGetIssues = lintApi.getIssues as Mock;
const mockSearchEntities = projectOntologyApi.searchEntities as Mock;

function makeClassDetail(overrides: Record<string, unknown> = {}) {
  return {
    iri: "http://example.org/ontology#Person",
    labels: [{ value: "Person" }],
    comments: [{ value: "A human being" }],
    deprecated: false,
    parent_iris: ["http://example.org/ontology#Agent"],
    parent_labels: { "http://example.org/ontology#Agent": "Agent" },
    equivalent_iris: null,
    disjoint_iris: null,
    child_count: 5,
    instance_count: 42,
    annotations: [],
    ...overrides,
  };
}

function makeLintIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    run_id: "run-1",
    project_id: "proj-1",
    issue_type: "warning" as const,
    rule_id: "MISSING_LABEL",
    message: "Class is missing an rdfs:label",
    subject_iri: "http://example.org/ontology#Person",
    details: null,
    created_at: "2024-01-01T00:00:00Z",
    resolved_at: null,
    ...overrides,
  };
}

const DEFAULT_PROPS = {
  projectId: "proj-1",
  classIri: "http://example.org/ontology#Person",
  branch: "main",
};

describe("ClassDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetClassDetail.mockResolvedValue(makeClassDetail());
    mockGetIssues.mockResolvedValue({ items: [] });
    mockSearchEntities.mockResolvedValue({ results: [] });
    autoSaveOverrides = {};
    preferencesOverrides = {};
    mockEditStateRef.current = null;
    mockFlushToGit.mockResolvedValue(true);
    capturedAnnotationRowProps = [];
    capturedInlineAnnotationAdderProps = null;
    capturedRelationshipSectionProps = null;
  });

  it("renders 'Select a class' placeholder when classIri is null", () => {
    render(<ClassDetailPanel projectId="proj-1" classIri={null} />);
    expect(
      screen.getByText("Select a class from the tree to view its details")
    ).toBeDefined();
  });

  it("shows a loading spinner while fetching", () => {
    mockGetClassDetail.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ClassDetailPanel {...DEFAULT_PROPS} />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows error message when API call fails", async () => {
    mockGetClassDetail.mockRejectedValue(new Error("Network failure"));
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Network failure")).toBeDefined();
    });
  });

  it("shows entity-type hint for 404 errors", async () => {
    mockGetClassDetail.mockRejectedValue(new Error("Class not found"));
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Could not load .* as an OWL Class/)
      ).toBeDefined();
    });
  });

  it("suppresses 404 error when selectedNodeFallback matches classIri", async () => {
    mockGetClassDetail.mockRejectedValue(new Error("Class not found"));
    const fallback = {
      label: "NewClass",
      iri: "http://example.org/ontology#Person",
    };
    render(
      <ClassDetailPanel {...DEFAULT_PROPS} selectedNodeFallback={fallback} />
    );

    await waitFor(() => {
      expect(screen.getAllByText("NewClass").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Unsaved")).toBeDefined();
    });
  });

  it("renders class detail with label and IRI", async () => {
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getAllByText("Person").length).toBeGreaterThanOrEqual(1);
    });
    expect(
      screen.getByText("http://example.org/ontology#Person")
    ).toBeDefined();
  });

  it("renders comments section", async () => {
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("A human being")).toBeDefined();
    });
  });

  it("renders parent class link", async () => {
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Agent")).toBeDefined();
    });
  });

  it("renders deprecated badge when class is deprecated", async () => {
    mockGetClassDetail.mockResolvedValue(makeClassDetail({ deprecated: true }));
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Deprecated")).toBeDefined();
    });
  });

  it("shows Subclasses and Individuals as their own sections, with counts", async () => {
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Subclasses (5)")).toBeDefined();
      expect(screen.getByText("Individuals (42)")).toBeDefined();
    });
    expect(screen.queryByText("Statistics")).toBeNull();
  });

  it("renders equivalent classes when present", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        equivalent_iris: ["http://example.org/ontology#Human"],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Equivalent Classes")).toBeDefined();
      expect(screen.getByText("Human")).toBeDefined();
    });
  });

  it("renders disjoint classes when present", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        disjoint_iris: ["http://example.org/ontology#NonPerson"],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Disjoint With")).toBeDefined();
      expect(screen.getByText("NonPerson")).toBeDefined();
    });
  });

  it("calls getClassDetail with correct arguments", async () => {
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(mockGetClassDetail).toHaveBeenCalledWith(
        "proj-1",
        "http://example.org/ontology#Person",
        "main"
      );
    });
  });

  it("calls lintApi.getIssues with subject_iri filter", async () => {
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(mockGetIssues).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({
          subject_iri: "http://example.org/ontology#Person",
          limit: 50,
        })
      );
    });
  });

  it("renders the class detail when lintApi.getIssues rejects", async () => {
    mockGetIssues.mockRejectedValue(new Error("lint service down"));
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(mockGetClassDetail).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText(/Health Issues/i)).toBeNull();
    });
  });

  it("shows lint issues for the class", async () => {
    mockGetIssues.mockResolvedValue({ items: [makeLintIssue()] });
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Health Issues (1)")).toBeDefined();
      expect(
        screen.getByText("Class is missing an rdfs:label")
      ).toBeDefined();
      expect(screen.getByText("MISSING_LABEL:")).toBeDefined();
    });
  });

  it("does not show lint section when no issues", async () => {
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getAllByText("Person").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("Health Issues")).toBeNull();
  });

  it("renders Copy IRI button when onCopyIri is provided", async () => {
    const onCopyIri = vi.fn();
    render(<ClassDetailPanel {...DEFAULT_PROPS} onCopyIri={onCopyIri} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Copy IRI")).toBeDefined();
    });
  });

  it("calls onCopyIri when Copy IRI button is clicked", async () => {
    const user = userEvent.setup();
    const onCopyIri = vi.fn();
    render(<ClassDetailPanel {...DEFAULT_PROPS} onCopyIri={onCopyIri} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Copy IRI")).toBeDefined();
    });

    await user.click(screen.getByLabelText("Copy IRI"));
    expect(onCopyIri).toHaveBeenCalledWith(
      "http://example.org/ontology#Person"
    );
  });

  it("does not show edit button when canEdit is false", async () => {
    render(<ClassDetailPanel {...DEFAULT_PROPS} canEdit={false} />);

    await waitFor(() => {
      expect(screen.getAllByText("Person").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("Edit Item")).toBeNull();
  });

  it("renders unsaved entity fallback with parent link", async () => {
    mockGetClassDetail.mockRejectedValue(new Error("404 Class not found"));
    const fallback = {
      label: "NewEntity",
      iri: "http://example.org/ontology#Person",
      parentIri: "http://example.org/ontology#Agent",
      parentLabel: "Agent",
    };
    render(
      <ClassDetailPanel {...DEFAULT_PROPS} selectedNodeFallback={fallback} />
    );

    await waitFor(() => {
      expect(screen.getAllByText("NewEntity").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Unsaved")).toBeDefined();
      expect(screen.getAllByText("Agent").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows error when classDetail 404s and fallback IRI doesn't match", async () => {
    mockGetClassDetail.mockRejectedValue(new Error("404 Class not found"));
    const fallback = {
      label: "Other",
      iri: "http://example.org/ontology#Other",
    };
    render(
      <ClassDetailPanel {...DEFAULT_PROPS} selectedNodeFallback={fallback} />
    );

    await waitFor(() => {
      expect(screen.getByText(/Could not load .* as an OWL Class/)).toBeDefined();
    });
  });

  it("renders headerActions when provided", async () => {
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        headerActions={<button data-testid="graph-btn">Graph</button>}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("graph-btn")).toBeDefined();
    });
  });

  it("renders definition annotation", async () => {
    const DEFINITION_IRI = "http://www.w3.org/2004/02/skos/core#definition";
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: DEFINITION_IRI,
            property_label: "Definition",
            values: [{ value: "A rational animal" }],
          },
        ],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("A rational animal")).toBeDefined();
      expect(screen.getByText("Definition")).toBeDefined();
    });
  });

  it("renders custom annotation properties", async () => {
    const PREF_LABEL_IRI =
      "http://www.w3.org/2004/02/skos/core#prefLabel";
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: PREF_LABEL_IRI,
            property_label: "Preferred Label",
            values: [{ value: "Human Person" }],
          },
        ],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Human Person")).toBeDefined();
    });
  });

  it("re-fetches when refreshKey changes", async () => {
    const { rerender } = render(
      <ClassDetailPanel {...DEFAULT_PROPS} refreshKey={1} />
    );

    await waitFor(() => {
      expect(mockGetClassDetail).toHaveBeenCalledTimes(1);
    });

    rerender(<ClassDetailPanel {...DEFAULT_PROPS} refreshKey={2} />);

    await waitFor(() => {
      expect(mockGetClassDetail).toHaveBeenCalledTimes(2);
    });
  });

  it("auto-enters edit mode and renders inputs when onUpdateClass is provided", async () => {
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const labelInput = screen.getByDisplayValue("Person");
    expect(labelInput).not.toBeNull();
    expect(labelInput.tagName).toBe("INPUT");
  });

  it("updates label value when typing in edit mode", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Person")).not.toBeNull();
    });

    const labelInput = screen.getByDisplayValue("Person");
    await user.clear(labelInput);
    await user.type(labelInput, "Human");

    expect(screen.getByDisplayValue("Human")).not.toBeNull();
  });

  it("renders comment textareas in edit mode", async () => {
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("A human being")).not.toBeNull();
    });
    const commentArea = screen.getByDisplayValue("A human being");
    expect(commentArea.tagName).toBe("TEXTAREA");
  });

  it("updates comment value when typing in edit mode", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("A human being")).not.toBeNull();
    });

    const commentArea = screen.getByDisplayValue("A human being");
    await user.clear(commentArea);
    await user.type(commentArea, "A sentient being");

    expect(screen.getByDisplayValue("A sentient being")).not.toBeNull();
  });

  it("removes a comment when remove button is clicked", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("A human being")).not.toBeNull();
    });

    const removeBtn = screen.getByLabelText("Remove comment");
    await user.click(removeBtn);

    expect(screen.queryByDisplayValue("A human being")).toBeNull();
  });

  it("shows parent with remove button in edit mode", async () => {
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Remove parent")).not.toBeNull();
    });
    expect(screen.getByText("Agent")).not.toBeNull();
  });

  it("removes parent when remove button is clicked", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Remove parent")).not.toBeNull();
    });

    await user.click(screen.getByLabelText("Remove parent"));

    await waitFor(() => {
      expect(screen.queryByLabelText("Remove parent")).toBeNull();
    });
  });

  it("shows Add parent button in edit mode and opens picker on click", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByText("Add parent")).not.toBeNull();
    });

    await user.click(screen.getByText("Add parent"));

    await waitFor(() => {
      expect(screen.queryByText("Add parent")).toBeNull();
    });
  });

  it("closes the parent picker when the user cancels", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Add parent")).not.toBeNull();
    });

    await user.click(screen.getByText("Add parent"));
    await waitFor(() => {
      expect(screen.queryByText("Add parent")).toBeNull();
    });

    await user.click(screen.getByTestId("cancel-edit"));

    await waitFor(() => {
      expect(screen.getByText("Add parent")).not.toBeNull();
    });
  });

  it("triggers save on label input blur", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Person")).not.toBeNull();
    });

    const labelInput = screen.getByDisplayValue("Person");
    await user.click(labelInput);
    await user.tab();

    expect(mockTriggerSave).toHaveBeenCalled();
  });

  it("discards draft when cancel is invoked but stays in edit mode", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();

    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Person")).not.toBeNull();
    });

    const cancelBtn = screen.getByTestId("cancel-edit");
    await user.click(cancelBtn);

    await waitFor(() => {
      expect(mockDiscardDraft).toHaveBeenCalled();
    });
    expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
  });

  it("flushes pending draft to git on unmount", async () => {
    const onUpdateClass = vi.fn();

    const { unmount } = render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    unmount();

    expect(mockFlushToGit).toHaveBeenCalled();
  });

  it("shows remove button only when there are multiple labels", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        labels: [
          { value: "Person" },
          { value: "Personne" },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      const removeBtns = screen.getAllByLabelText("Remove label");
      expect(removeBtns.length).toBe(2);
    });
  });

  it("removes a label when remove button is clicked with multiple labels", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        labels: [
          { value: "Person" },
          { value: "Personne" },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Personne")).not.toBeNull();
    });

    const removeBtns = screen.getAllByLabelText("Remove label");
    await user.click(removeBtns[1]);

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Personne")).toBeNull();
    });
  });

  it("never renders an Edit Item button in editor context", async () => {
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.queryByText("Edit Item")).toBeNull();
  });

  it("renders Definition section with annotation row in edit mode", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#definition",
            property_label: "Definition",
            values: [{ value: "A rational animal" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByText("Definition")).not.toBeNull();
    });
  });

  it("shows generic error for non-Error exceptions", async () => {
    mockGetClassDetail.mockRejectedValue("string error");
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load class details")).not.toBeNull();
    });
  });

  it("renders class with no labels using local name", async () => {
    mockGetClassDetail.mockResolvedValue(makeClassDetail({ labels: [] }));
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getAllByText("Person").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders multiple annotation groups in read mode", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            property_label: "Preferred Label",
            values: [{ value: "Human Person" }],
          },
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#altLabel",
            property_label: "Alternative Label",
            values: [{ value: "Homo sapiens" }],
          },
        ],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Human Person")).not.toBeNull();
      expect(screen.getByText("Homo sapiens")).not.toBeNull();
    });
  });

  it("does not render comments section when comments array is empty", async () => {
    mockGetClassDetail.mockResolvedValue(makeClassDetail({ comments: [] }));
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getAllByText("Person").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("Comment(s)")).toBeNull();
  });

  it("does not render parent section when parent_iris is empty", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({ parent_iris: [], parent_labels: {} })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getAllByText("Person").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("Parent Class(es)")).toBeNull();
  });

  it("calls onNavigateToClass when parent link is clicked", async () => {
    const user = userEvent.setup();
    const onNavigateToClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        onNavigateToClass={onNavigateToClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Agent")).not.toBeNull();
    });

    await user.click(screen.getByText("Agent"));
    expect(onNavigateToClass).toHaveBeenCalledWith(
      "http://example.org/ontology#Agent"
    );
  });

  it("shows zero subclasses and instances, with nothing to open", async () => {
    mockGetClassDetail.mockResolvedValue(makeClassDetail({ child_count: 0, subclasses: [], instance_count: null, instances: [] }));
    render(<ClassDetailPanel {...DEFAULT_PROPS} onNavigateToClass={vi.fn()} onNavigateToIndividual={vi.fn()} />);
    expect(await screen.findByText("Subclasses (0)")).toBeDefined();
    expect(screen.getByText("Individuals (0)")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Subclasses/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Individuals/ })).toBeNull();
  });

  it("lists a single instance from the start, and navigates to it", async () => {
    const onNavigateToIndividual = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({ instance_count: 1, instances: [{ iri: "http://ex.org#rex", label: "Rex" }] })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} onNavigateToIndividual={onNavigateToIndividual} />);
    fireEvent.click(await screen.findByText("Rex"));
    expect(onNavigateToIndividual).toHaveBeenCalledWith("http://ex.org#rex");
  });

  it("lists several instances and navigates to the one clicked", async () => {
    const onNavigateToIndividual = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        instance_count: 2,
        instances: [{ iri: "http://ex.org#a", label: "Alpha" }, { iri: "http://ex.org#b", label: "Beta" }],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} onNavigateToIndividual={onNavigateToIndividual} />);
    const toggle = await screen.findByRole("button", { name: /^Individuals/ });
    // Open when the class is shown.
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByText("Beta"));
    expect(onNavigateToIndividual).toHaveBeenCalledWith("http://ex.org#b");
    // The count hides and shows the list.
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Alpha")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("Alpha")).toBeDefined();
  });

  it("lists the subclasses from the start, and navigates to the one clicked", async () => {
    const onNavigateToClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        child_count: 2,
        subclasses: [{ iri: "http://ex.org#Cat", label: "Cat" }, { iri: "http://ex.org#Dog", label: "Dog" }],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} onNavigateToClass={onNavigateToClass} />);
    const toggle = await screen.findByRole("button", { name: /^Subclasses/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByText("Dog"));
    expect(onNavigateToClass).toHaveBeenCalledWith("http://ex.org#Dog");
    fireEvent.click(toggle);
    expect(screen.queryByText("Cat")).toBeNull();
  });

  it("keeps Add individual in place whether the instances are shown or not, with a chevron showing which", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        instance_count: 2,
        instances: [{ iri: "http://ex.org#a", label: "Alpha" }, { iri: "http://ex.org#b", label: "Beta" }],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} canEdit={true} onUpdateClass={vi.fn()} onAddIndividual={vi.fn()} onNavigateToIndividual={vi.fn()} />);
    const toggle = await screen.findByRole("button", { name: /^Individuals/ });
    const add = screen.getByRole("button", { name: /Add individual/ });
    const parent = add.parentElement!;
    // Above the list, not in it, so opening and closing the list can't move the button.
    expect(screen.getByTestId("disclosure-body").contains(add)).toBe(false);
    expect(add.compareDocumentPosition(screen.getByText("Alpha")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle.querySelector("[data-testid='disclosure-chevron']")!.getAttribute("data-open")).toBe("true");
    fireEvent.click(toggle);
    expect(add.parentElement).toBe(parent);
    expect(add.previousElementSibling).toBeNull();
    expect(toggle.querySelector("[data-testid='disclosure-chevron']")!.getAttribute("data-open")).toBe("false");
  });

  it("does not make zero instances clickable", async () => {
    mockGetClassDetail.mockResolvedValue(makeClassDetail({ instance_count: 0, instances: [] }));
    render(<ClassDetailPanel {...DEFAULT_PROPS} canEdit={true} onUpdateClass={vi.fn()} onAddIndividual={vi.fn()} onNavigateToIndividual={vi.fn()} />);
    // Shown so an individual can be added, but with nothing to open.
    expect(await screen.findByText("Individuals (0)")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Individuals/ })).toBeNull();
  });

  it("renders error-type lint issue", async () => {
    mockGetIssues.mockResolvedValue({
      items: [
        makeLintIssue({ issue_type: "error", rule_id: "INVALID_IRI", message: "Invalid IRI format" }),
      ],
    });
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Health Issues (1)")).not.toBeNull();
      expect(screen.getByText("INVALID_IRI:")).not.toBeNull();
      expect(screen.getByText("Invalid IRI format")).not.toBeNull();
    });
  });

  it("renders info-type lint issue", async () => {
    mockGetIssues.mockResolvedValue({
      items: [
        makeLintIssue({ issue_type: "info", rule_id: "SUGGESTION", message: "Consider adding more labels" }),
      ],
    });
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Health Issues (1)")).not.toBeNull();
      expect(screen.getByText("SUGGESTION:")).not.toBeNull();
    });
  });

  it("initializes edit mode with empty label placeholder when server has no labels", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(makeClassDetail({ labels: [] }));
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      const inputs = screen.getAllByPlaceholderText("Label text");
      expect(inputs.length).toBeGreaterThanOrEqual(1);
      expect((inputs[0] as HTMLInputElement).value).toBe("");
    });
  });

  it("shows ghost comment row with placeholder text in edit mode", async () => {
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      const textareas = screen.getAllByRole("textbox").filter(
        (el) => el.tagName === "TEXTAREA"
      );
      expect(textareas.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("extracts local name from slash-separated IRI on 404", async () => {
    mockGetClassDetail.mockRejectedValue(new Error("404 Class not found"));
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        classIri="http://example.org/ontology/Animal"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Animal/)).not.toBeNull();
      expect(screen.getByText(/Could not load .* as an OWL Class/)).not.toBeNull();
    });
  });

  it("initializes edit mode with relationship annotations and regular annotations", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
            property_label: "See Also",
            values: [{ value: "http://example.org/ontology#Related" }],
          },
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            property_label: "Preferred Label",
            values: [{ value: "Human Person" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByText("Relationship(s)")).not.toBeNull();
    });
    expect(screen.getByText("Preferred Label")).not.toBeNull();
  });

  it("renders relationship section in read mode when targets exist", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
            property_label: "See Also",
            values: [{ value: "http://example.org/ontology#Related" }],
          },
        ],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Relationship(s)")).not.toBeNull();
    });
  });

  it("asks for a definition, not another one, when the class has none", async () => {
    capturedAnnotationRowProps = [];
    mockGetClassDetail.mockResolvedValue(makeClassDetail({ annotations: [] }));
    render(<ClassDetailPanel {...DEFAULT_PROPS} canEdit={true} onUpdateClass={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("auto-save-bar")).not.toBeNull());
    const definitionRows = capturedAnnotationRowProps.filter((p) => p.propertyIri === "http://www.w3.org/2004/02/skos/core#definition");
    expect(definitionRows.at(-1)?.placeholder).toBe("Add a definition");
  });

  it("asks for another definition below an existing one", async () => {
    capturedAnnotationRowProps = [];
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({ annotations: [{ property_iri: "http://www.w3.org/2004/02/skos/core#definition", values: [{ value: "A thing." }] }] })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} canEdit={true} onUpdateClass={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("auto-save-bar")).not.toBeNull());
    const definitionRows = capturedAnnotationRowProps.filter((p) => p.propertyIri === "http://www.w3.org/2004/02/skos/core#definition");
    expect(definitionRows.at(-1)?.placeholder).toBe("Add another definition");
  });

  it("adds empty Definition section in edit mode when not in server data", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({ annotations: [] })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByText("Definition")).not.toBeNull();
    });
  });

  it("does not render relationship section in read mode when no targets", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
            property_label: "See Also",
            values: [{ value: "" }],
          },
        ],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getAllByText("Person").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("Relationship(s)")).toBeNull();
  });

  it("does not render annotation section with empty values array", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            property_label: "Preferred Label",
            values: [],
          },
        ],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getAllByText("Person").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("Preferred Label")).toBeNull();
  });

  it("handles null annotations gracefully in read mode", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({ annotations: null })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getAllByText("Person").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText("Subclasses (5)")).not.toBeNull();
  });

  it("resolves relationship target labels from class detail and search", async () => {
    const SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";
    const targetIri = "http://example.org/ontology#Related";

    mockGetClassDetail
      .mockResolvedValueOnce(
        makeClassDetail({
          annotations: [
            {
              property_iri: SEE_ALSO,
              property_label: "See Also",
              values: [{ value: targetIri }],
            },
          ],
        })
      )
      .mockRejectedValueOnce(new Error("Class not found"));

    mockSearchEntities.mockResolvedValueOnce({
      results: [{ iri: targetIri, label: "Related Thing", entity_type: "individual" }],
    });

    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Relationship(s)")).not.toBeNull();
    });

    await waitFor(() => {
      expect(mockSearchEntities).toHaveBeenCalled();
    });
  });

  it("resolves relationship target labels from class detail endpoint", async () => {
    const SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";
    const targetIri = "http://example.org/ontology#Related";

    mockGetClassDetail
      .mockResolvedValueOnce(
        makeClassDetail({
          annotations: [
            {
              property_iri: SEE_ALSO,
              property_label: "See Also",
              values: [{ value: targetIri }],
            },
          ],
        })
      )
      .mockResolvedValueOnce({
        iri: targetIri,
        labels: [{ value: "Related Class" }],
        comments: [],
        deprecated: false,
        parent_iris: [],
        parent_labels: {},
        equivalent_iris: null,
        disjoint_iris: null,
        child_count: 0,
        instance_count: 0,
        annotations: [],
      });

    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(mockGetClassDetail).toHaveBeenCalledTimes(2);
    });
  });

  it("initializes edit mode with isDefinedBy relationship", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2000/01/rdf-schema#isDefinedBy",
            property_label: "Is Defined By",
            values: [{ value: "http://example.org/ontology" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByText("Relationship(s)")).not.toBeNull();
    });
  });

  it("renders multiple lint issues with correct count", async () => {
    mockGetIssues.mockResolvedValue({
      items: [
        makeLintIssue({ id: "issue-1", rule_id: "MISSING_LABEL", message: "Missing label" }),
        makeLintIssue({ id: "issue-2", rule_id: "MISSING_COMMENT", message: "Missing comment", issue_type: "info" as const }),
      ],
    });
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Health Issues (2)")).not.toBeNull();
      expect(screen.getByText("Missing label")).not.toBeNull();
      expect(screen.getByText("Missing comment")).not.toBeNull();
    });
  });

  it("renders definition values in edit mode with annotation rows", async () => {
    const onUpdateClass = vi.fn();
    const DEFINITION_IRI = "http://www.w3.org/2004/02/skos/core#definition";
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: DEFINITION_IRI,
            property_label: "Definition",
            values: [
              { value: "A rational animal" },
              { value: "Un animal raisonnable" },
            ],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByText("Definition")).not.toBeNull();
    });
  });

  it("renders unsaved entity fallback without parent section when no parent", async () => {
    mockGetClassDetail.mockRejectedValue(new Error("404 Class not found"));
    const fallback = {
      label: "NewEntity",
      iri: "http://example.org/ontology#Person",
    };
    render(
      <ClassDetailPanel {...DEFAULT_PROPS} selectedNodeFallback={fallback} />
    );

    await waitFor(() => {
      expect(screen.getAllByText("NewEntity").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Unsaved")).not.toBeNull();
    });
    expect(screen.queryByText("Parent Class(es)")).toBeNull();
    expect(screen.getByText(/has not been saved yet/)).not.toBeNull();
  });

  it("renders annotation with notation icon", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#notation",
            property_label: "Notation",
            values: [{ value: "P001" }],
          },
        ],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("P001")).not.toBeNull();
    });
  });

  it("renders unknown annotation property in read mode", async () => {
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://example.org/custom#note",
            property_label: "Custom Note",
            values: [{ value: "Some custom note" }],
          },
        ],
      })
    );
    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Some custom note")).not.toBeNull();
    });
  });

  it("shows error when classDetail 404s and fallback IRI does not match", async () => {
    mockGetClassDetail.mockRejectedValue(new Error("404 Class not found"));
    const { container } = render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        selectedNodeFallback={{ label: "X", iri: "http://other/iri" }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Could not load .* as an OWL Class/)).not.toBeNull();
    });
    expect(container.querySelector(".border-red-200")).not.toBeNull();
  });

  it("stays in edit mode when flushDraftToGit flush fails", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();
    mockFlushToGit.mockResolvedValue(false);
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(screen.getByTestId("manual-save")).not.toBeNull();
    });

    await user.click(screen.getByTestId("manual-save"));

    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
      expect(mockFlushToGit).toHaveBeenCalled();
    });
    expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
  });

  it("stays in edit mode after cancel and discards the draft", async () => {
    const user = userEvent.setup();
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    const cancelBtn = screen.getByTestId("cancel-edit");
    await user.click(cancelBtn);

    await waitFor(() => {
      expect(mockDiscardDraft).toHaveBeenCalled();
    });
    expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
  });

  it("auto-enters edit mode when restoredDraft is available", async () => {
    autoSaveOverrides = {
      restoredDraft: {
        labels: [{ value: "Restored Label" }],
        comments: [{ value: "Restored Comment" }],
        parentIris: ["http://example.org/ontology#Agent"],
        parentLabels: { "http://example.org/ontology#Agent": "Agent" },
        annotations: [],
        relationships: [],
      },
    };
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
      expect(mockClearRestoredDraft).toHaveBeenCalled();
    });
  });

  it("auto-enters edit mode with empty label placeholder from restored draft", async () => {
    autoSaveOverrides = {
      restoredDraft: {
        labels: [],
        comments: [],
        parentIris: [],
        parentLabels: {},
        annotations: [],
        relationships: [],
      },
    };
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
  });

  it("InlineAnnotationAdder adds value to existing annotation property", async () => {
    const onUpdateClass = vi.fn();
    const PREF_LABEL_IRI = "http://www.w3.org/2004/02/skos/core#prefLabel";
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: PREF_LABEL_IRI,
            property_label: "Preferred Label",
            values: [{ value: "Existing Value" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(capturedInlineAnnotationAdderProps).not.toBeNull();
    });

    const onAdd = capturedInlineAnnotationAdderProps!.onAdd as (propertyIri: string, value: string) => void;
    onAdd(PREF_LABEL_IRI, "New Value");

    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("InlineAnnotationAdder creates new annotation property when not existing", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({ annotations: [] })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(capturedInlineAnnotationAdderProps).not.toBeNull();
    });

    const onAdd = capturedInlineAnnotationAdderProps!.onAdd as (propertyIri: string, value: string) => void;
    onAdd("http://www.w3.org/2004/02/skos/core#example", "Example value");

    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("passes relationship callbacks to RelationshipSection in edit mode", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
            property_label: "See Also",
            values: [{ value: "http://example.org/ontology#Related" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(capturedRelationshipSectionProps).not.toBeNull();
    });

    const onAddTarget = capturedRelationshipSectionProps!.onAddTarget as (groupIdx: number, target: { iri: string; label: string }) => void;
    onAddTarget(0, { iri: "http://example.org/ontology#newRelated", label: "newRelated" });
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("invokes removeRelationshipTarget via RelationshipSection", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
            property_label: "See Also",
            values: [{ value: "http://example.org/ontology#Related" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(capturedRelationshipSectionProps).not.toBeNull();
    });

    const onRemoveTarget = capturedRelationshipSectionProps!.onRemoveTarget as (groupIdx: number, targetIdx: number) => void;
    onRemoveTarget(0, 0);
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("invokes changeRelationshipProperty via RelationshipSection", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
            property_label: "See Also",
            values: [{ value: "http://example.org/ontology#Related" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(capturedRelationshipSectionProps).not.toBeNull();
    });

    const onChangeProperty = capturedRelationshipSectionProps!.onChangeProperty as (groupIdx: number, newIri: string, newLabel: string) => void;
    onChangeProperty(0, "http://www.w3.org/2000/01/rdf-schema#isDefinedBy", "Defined By");
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("invokes addRelationshipGroup via RelationshipSection", async () => {
    const onUpdateClass = vi.fn();
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(capturedRelationshipSectionProps).not.toBeNull();
    });

    const groupsBefore = (capturedRelationshipSectionProps!.groups as unknown[]).length;
    const onAddGroup = capturedRelationshipSectionProps!.onAddGroup as () => void;
    onAddGroup();

    await waitFor(() => {
      const groupsAfter = (capturedRelationshipSectionProps!.groups as unknown[]).length;
      expect(groupsAfter).toBe(groupsBefore + 1);
    });
  });

  it("invokes triggerSave via RelationshipSection onSaveNeeded", async () => {
    const onUpdateClass = vi.fn();
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2000/01/rdf-schema#seeAlso",
            property_label: "See Also",
            values: [{ value: "http://example.org/ontology#Related" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(capturedRelationshipSectionProps).not.toBeNull();
    });

    const onSaveNeeded = capturedRelationshipSectionProps!.onSaveNeeded as () => void;
    onSaveNeeded();
    expect(mockTriggerSave).toHaveBeenCalled();
  });

  it("updates annotation value via AnnotationRow callback in edit mode", async () => {
    const onUpdateClass = vi.fn();
    const PREF_LABEL_IRI = "http://www.w3.org/2004/02/skos/core#prefLabel";
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: PREF_LABEL_IRI,
            property_label: "Preferred Label",
            values: [{ value: "Human" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      const annRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === PREF_LABEL_IRI
      );
      expect(annRow).not.toBeNull();
    });

    const annRow = capturedAnnotationRowProps.find(
      (p) => p.propertyIri === PREF_LABEL_IRI
    );
    const onValueChange = annRow!.onValueChange as (v: string) => void;
    onValueChange("Updated Value");

    await waitFor(() => {
      const updatedRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === PREF_LABEL_IRI && p.value === "Updated Value"
      );
      expect(updatedRow).toBeDefined();
    });
  });

  it("removes annotation value via AnnotationRow callback in edit mode", async () => {
    const onUpdateClass = vi.fn();
    const PREF_LABEL_IRI = "http://www.w3.org/2004/02/skos/core#prefLabel";
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: PREF_LABEL_IRI,
            property_label: "Preferred Label",
            values: [
              { value: "Label One" },
              { value: "Label Two" },
            ],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      const annRows = capturedAnnotationRowProps.filter(
        (p) => p.propertyIri === PREF_LABEL_IRI
      );
      expect(annRows.length).toBeGreaterThanOrEqual(1);
    });

    const annRow = capturedAnnotationRowProps.find(
      (p) => p.propertyIri === PREF_LABEL_IRI && typeof p.onRemove === "function"
    );
    expect(annRow).not.toBeNull();
    const onRemove = annRow!.onRemove as () => void;
    onRemove();

    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("updates definition annotation via AnnotationRow callback", async () => {
    const onUpdateClass = vi.fn();
    const DEFINITION_IRI = "http://www.w3.org/2004/02/skos/core#definition";
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: DEFINITION_IRI,
            property_label: "Definition",
            values: [{ value: "A rational animal" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      const defRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === DEFINITION_IRI
      );
      expect(defRow).not.toBeNull();
    });

    const defRow = capturedAnnotationRowProps.find(
      (p) => p.propertyIri === DEFINITION_IRI
    );
    const onValueChange = defRow!.onValueChange as (v: string) => void;
    onValueChange("Updated definition");

    await waitFor(() => {
      const updatedRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === DEFINITION_IRI && p.value === "Updated definition"
      );
      expect(updatedRow).toBeDefined();
    });
  });

  it("definition AnnotationRow onBlur triggers triggerSave", async () => {
    const onUpdateClass = vi.fn();
    const DEFINITION_IRI = "http://www.w3.org/2004/02/skos/core#definition";
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: DEFINITION_IRI,
            property_label: "Definition",
            values: [{ value: "A rational animal" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      const defRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === DEFINITION_IRI
      );
      expect(defRow).not.toBeNull();
    });

    const defRow = capturedAnnotationRowProps.find(
      (p) => p.propertyIri === DEFINITION_IRI
    );
    const onBlur = defRow!.onBlur as () => void;
    onBlur();
    expect(mockTriggerSave).toHaveBeenCalled();
  });

  it("does not auto-enter edit mode when canEdit is false even with onUpdateClass", async () => {
    render(
      <ClassDetailPanel {...DEFAULT_PROPS} canEdit={false} onUpdateClass={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getAllByText("Person").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByTestId("auto-save-bar")).toBeNull();
  });

  it("handles target label resolution when both class and search fail", async () => {
    const SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";
    const targetIri = "http://example.org/ontology#Orphan";

    mockGetClassDetail
      .mockResolvedValueOnce(
        makeClassDetail({
          annotations: [
            {
              property_iri: SEE_ALSO,
              property_label: "See Also",
              values: [{ value: targetIri }],
            },
          ],
        })
      )
      .mockRejectedValueOnce(new Error("Class not found"));

    mockSearchEntities.mockRejectedValueOnce(new Error("Search failed"));

    render(<ClassDetailPanel {...DEFAULT_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText("Relationship(s)")).not.toBeNull();
    });

    await waitFor(() => {
      expect(mockSearchEntities).toHaveBeenCalled();
    });
  });

  it("removes definition value via AnnotationRow callback", async () => {
    const onUpdateClass = vi.fn();
    const DEFINITION_IRI = "http://www.w3.org/2004/02/skos/core#definition";
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: DEFINITION_IRI,
            property_label: "Definition",
            values: [
              { value: "First def" },
              { value: "Second def" },
            ],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      const defRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === DEFINITION_IRI && typeof p.onRemove === "function"
      );
      expect(defRow).not.toBeNull();
    });

    const defRow = capturedAnnotationRowProps.find(
      (p) => p.propertyIri === DEFINITION_IRI && typeof p.onRemove === "function"
    );
    const onRemove = defRow!.onRemove as () => void;
    onRemove();

    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("annotation AnnotationRow onBlur triggers triggerSave", async () => {
    const onUpdateClass = vi.fn();
    const PREF_LABEL_IRI = "http://www.w3.org/2004/02/skos/core#prefLabel";
    mockGetClassDetail.mockResolvedValue(
      makeClassDetail({
        annotations: [
          {
            property_iri: PREF_LABEL_IRI,
            property_label: "Preferred Label",
            values: [{ value: "Human" }],
          },
        ],
      })
    );
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateClass={onUpdateClass}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      const annRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === PREF_LABEL_IRI
      );
      expect(annRow).not.toBeNull();
    });

    const annRow = capturedAnnotationRowProps.find(
      (p) => p.propertyIri === PREF_LABEL_IRI
    );
    const onBlur = annRow!.onBlur as () => void;
    onBlur();
    expect(mockTriggerSave).toHaveBeenCalled();
  });

  it("calls onNavigateToClass when clicking parent in fallback card", async () => {
    const user = userEvent.setup();
    mockGetClassDetail.mockRejectedValue(new Error("404 Class not found"));
    const onNavigateToClass = vi.fn();
    const fallback = {
      label: "NewEntity",
      iri: "http://example.org/ontology#Person",
      parentIri: "http://example.org/ontology#Agent",
      parentLabel: "Agent",
    };
    render(
      <ClassDetailPanel
        {...DEFAULT_PROPS}
        selectedNodeFallback={fallback}
        onNavigateToClass={onNavigateToClass}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText("Agent").length).toBeGreaterThanOrEqual(1);
    });

    await user.click(screen.getAllByText("Agent")[0]);
    expect(onNavigateToClass).toHaveBeenCalledWith("http://example.org/ontology#Agent");
  });

  it("shows fallback card when classDetail is null and matching fallback provided", async () => {
    mockGetClassDetail.mockRejectedValue(new Error("404 Class not found"));
    const fallback = {
      label: "NewEntity",
      iri: "http://example.org/ontology#Person",
    };
    render(
      <ClassDetailPanel {...DEFAULT_PROPS} selectedNodeFallback={fallback} />
    );

    await waitFor(() => {
      expect(screen.getByText(/has not been saved yet/)).not.toBeNull();
    });
  });
});

describe("ensureTrailingEmpty", () => {
  it("appends empty row to empty array", () => {
    const result = ensureTrailingEmpty([]);
    expect(result).toEqual([{ value: "" }]);
  });

  it("appends empty row when last item has non-empty value", () => {
    const result = ensureTrailingEmpty([{ value: "hello" }]);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ value: "" });
  });

  it("does not append when last item is already empty", () => {
    const input = [
      { value: "hello" },
      { value: "" },
    ];
    const result = ensureTrailingEmpty(input);
    expect(result).toHaveLength(2);
  });

  it("does not append when last item is whitespace-only", () => {
    const input = [{ value: "  " }];
    const result = ensureTrailingEmpty(input);
    expect(result).toHaveLength(1);
  });
});
