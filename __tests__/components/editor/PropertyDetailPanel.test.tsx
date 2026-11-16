import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });
import userEvent from "@testing-library/user-event";

const mockExtractPropertyDetail = vi.fn();
vi.mock("@/lib/ontology/entityDetailExtractors", () => ({
  extractPropertyDetail: (...args: unknown[]) => mockExtractPropertyDetail(...args),
  PROPERTY_CHARACTERISTIC_TYPES: [
    { iri: "http://www.w3.org/2002/07/owl#FunctionalProperty", label: "Functional" },
    { iri: "http://www.w3.org/2002/07/owl#InverseFunctionalProperty", label: "Inverse Functional" },
    { iri: "http://www.w3.org/2002/07/owl#TransitiveProperty", label: "Transitive" },
    { iri: "http://www.w3.org/2002/07/owl#SymmetricProperty", label: "Symmetric" },
    { iri: "http://www.w3.org/2002/07/owl#AsymmetricProperty", label: "Asymmetric" },
    { iri: "http://www.w3.org/2002/07/owl#ReflexiveProperty", label: "Reflexive" },
    { iri: "http://www.w3.org/2002/07/owl#IrreflexiveProperty", label: "Irreflexive" },
  ],
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

let capturedAutoSaveBarProps: Record<string, unknown> | null = null;
vi.mock("@/components/editor/AutoSaveAffordanceBar", () => ({
  AutoSaveAffordanceBar: (props: Record<string, unknown>) => {
    capturedAutoSaveBarProps = props;
    return <div data-testid="auto-save-bar">AutoSaveBar</div>;
  },
}));

import { PropertyDetailPanel } from "@/components/editor/PropertyDetailPanel";

function makePropertyDetail(overrides: Record<string, unknown> = {}) {
  return {
    propertyType: "object" as const,
    labels: [{ value: "hasParent" }],
    comments: [{ value: "Relates a person to their parent" }],
    definitions: [{ value: "A relationship linking child to parent" }],
    annotations: [],
    domainIris: ["http://example.org/ontology#Person"],
    rangeIris: ["http://example.org/ontology#Person"],
    parentIris: ["http://example.org/ontology#hasRelative"],
    inverseOf: "http://example.org/ontology#hasChild",
    characteristics: ["http://www.w3.org/2002/07/owl#AsymmetricProperty"],
    deprecated: false,
    equivalentIris: [],
    disjointIris: [],
    seeAlsoIris: [],
    isDefinedByIris: [],
    ...overrides,
  };
}

const SAMPLE_SOURCE = `@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix : <http://example.org/ontology#> .
:hasParent a owl:ObjectProperty ;
  rdfs:label "hasParent"@en ;
  rdfs:comment "Relates a person to their parent"@en ;
  rdfs:domain :Person ;
  rdfs:range :Person ;
  rdfs:subPropertyOf :hasRelative ;
  owl:inverseOf :hasChild .
`;

const DEFAULT_PROPS = {
  projectId: "proj-1",
  propertyIri: "http://example.org/ontology#hasParent",
  sourceContent: SAMPLE_SOURCE,
  canEdit: false,
  branch: "main",
};

describe("PropertyDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlushToGit.mockResolvedValue(true);
    autoSaveOverrides = {};
    preferencesOverrides = {};
    capturedAnnotationRowProps = [];
    capturedRelationshipSectionProps = null;
    capturedAutoSaveBarProps = null;
    capturedInlineAnnotationAdderProps = null;
    mockExtractPropertyDetail.mockReturnValue(makePropertyDetail());
  });

  it("renders 'Select a property' placeholder when propertyIri is null", () => {
    render(
      <PropertyDetailPanel
        projectId="proj-1"
        propertyIri={null}
        sourceContent=""
        canEdit={false}
      />
    );
    expect(
      screen.getByText("Select a property to view its details")
    ).toBeDefined();
  });

  it("shows a loading spinner when sourceContent is empty", () => {
    const { container } = render(
      <PropertyDetailPanel
        projectId="proj-1"
        propertyIri="http://example.org/ontology#hasParent"
        sourceContent=""
        canEdit={false}
      />
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows not-found message when extractPropertyDetail returns null", () => {
    mockExtractPropertyDetail.mockReturnValue(null);
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(
      screen.getByText("Could not find this property in the ontology source.")
    ).toBeDefined();
  });

  it("shows property IRI in not-found state header", () => {
    mockExtractPropertyDetail.mockReturnValue(null);
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(
      screen.getByText("http://example.org/ontology#hasParent")
    ).toBeDefined();
  });

  it("shows local name in not-found state header", () => {
    mockExtractPropertyDetail.mockReturnValue(null);
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("hasParent")).toBeDefined();
  });

  it("renders property label and IRI", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getAllByText("hasParent").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("http://example.org/ontology#hasParent")
    ).toBeDefined();
  });

  it("renders property type badge for object property", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Object Property")).toBeDefined();
  });

  it("renders property type badge for data property", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ propertyType: "data" })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Data Property")).toBeDefined();
  });

  it("renders property type badge for annotation property", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ propertyType: "annotation" })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Annotation Property")).toBeDefined();
  });

  it("renders deprecated badge when property is deprecated", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ deprecated: true })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Deprecated")).toBeDefined();
  });

  it("renders comments section", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(
      screen.getByText("Relates a person to their parent")
    ).toBeDefined();
  });

  it("renders definitions section", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(
      screen.getByText("A relationship linking child to parent")
    ).toBeDefined();
  });

  it("renders domain section", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Domain")).toBeDefined();
  });

  it("renders range section", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Range")).toBeDefined();
  });

  it("renders parent properties section", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Parent Properties")).toBeDefined();
  });

  it("renders inverse of section for object properties", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Inverse Of")).toBeDefined();
  });

  it("renders characteristics section for object properties", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Characteristics")).toBeDefined();
    expect(screen.getByText("Asymmetric")).toBeDefined();
  });

  it("renders equivalent properties when present", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        equivalentIris: ["http://example.org/ontology#hasProgenitor"],
      })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Equivalent Properties")).toBeDefined();
  });

  it("renders disjoint properties when present", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        disjointIris: ["http://example.org/ontology#hasEnemy"],
      })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Disjoint Properties")).toBeDefined();
  });

  it("renders annotations when present", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            values: [{ value: "Parent Property" }],
          },
        ],
      })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Parent Property")).toBeDefined();
  });

  it("does not render empty optional sections", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        domainIris: [],
        rangeIris: [],
        parentIris: [],
        inverseOf: null,
        characteristics: [],
        equivalentIris: [],
        disjointIris: [],
      })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.queryByText("Domain")).toBeNull();
    expect(screen.queryByText("Range")).toBeNull();
    expect(screen.queryByText("Parent Properties")).toBeNull();
    expect(screen.queryByText("Equivalent Properties")).toBeNull();
    expect(screen.queryByText("Disjoint Properties")).toBeNull();
  });

  it("renders Copy IRI button when onCopyIri is provided", () => {
    const onCopyIri = vi.fn();
    render(<PropertyDetailPanel {...DEFAULT_PROPS} onCopyIri={onCopyIri} />);
    expect(screen.getByLabelText("Copy IRI")).toBeDefined();
  });

  it("calls onCopyIri when Copy IRI button is clicked", async () => {
    const user = userEvent.setup();
    const onCopyIri = vi.fn();
    render(<PropertyDetailPanel {...DEFAULT_PROPS} onCopyIri={onCopyIri} />);
    await user.click(screen.getByLabelText("Copy IRI"));
    expect(onCopyIri).toHaveBeenCalledWith(
      "http://example.org/ontology#hasParent"
    );
  });

  it("does not show edit button when canEdit is false", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Edit Item")).toBeNull();
  });

  it("auto-enters edit mode when canEdit is true and onUpdateProperty provided", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
  });

  it("never renders an Edit Item button in editor context", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.queryByText("Edit Item")).toBeNull();
  });

  it("calls extractPropertyDetail with sourceContent and propertyIri", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(mockExtractPropertyDetail).toHaveBeenCalledWith(
      SAMPLE_SOURCE,
      "http://example.org/ontology#hasParent"
    );
  });

  it("re-parses when refreshKey changes", () => {
    const { rerender } = render(
      <PropertyDetailPanel {...DEFAULT_PROPS} refreshKey={1} />
    );
    expect(mockExtractPropertyDetail).toHaveBeenCalledTimes(1);

    rerender(<PropertyDetailPanel {...DEFAULT_PROPS} refreshKey={2} />);
    expect(mockExtractPropertyDetail).toHaveBeenCalledTimes(2);
  });

  it("renders local name when property has no labels", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ labels: [] })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getAllByText("hasParent").length).toBeGreaterThanOrEqual(1);
  });

  it("renders relationships section when seeAlsoIris present", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        seeAlsoIris: ["http://example.org/ontology#relatedProp"],
      })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Relationships")).toBeDefined();
  });

  it("does not render relationships section when no seeAlso or isDefinedBy", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        seeAlsoIris: [],
        isDefinedByIris: [],
      })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Relationships")).toBeNull();
  });

  it("renders editable label inputs in edit mode", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const labelInputs = screen.getAllByPlaceholderText("Label text");
    expect(labelInputs.length).toBeGreaterThanOrEqual(1);
  });

  it("renders editable comment section in edit mode", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Comment(s)")).not.toBeNull();
  });

  it("renders editable definition section in edit mode", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Definition")).not.toBeNull();
  });

  it("renders domain section in edit mode", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Domain")).not.toBeNull();
  });

  it("renders range section in edit mode", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Range")).not.toBeNull();
  });

  it("renders characteristics checkboxes in edit mode for object property", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Functional")).not.toBeNull();
    expect(screen.getByText("Transitive")).not.toBeNull();
    expect(screen.getByText("Symmetric")).not.toBeNull();
  });

  it("renders inverse-of section in edit mode for object property", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Inverse Of")).not.toBeNull();
  });

  it("renders annotations section in edit mode", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Annotations")).not.toBeNull();
  });

  it("renders relationships section in edit mode", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Relationships")).not.toBeNull();
  });

  it("allows typing in a label input in edit mode", async () => {
    const user = userEvent.setup();
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const labelInput = screen.getAllByPlaceholderText("Label text")[0];
    await user.clear(labelInput);
    await user.type(labelInput, "newLabel");
    expect((labelInput as HTMLInputElement).value).toBe("newLabel");
  });

  it("toggles characteristic checkbox in edit mode", async () => {
    const onUpdateProperty = vi.fn();
    const { container } = render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const functionalCheckbox = container.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    expect(functionalCheckbox).not.toBeNull();
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    const asymmetricCheckbox = Array.from(checkboxes).find((cb) => {
      const label = cb.closest("label");
      return label?.textContent?.includes("Asymmetric");
    }) as HTMLInputElement | undefined;
    expect(asymmetricCheckbox).not.toBeNull();
    expect(asymmetricCheckbox!.checked).toBe(true);
  });

  it("discards draft when cancel is invoked but stays in edit mode", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });

    expect(capturedAutoSaveBarProps).not.toBeNull();
    const onCancel = capturedAutoSaveBarProps!.onCancel as () => void;
    expect(onCancel).toBeDefined();
    onCancel();

    await waitFor(() => {
      expect(mockDiscardDraft).toHaveBeenCalled();
    });
    expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
  });

  it("auto-enters edit mode when onUpdateProperty is provided", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
  });

  it("auto-enters edit mode when restoredDraft is available", () => {
    autoSaveOverrides = {
      restoredDraft: {
        entityType: "property",
        propertyType: "object",
        labels: [{ value: "Restored Label" }],
        comments: [{ value: "Restored Comment" }],
        definitions: [],
        domainIris: [],
        rangeIris: [],
        parentIris: [],
        inverseOf: null,
        characteristics: [],
        annotations: [],
        relationships: [],
        deprecated: false,
        equivalentIris: [],
        disjointIris: [],
        updatedAt: Date.now(),
      },
    };
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    expect(mockClearRestoredDraft).toHaveBeenCalled();
  });

  it("flushes pending draft to git on unmount", async () => {
    const { unmount } = render(
      <PropertyDetailPanel {...DEFAULT_PROPS} canEdit={false} />
    );
    unmount();
    expect(mockFlushToGit).toHaveBeenCalled();
  });

  it("does not render characteristics for data properties", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ propertyType: "data", characteristics: [] })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.queryByText("Characteristics")).toBeNull();
  });

  it("does not render inverse-of for data properties", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ propertyType: "data", inverseOf: null })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.queryByText("Inverse Of")).toBeNull();
  });

  it("does not render inverse-of for annotation properties", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ propertyType: "annotation", inverseOf: null })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.queryByText("Inverse Of")).toBeNull();
  });

  it("does not auto-enter edit mode when canEdit is false even with onUpdateProperty", () => {
    render(
      <PropertyDetailPanel {...DEFAULT_PROPS} canEdit={false} onUpdateProperty={vi.fn()} />
    );
    expect(screen.queryByTestId("auto-save-bar")).toBeNull();
  });

  it("does not show edit button when canEdit is true but onUpdateProperty is not provided", () => {
    render(
      <PropertyDetailPanel {...DEFAULT_PROPS} canEdit={true} />
    );
    expect(screen.queryByText("Edit Item")).toBeNull();
  });

  it("calls triggerSave on blur of label input", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const user = userEvent.setup();
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        isDefinedByIris: ["http://example.org/ontology"],
      })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Relationships")).not.toBeNull();
  });

  it("renders parent properties section in edit mode", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Parent Properties")).not.toBeNull();
  });

  it("does not restore draft when entityType does not match property", async () => {
    autoSaveOverrides = {
      restoredDraft: {
        entityType: "class",
        labels: [{ value: "Wrong type" }],
        updatedAt: Date.now(),
      },
    };
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.queryByDisplayValue("Wrong type")).toBeNull();
  });

  it("shows remove button when multiple labels exist in edit mode", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        labels: [
          { value: "hasParent" },
          { value: "aParent" },
        ],
      })
    );
    const onUpdateProperty = vi.fn();
    const { container } = render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const removeButtons = container.querySelectorAll('button[aria-label="Remove"]');
    expect(removeButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders empty comment placeholder in edit mode when no comments", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ comments: [] })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Comment(s)")).not.toBeNull();
  });

  it("renders empty definition placeholder in edit mode when no definitions", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ definitions: [] })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Definition")).not.toBeNull();
  });

  it("renders domain search in edit mode even when empty", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ domainIris: [] })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Domain")).not.toBeNull();
  });

  it("renders range search in edit mode even when empty", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ rangeIris: [] })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Range")).not.toBeNull();
  });

  it("renders parent properties search in edit mode even when empty", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ parentIris: [] })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Parent Properties")).not.toBeNull();
  });

  it("renders inverse-of search in edit mode for object property with no inverse", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ inverseOf: null })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(screen.getByText("Inverse Of")).not.toBeNull();
  });

  it("renders all characteristic checkboxes in edit mode when none selected", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ characteristics: [] })
    );
    const onUpdateProperty = vi.fn();
    const { container } = render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(7);
    const allUnchecked = Array.from(checkboxes).every(
      (cb) => !(cb as HTMLInputElement).checked
    );
    expect(allUnchecked).toBe(true);
  });

  it("calls onNavigateToEntity when domain IRI link is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        onNavigateToEntity={onNavigate}
      />
    );
    const personLink = screen.getAllByText("Person")[0];
    await user.click(personLink);
    expect(onNavigate).toHaveBeenCalledWith(
      "http://example.org/ontology#Person"
    );
  });

  it("renders multiple comments in read-only mode", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        comments: [
          { value: "First comment" },
          { value: "Second comment" },
        ],
      })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("First comment")).not.toBeNull();
    expect(screen.getByText("Second comment")).not.toBeNull();
  });

  it("renders multiple definitions in read-only mode", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        definitions: [
          { value: "Def one" },
          { value: "Def two" },
        ],
      })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Def one")).not.toBeNull();
    expect(screen.getByText("Def two")).not.toBeNull();
  });

  it("clicking a characteristic checkbox calls triggerSave via requestAnimationFrame", async () => {
    const user = userEvent.setup();
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const functionalLabel = screen.getByText("Functional");
    await user.click(functionalLabel);
    await waitFor(() => {
      expect(mockTriggerSave).toHaveBeenCalled();
    });
  });

  it("renders parent property links in read-only mode", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("hasRelative")).not.toBeNull();
  });

  it("renders inverse-of link in read-only mode", () => {
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("hasChild")).not.toBeNull();
  });

  it("does not render labels section in read-only when no labels", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ labels: [] })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Label(s)")).toBeNull();
  });

  it("does not render comments section in read-only when no comments", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ comments: [] })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Comment(s)")).toBeNull();
  });

  it("does not render definitions section in read-only when no definitions", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ definitions: [] })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} canEdit={false} />);
    expect(screen.queryByText("Definition")).toBeNull();
  });

  it("invokes cancelEditMode via AutoSaveAffordanceBar onCancel", async () => {
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        comments: [
          { value: "First comment" },
          { value: "Second comment" },
        ],
      })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        definitions: [
          { value: "First def" },
          { value: "Second def" },
        ],
      })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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

  it("passes relationship callbacks to RelationshipSection in edit mode", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        seeAlsoIris: ["http://example.org/ontology#related"],
      })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        seeAlsoIris: ["http://example.org/ontology#related"],
      })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            values: [{ value: "Parent Property" }],
          },
        ],
      })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
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
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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

  it("initializes edit state with seeAlso relationships", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        seeAlsoIris: ["http://example.org/ontology#related"],
        isDefinedByIris: ["http://example.org/ontology#ontology"],
      })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    expect(capturedRelationshipSectionProps).not.toBeNull();
    expect(capturedRelationshipSectionProps!.isEditing).toBe(true);
  });

  it("clicking remove label button triggers triggerSave", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        labels: [
          { value: "label1" },
          { value: "label2" },
        ],
      })
    );
    const user = userEvent.setup();
    const onUpdateProperty = vi.fn();
    const { container } = render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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

  it("renders annotation property label from resolvedLabels", () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        annotations: [
          {
            property_iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
            values: [{ value: "Pref Label Value" }],
          },
        ],
      })
    );
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Pref Label Value")).not.toBeNull();
  });

  it("stays in edit mode when flushDraftToGit flush fails", async () => {
    const onUpdateProperty = vi.fn();
    mockFlushToGit.mockResolvedValue(false);
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        annotations: [
          {
            property_iri: PREF_LABEL_IRI,
            values: [{ value: "Existing" }],
          },
        ],
      })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ annotations: [] })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
    render(<PropertyDetailPanel {...DEFAULT_PROPS} />);
    expect(screen.getByText("Label(s)")).not.toBeNull();
  });

  it("initializes edit mode with empty label placeholder when no labels", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({ labels: [] })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId("auto-save-bar")).not.toBeNull();
    });
    const labelInputs = screen.getAllByPlaceholderText("Label text");
    expect(labelInputs.length).toBeGreaterThanOrEqual(1);
    expect((labelInputs[0] as HTMLInputElement).value).toBe("");
  });

  it("initializes edit mode with isDefinedBy as separate relationship group", async () => {
    mockExtractPropertyDetail.mockReturnValue(
      makePropertyDetail({
        seeAlsoIris: [],
        isDefinedByIris: ["http://example.org/ontology#myOntology"],
      })
    );
    const onUpdateProperty = vi.fn();
    render(
      <PropertyDetailPanel
        {...DEFAULT_PROPS}
        canEdit={true}
        onUpdateProperty={onUpdateProperty}
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
});
