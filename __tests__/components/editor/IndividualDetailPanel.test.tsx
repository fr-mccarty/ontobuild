import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });
import userEvent from "@testing-library/user-event";

const mockExtractIndividualDetail = vi.fn();
vi.mock("@/lib/ontology/entityDetailExtractors", () => ({
  extractIndividualDetail: (...args: unknown[]) => mockExtractIndividualDetail(...args),
}));

vi.mock("@/lib/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const mockTriggerSave = vi.fn();
const mockFlushToGit = vi.fn().mockResolvedValue(true);
const mockDiscardDraft = vi.fn();
const mockClearRestoredDraft = vi.fn();

let autoSaveOverrides: Record<string, unknown> = {};
let preferencesOverrides: Record<string, unknown> = {};

vi.mock("@/lib/hooks/useEntityAutoSave", () => ({
  useEntityAutoSave: () => ({
    saveStatus: "idle",
    saveError: null,
    validationError: null,
    isDirty: false,
    triggerSave: mockTriggerSave,
    flushToGit: mockFlushToGit,
    discardDraft: mockDiscardDraft,
    editStateRef: { current: null },
    restoredDraft: null,
    clearRestoredDraft: mockClearRestoredDraft,
    ...autoSaveOverrides,
  }),
}));

vi.mock("@/lib/stores/preferencesStore", () => ({
  usePreferencesStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ ...preferencesOverrides }),
}));

vi.mock("@/lib/hooks/useIriLabels", () => ({
  useIriLabels: () => ({}),
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

let capturedPropertyAssertionProps: Array<Record<string, unknown>> = [];
vi.mock("@/components/editor/standard/PropertyAssertionSection", () => ({
  PropertyAssertionSection: (props: Record<string, unknown>) => {
    capturedPropertyAssertionProps.push(props);
    return null;
  },
}));

let capturedAutoSaveBarProps: Record<string, unknown> | null = null;
vi.mock("@/components/editor/AutoSaveAffordanceBar", () => ({
  AutoSaveAffordanceBar: (props: Record<string, unknown>) => {
    capturedAutoSaveBarProps = props;
    return <div data-testid="auto-save-bar">AutoSaveBar</div>;
  },
}));

import { IndividualDetailPanel } from "@/components/editor/IndividualDetailPanel";

function makeIndividualDetail(overrides: Record<string, unknown> = {}) {
  return {
    labels: [{ value: "John Doe" }],
    comments: [{ value: "A sample person" }],
    definitions: [{ value: "An individual representing John Doe" }],
    annotations: [],
    typeIris: ["http://example.org/ontology#Person"],
    sameAsIris: [],
    differentFromIris: [],
    deprecated: false,
    objectPropertyAssertions: [],
    dataPropertyAssertions: [],
    seeAlsoIris: [],
    isDefinedByIris: [],
    ...overrides,
  };
}

const SAMPLE_SOURCE = `@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix : <http://example.org/ontology#> .
:JohnDoe a owl:NamedIndividual , :Person ;
  rdfs:label "John Doe"@en ;
  rdfs:comment "A sample person"@en .
`;

const DEFAULT_PROPS = {
  projectId: "proj-1",
  individualIri: "http://example.org/ontology#JohnDoe",
  sourceContent: SAMPLE_SOURCE,
  canEdit: false,
  branch: "main",
};

describe("IndividualDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlushToGit.mockResolvedValue(true);
    autoSaveOverrides = {};
    preferencesOverrides = {};
    capturedAnnotationRowProps = [];
    capturedRelationshipSectionProps = null;
    capturedPropertyAssertionProps = [];
    capturedAutoSaveBarProps = null;
    capturedInlineAnnotationAdderProps = null;
    mockExtractIndividualDetail.mockReturnValue(makeIndividualDetail());
  });

  it("renders 'Select an individual' placeholder when individualIri is null", () => {
    render(
      <IndividualDetailPanel
        projectId="proj-1"
        individualIri={null}
        sourceContent=""
        canEdit={false}
      />
    );
    expect(
      screen.getByText("Select an individual to view its details")
    ).toBeDefined();
  });

  it("shows a loading spinner when sourceContent is empty", () => {
    const { container } = render(
      <IndividualDetailPanel
        projectId="proj-1"
        individualIri="http://example.org/ontology#JohnDoe"
        sourceContent=""
        canEdit={false}
      />
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows not-found message when extractIndividualDetail returns null", () => {
    mockExtractIndividualDetail.mockReturnValue(null);
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(
      screen.getByText("Could not find this individual in the ontology source.")
    ).toBeDefined();
  });

  it("shows individual IRI in not-found state header", () => {
    mockExtractIndividualDetail.mockReturnValue(null);
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(
      screen.getByText("http://example.org/ontology#JohnDoe")
    ).toBeDefined();
  });

  it("shows local name in not-found state header", () => {
    mockExtractIndividualDetail.mockReturnValue(null);
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("JohnDoe")).toBeDefined();
  });

  it("renders individual label and IRI", () => {
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getAllByText("John Doe").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("http://example.org/ontology#JohnDoe")
    ).toBeDefined();
  });

  it("renders Individual type badge", () => {
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Individual")).toBeDefined();
  });

  it("renders deprecated badge when individual is deprecated", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ deprecated: true })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Deprecated")).toBeDefined();
  });

  it("renders comments section", () => {
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("A sample person")).toBeDefined();
  });

  it("renders definitions section", () => {
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(
      screen.getByText("An individual representing John Doe")
    ).toBeDefined();
  });

  it("renders types section", () => {
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Type(s)")).toBeDefined();
  });

  it("renders same-as section when present", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        sameAsIris: ["http://example.org/ontology#JDoe"],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Same As")).toBeDefined();
  });

  it("renders different-from section when present", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        differentFromIris: ["http://example.org/ontology#JaneDoe"],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Different From")).toBeDefined();
  });

  it("renders object property assertions when present (read-only)", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        objectPropertyAssertions: [
          {
            propertyIri: "http://example.org/ontology#hasParent",
            targetIri: "http://example.org/ontology#JamesDoe",
          },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Object Properties")).toBeDefined();
  });

  it("renders data property assertions when present (read-only)", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        dataPropertyAssertions: [
          {
            propertyIri: "http://example.org/ontology#hasAge",
            value: "42",
            datatype: "http://www.w3.org/2001/XMLSchema#integer",
          },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Data Properties")).toBeDefined();
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.getByText("integer")).toBeDefined();
  });

  it("renders annotations when present", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            values: [{ value: "J. Doe" }],
          },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("J. Doe")).toBeDefined();
  });

  it("does not render empty optional sections", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        typeIris: [],
        sameAsIris: [],
        differentFromIris: [],
        objectPropertyAssertions: [],
        dataPropertyAssertions: [],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Type(s)")).toBeNull();
    expect(screen.queryByText("Same As")).toBeNull();
    expect(screen.queryByText("Different From")).toBeNull();
    expect(screen.queryByText("Object Properties")).toBeNull();
    expect(screen.queryByText("Data Properties")).toBeNull();
  });

  it("renders Copy IRI button when onCopyIri is provided", () => {
    const onCopyIri = vi.fn();
    render(<IndividualDetailPanel {...DEFAULT_PROPS} onCopyIri={onCopyIri} />);
    expect(screen.getByLabelText("Copy IRI")).toBeDefined();
  });

  it("calls onCopyIri when Copy IRI button is clicked", async () => {
    const user = userEvent.setup();
    const onCopyIri = vi.fn();
    render(<IndividualDetailPanel {...DEFAULT_PROPS} onCopyIri={onCopyIri} />);
    await user.click(screen.getByLabelText("Copy IRI"));
    expect(onCopyIri).toHaveBeenCalledWith(
      "http://example.org/ontology#JohnDoe"
    );
  });

  it("does not show edit button when canEdit is false", () => {
    render(<IndividualDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Edit Item")).toBeNull();
  });

  it("never renders an Edit Item button in editor context", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.queryByText("Edit Item")).toBeNull();
  });

  it("calls extractIndividualDetail with sourceContent and individualIri", () => {
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(mockExtractIndividualDetail).toHaveBeenCalledWith(
      SAMPLE_SOURCE,
      "http://example.org/ontology#JohnDoe"
    );
  });

  it("re-parses when refreshKey changes", () => {
    const { rerender } = render(
      <IndividualDetailPanel {...DEFAULT_PROPS} refreshKey={1} />
    );
    expect(mockExtractIndividualDetail).toHaveBeenCalledTimes(1);

    rerender(<IndividualDetailPanel {...DEFAULT_PROPS} refreshKey={2} />);
    expect(mockExtractIndividualDetail).toHaveBeenCalledTimes(2);
  });

  it("renders local name when individual has no labels", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ labels: [] })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getAllByText("JohnDoe").length).toBeGreaterThanOrEqual(1);
  });

  it("renders relationships section when seeAlsoIris present", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        seeAlsoIris: ["http://example.org/ontology#related"],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Relationships")).toBeDefined();
  });

  it("does not render relationships section when no seeAlso or isDefinedBy", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        seeAlsoIris: [],
        isDefinedByIris: [],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Relationships")).toBeNull();
  });

  it("renders editable label inputs in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const labelInputs = screen.getAllByPlaceholderText("Label text");
    expect(labelInputs.length).toBeGreaterThanOrEqual(1);
  });

  it("renders editable comment section in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Comment(s)")).not.toBeNull();
  });

  it("renders editable definition section in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Definition")).not.toBeNull();
  });

  it("renders types section in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Type(s)")).not.toBeNull();
  });

  it("renders same-as section in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Same As")).not.toBeNull();
  });

  it("renders different-from section in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Different From")).not.toBeNull();
  });

  it("renders object properties section in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Object Properties")).not.toBeNull();
  });

  it("renders data properties section in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Data Properties")).not.toBeNull();
  });

  it("renders annotations section in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Annotations")).not.toBeNull();
  });

  it("renders relationships section in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Relationships")).not.toBeNull();
  });

  it("allows typing in a label input in edit mode", async () => {
    const user = userEvent.setup();
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const labelInput = screen.getAllByPlaceholderText("Label text")[0];
    await user.clear(labelInput);
    await user.type(labelInput, "Jane Doe");
    expect((labelInput as HTMLInputElement).value).toBe("Jane Doe");
  });

  it("shows auto-save bar when in edit mode", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
  });

  it("auto-enters edit mode when onUpdateIndividual is provided", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
  });

  it("auto-enters edit mode when restoredDraft is available", async () => {
    autoSaveOverrides = {
      restoredDraft: {
        entityType: "individual",
        labels: [{ value: "Restored Name" }],
        comments: [{ value: "Restored Comment" }],
        definitions: [],
        typeIris: ["http://example.org/ontology#Person"],
        sameAsIris: [],
        differentFromIris: [],
        objectPropertyAssertions: [],
        dataPropertyAssertions: [],
        annotations: [],
        relationships: [],
        deprecated: false,
        updatedAt: Date.now(),
      },
    };
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(mockClearRestoredDraft).toHaveBeenCalled();
  });

  it("flushes pending draft to git on unmount", async () => {
    const { unmount } = render(
      <IndividualDetailPanel {...DEFAULT_PROPS} canEdit={false} />
    );
    unmount();
    await waitFor(() => {
      expect(mockFlushToGit).toHaveBeenCalled();
    });
  });

  it("does not auto-enter edit mode when canEdit is false even with onUpdateIndividual", () => {
    render(
      <IndividualDetailPanel {...DEFAULT_PROPS} canEdit={false} onUpdateIndividual={vi.fn()} />
    );
    expect(screen.queryByTestId("auto-save-bar")).toBeNull();
  });

  it("does not show edit button when canEdit is true but onUpdateIndividual is not provided", () => {
    render(
      <IndividualDetailPanel {...DEFAULT_PROPS} canEdit={true} />
    );
    expect(screen.queryByText("Edit Item")).toBeNull();
  });

  it("calls triggerSave on blur of label input", async () => {
    const user = userEvent.setup();
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const labelInput = screen.getAllByPlaceholderText("Label text")[0];
    await user.click(labelInput);
    await user.tab();
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("renders relationships section when isDefinedByIris present", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        isDefinedByIris: ["http://example.org/ontology"],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Relationships")).not.toBeNull();
  });

  it("does not restore draft when entityType does not match individual", async () => {
    autoSaveOverrides = {
      restoredDraft: {
        entityType: "class",
        labels: [{ value: "Wrong type" }],
        updatedAt: Date.now(),
      },
    };
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.queryByDisplayValue("Wrong type")).toBeNull();
  });

  it("renders multiple labels in read-only mode", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        labels: [
          { value: "John Doe" },
          { value: "Jean Dupont" },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getAllByText("John Doe").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Jean Dupont")).not.toBeNull();
  });

  it("renders object property assertion with target in read-only mode", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        objectPropertyAssertions: [
          {
            propertyIri: "http://example.org/ontology#hasParent",
            targetIri: "http://example.org/ontology#JamesDoe",
          },
        ],
      })
    );
    const onNavigate = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        onNavigateToEntity={onNavigate}
      />
    );
    expect(screen.getByText("Object Properties")).not.toBeNull();
    expect(screen.getByText("JamesDoe")).not.toBeNull();
  });

  it("renders data property assertion with datatype in read-only mode", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        dataPropertyAssertions: [
          {
            propertyIri: "http://example.org/ontology#hasName",
            value: "John",
            datatype: "http://www.w3.org/2001/XMLSchema#string",
          },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Data Properties")).not.toBeNull();
    expect(screen.getByText("John")).not.toBeNull();
    expect(screen.getByText("string")).not.toBeNull();
  });

  it("shows remove button when multiple labels exist in edit mode", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        labels: [
          { value: "John Doe" },
          { value: "Jean Dupont" },
        ],
      })
    );
    const onUpdateIndividual = vi.fn();
    const { container } = render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const removeButtons = container.querySelectorAll('button[aria-label="Remove"]');
    expect(removeButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders empty comment placeholder in edit mode when no comments", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ comments: [] })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Comment(s)")).not.toBeNull();
  });

  it("renders empty definition placeholder in edit mode when no definitions", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ definitions: [] })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Definition")).not.toBeNull();
  });

  it("renders types search in edit mode even when empty", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ typeIris: [] })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Type(s)")).not.toBeNull();
  });

  it("renders same-as search in edit mode even when empty", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ sameAsIris: [] })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Same As")).not.toBeNull();
  });

  it("renders different-from search in edit mode even when empty", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ differentFromIris: [] })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Different From")).not.toBeNull();
  });

  it("calls onNavigateToEntity when type IRI link is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        onNavigateToEntity={onNavigate}
      />
    );
    const personLink = screen.getByText("Person");
    await user.click(personLink);
    expect(onNavigate).toHaveBeenCalledWith(
      "http://example.org/ontology#Person"
    );
  });

  it("renders multiple comments in read-only mode", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        comments: [
          { value: "First comment" },
          { value: "Second comment" },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("First comment")).not.toBeNull();
    expect(screen.getByText("Second comment")).not.toBeNull();
  });

  it("renders multiple definitions in read-only mode", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        definitions: [
          { value: "Def one" },
          { value: "Def two" },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Def one")).not.toBeNull();
    expect(screen.getByText("Def two")).not.toBeNull();
  });

  it("does not render labels section in read-only when no labels", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ labels: [] })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Label(s)")).toBeNull();
  });

  it("does not render comments section in read-only when no comments", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ comments: [] })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Comment(s)")).toBeNull();
  });

  it("does not render definitions section in read-only when no definitions", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ definitions: [] })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Definition")).toBeNull();
  });

  it("calls onNavigateToEntity when clicking object property target", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        objectPropertyAssertions: [
          {
            propertyIri: "http://example.org/ontology#hasParent",
            targetIri: "http://example.org/ontology#JamesDoe",
          },
        ],
      })
    );
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        onNavigateToEntity={onNavigate}
      />
    );
    await user.click(screen.getByText("JamesDoe"));
    expect(onNavigate).toHaveBeenCalledWith(
      "http://example.org/ontology#JamesDoe"
    );
  });

  it("renders data property assertion without datatype badge when no datatype", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        dataPropertyAssertions: [
          {
            propertyIri: "http://example.org/ontology#hasNote",
            value: "A note",
          },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("A note")).not.toBeNull();
  });

  it("renders sameAs IRI links in read-only mode", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        sameAsIris: ["http://example.org/ontology#JDoe"],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("JDoe")).not.toBeNull();
  });

  it("renders differentFrom IRI links in read-only mode", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        differentFromIris: ["http://example.org/ontology#JaneDoe"],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("JaneDoe")).not.toBeNull();
  });

  it("invokes cancelEditMode via AutoSaveAffordanceBar onCancel", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedAutoSaveBarProps).not.toBeNull();
    const onCancel = capturedAutoSaveBarProps!.onCancel as () => void;
    onCancel();
    expect(mockDiscardDraft).toHaveBeenCalled();
  });

  it("invokes flushDraftToGit via AutoSaveAffordanceBar onManualSave", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedAutoSaveBarProps).not.toBeNull();
    const onManualSave = capturedAutoSaveBarProps!.onManualSave as () => Promise<void>;
    await onManualSave();
    expect(mockTriggerSave).toHaveBeenCalled();
    expect(mockFlushToGit).toHaveBeenCalled();
  });

  it("invokes flushToGit via AutoSaveAffordanceBar onRetry", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedAutoSaveBarProps).not.toBeNull();
    const onRetry = capturedAutoSaveBarProps!.onRetry as () => void;
    onRetry();
    expect(mockFlushToGit).toHaveBeenCalled();
  });

  it("passes comment callbacks to AnnotationRow", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const commentRow = capturedAnnotationRowProps.find(
      (p) => p.propertyIri === "http://www.w3.org/2000/01/rdf-schema#comment"
    );
    expect(commentRow).not.toBeNull();
    const onValueChange = commentRow!.onValueChange as (v: string) => void;
    onValueChange("Updated comment");

    await waitFor(() => {
      const updatedRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === "http://www.w3.org/2000/01/rdf-schema#comment" && p.value === "Updated comment"
      );
      expect(updatedRow).toBeDefined();
    });
  });

  it("passes definition callbacks to AnnotationRow", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const defRow = capturedAnnotationRowProps.find(
      (p) => p.propertyIri === "http://www.w3.org/2004/02/skos/core#definition"
    );
    expect(defRow).not.toBeNull();
    const onValueChange = defRow!.onValueChange as (v: string) => void;
    onValueChange("Updated definition");

    await waitFor(() => {
      const updatedRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === "http://www.w3.org/2004/02/skos/core#definition" && p.value === "Updated definition"
      );
      expect(updatedRow).toBeDefined();
    });
  });

  it("AnnotationRow onBlur triggers triggerSave", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const commentRow = capturedAnnotationRowProps.find(
      (p) => p.propertyIri === "http://www.w3.org/2000/01/rdf-schema#comment"
    );
    expect(commentRow).not.toBeNull();
    const onBlur = commentRow!.onBlur as () => void;
    onBlur();
    expect(mockTriggerSave).toHaveBeenCalled();
  });

  it("passes onRemove to AnnotationRow for non-last comment rows", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        comments: [
          { value: "First comment" },
          { value: "Second comment" },
        ],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const commentRows = capturedAnnotationRowProps.filter(
      (p) => p.propertyIri === "http://www.w3.org/2000/01/rdf-schema#comment"
    );
    const firstCommentRow = commentRows[0];
    expect(firstCommentRow).toBeDefined();
    expect(firstCommentRow!.onRemove).toBeDefined();
    const onRemove = firstCommentRow!.onRemove as () => void;
    onRemove();
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("passes onRemove to AnnotationRow for non-last definition rows", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        definitions: [
          { value: "First def" },
          { value: "Second def" },
        ],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const defRows = capturedAnnotationRowProps.filter(
      (p) => p.propertyIri === "http://www.w3.org/2004/02/skos/core#definition"
    );
    const firstDefRow = defRows[0];
    expect(firstDefRow).toBeDefined();
    expect(firstDefRow!.onRemove).toBeDefined();
    const onRemoveDef = firstDefRow!.onRemove as () => void;
    onRemoveDef();
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("passes onAdd callback to PropertyAssertionSection for object properties", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const objectSection = capturedPropertyAssertionProps.find(
      (p) => p.assertionType === "object"
    );
    expect(objectSection).not.toBeNull();
    const onAdd = objectSection!.onAdd as (a: Record<string, unknown>) => void;
    onAdd({ propertyIri: "http://example.org/ontology#knows", targetIri: "http://example.org/ontology#JaneDoe" });
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("passes onRemove callback to PropertyAssertionSection for object properties", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        objectPropertyAssertions: [
          {
            propertyIri: "http://example.org/ontology#hasParent",
            targetIri: "http://example.org/ontology#JamesDoe",
          },
        ],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const objectSection = capturedPropertyAssertionProps.find(
      (p) => p.assertionType === "object"
    );
    expect(objectSection).not.toBeNull();
    const onRemove = objectSection!.onRemove as (idx: number) => void;
    onRemove(0);
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("passes onAdd callback to PropertyAssertionSection for data properties", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const dataSection = capturedPropertyAssertionProps.find(
      (p) => p.assertionType === "data"
    );
    expect(dataSection).not.toBeNull();
    const onAdd = dataSection!.onAdd as (a: Record<string, unknown>) => void;
    onAdd({ propertyIri: "http://example.org/ontology#hasAge", value: "30" });
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("passes onRemove callback to PropertyAssertionSection for data properties", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        dataPropertyAssertions: [
          {
            propertyIri: "http://example.org/ontology#hasAge",
            value: "42",
          },
        ],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const dataSection = capturedPropertyAssertionProps.find(
      (p) => p.assertionType === "data"
    );
    expect(dataSection).not.toBeNull();
    const onRemove = dataSection!.onRemove as (idx: number) => void;
    onRemove(0);
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("passes relationship callbacks to RelationshipSection in edit mode", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        seeAlsoIris: ["http://example.org/ontology#related"],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedRelationshipSectionProps).not.toBeNull();
    const onAddTarget = capturedRelationshipSectionProps!.onAddTarget as (groupIdx: number, target: { iri: string; label: string }) => void;
    onAddTarget(0, { iri: "http://example.org/ontology#newRelated", label: "newRelated" });
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("invokes removeRelationshipTarget via RelationshipSection", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        seeAlsoIris: ["http://example.org/ontology#related"],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedRelationshipSectionProps).not.toBeNull();
    const onRemoveTarget = capturedRelationshipSectionProps!.onRemoveTarget as (groupIdx: number, targetIdx: number) => void;
    onRemoveTarget(0, 0);
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("invokes changeRelationshipProperty via RelationshipSection", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedRelationshipSectionProps).not.toBeNull();
    const onChangeProperty = capturedRelationshipSectionProps!.onChangeProperty as (groupIdx: number, newIri: string, newLabel: string) => void;
    onChangeProperty(0, "http://www.w3.org/2000/01/rdf-schema#isDefinedBy", "Defined By");
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("invokes addRelationshipGroup via RelationshipSection", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedRelationshipSectionProps).not.toBeNull();
    const groupsBefore = (capturedRelationshipSectionProps!.groups as unknown[]).length;
    const onAddGroup = capturedRelationshipSectionProps!.onAddGroup as () => void;
    onAddGroup();

    await waitFor(() => {
      const groupsAfter = (capturedRelationshipSectionProps!.groups as unknown[]).length;
      expect(groupsAfter).toBe(groupsBefore + 1);
    });
  });

  it("invokes updateAnnotationValue for custom annotations in edit mode", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            values: [{ value: "J. Doe" }],
          },
        ],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const annRow = capturedAnnotationRowProps.find(
      (p) => p.propertyIri === "http://www.w3.org/2004/02/skos/core#prefLabel"
    );
    expect(annRow).not.toBeNull();
    const onValueChange = annRow!.onValueChange as (v: string) => void;
    onValueChange("Updated Pref Label");

    await waitFor(() => {
      const updatedRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === "http://www.w3.org/2004/02/skos/core#prefLabel" && p.value === "Updated Pref Label"
      );
      expect(updatedRow).toBeDefined();
    });
  });

  it("invokes removeAnnotationValue for custom annotations in edit mode", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            values: [
              { value: "Label One" },
              { value: "Label Two" },
            ],
          },
        ],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const annRows = capturedAnnotationRowProps.filter(
      (p) => p.propertyIri === "http://www.w3.org/2004/02/skos/core#prefLabel"
    );
    const firstRow = annRows[0];
    expect(firstRow).toBeDefined();
    expect(firstRow!.onRemove).toBeDefined();
    const onRemoveAnn = firstRow!.onRemove as () => void;
    onRemoveAnn();
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("initializes edit state with seeAlso and isDefinedBy relationships", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        seeAlsoIris: ["http://example.org/ontology#related"],
        isDefinedByIris: ["http://example.org/ontology#ontology"],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedRelationshipSectionProps).not.toBeNull();
    expect(capturedRelationshipSectionProps!.isEditing).toBe(true);
  });

  it("clicking remove label button triggers triggerSave", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        labels: [
          { value: "label1" },
          { value: "label2" },
        ],
      })
    );
    const user = userEvent.setup();
    const onUpdateIndividual = vi.fn();
    const { container } = render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const removeButtons = container.querySelectorAll('button[aria-label="Remove"]');
    expect(removeButtons.length).toBeGreaterThanOrEqual(1);
    await user.click(removeButtons[0]);
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("renders annotation property label in read-only mode", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            values: [{ value: "Pref Label Value" }],
          },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Pref Label Value")).not.toBeNull();
  });

  it("passes onSaveNeeded callback to PropertyAssertionSection", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const objectSection = capturedPropertyAssertionProps.find(
      (p) => p.assertionType === "object"
    );
    expect(objectSection).not.toBeNull();
    const onSaveNeeded = objectSection!.onSaveNeeded as () => void;
    onSaveNeeded();
    expect(mockTriggerSave).toHaveBeenCalled();
  });

  it("stays in edit mode when flushDraftToGit flush fails", async () => {
    const onUpdateIndividual = vi.fn();
    mockFlushToGit.mockResolvedValue(false);
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedAutoSaveBarProps).not.toBeNull();
    const onManualSave = capturedAutoSaveBarProps!.onManualSave as () => Promise<void>;
    await onManualSave();
    expect(mockTriggerSave).toHaveBeenCalled();
    expect(mockFlushToGit).toHaveBeenCalled();
    expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
  });

  it("InlineAnnotationAdder adds value to existing annotation property", async () => {
    const PREF_LABEL_IRI = "http://www.w3.org/2004/02/skos/core#prefLabel";
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        annotations: [
          {
            property_iri: PREF_LABEL_IRI,
            values: [{ value: "Existing" }],
          },
        ],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
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
      const updatedRows = capturedAnnotationRowProps.filter(
        (p) => p.propertyIri === PREF_LABEL_IRI && p.value === "New Value"
      );
      expect(updatedRows.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("InlineAnnotationAdder creates new annotation property when not existing", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ annotations: [] })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
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
      const exampleRow = capturedAnnotationRowProps.find(
        (p) => p.propertyIri === "http://www.w3.org/2004/02/skos/core#example"
      );
      expect(exampleRow).toBeDefined();
    });
  });

  it("InlineAnnotationAdder onSaveNeeded calls triggerSave", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    await waitFor(() => {
      expect(capturedInlineAnnotationAdderProps).not.toBeNull();
    });

    const onSaveNeeded = capturedInlineAnnotationAdderProps!.onSaveNeeded as () => void;
    onSaveNeeded();
    expect(mockTriggerSave).toHaveBeenCalled();
  });

  it("RelationshipSection onSaveNeeded calls triggerSave", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
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

  it("renders labels section title in read-only when labels exist", () => {
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Label(s)")).not.toBeNull();
  });

  it("stays in edit mode after cancel and discards the draft", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    expect(capturedAutoSaveBarProps).not.toBeNull();
    const onCancel = capturedAutoSaveBarProps!.onCancel as () => void;
    onCancel();

    await waitFor(() => {
      expect(mockDiscardDraft).toHaveBeenCalled();
    });
    expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
  });

  it("initializes edit mode with isDefinedBy as separate relationship group", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        seeAlsoIris: [],
        isDefinedByIris: ["http://example.org/ontology#myOntology"],
      })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedRelationshipSectionProps).not.toBeNull();
    const groups = capturedRelationshipSectionProps!.groups as Array<{ property_label: string }>;
    const definedByGroup = groups.find((g) => g.property_label === "Defined By");
    expect(definedByGroup).toBeDefined();
  });

  it("renders object property assertion without target when targetIri is null", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        objectPropertyAssertions: [
          {
            propertyIri: "http://example.org/ontology#hasParent",
            targetIri: null,
          },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Object Properties")).not.toBeNull();
    expect(screen.getByText("hasParent")).not.toBeNull();
  });

  it("initializes edit mode with empty label placeholder when no labels", async () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({ labels: [] })
    );
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const labelInputs = screen.getAllByPlaceholderText("Label text");
    expect(labelInputs.length).toBeGreaterThanOrEqual(1);
    expect((labelInputs[0] as HTMLInputElement).value).toBe("");
  });

  it("renders data property assertion in read-only mode", () => {
    mockExtractIndividualDetail.mockReturnValue(
      makeIndividualDetail({
        dataPropertyAssertions: [
          {
            propertyIri: "http://example.org/ontology#hasName",
            value: "Jean",
          },
        ],
      })
    );
    render(<IndividualDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Data Properties")).not.toBeNull();
    expect(screen.getByText("Jean")).not.toBeNull();
  });

  it("passes onSaveNeeded callback to data PropertyAssertionSection", async () => {
    const onUpdateIndividual = vi.fn();
    render(
      <IndividualDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateIndividual={onUpdateIndividual}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const dataSection = capturedPropertyAssertionProps.find(
      (p) => p.assertionType === "data"
    );
    expect(dataSection).not.toBeNull();
    const onSaveNeeded = dataSection!.onSaveNeeded as () => void;
    onSaveNeeded();
    expect(mockTriggerSave).toHaveBeenCalled();
  });

});
