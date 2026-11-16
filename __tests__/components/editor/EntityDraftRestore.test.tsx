/**
 * Draft restore, end to end: these tests use the real useEntityAutoSave hook and the
 * real draft store (unlike the per-panel tests, which mock the hook), so they cover the
 * timing between the draft being read from the store and the panel entering edit mode.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

vi.mock("@/lib/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/lib/stores/preferencesStore", () => ({
  usePreferencesStore: (selector: (s: Record<string, unknown>) => unknown) => selector({}),
}));

vi.mock("@/lib/hooks/useIriLabels", () => ({
  useIriLabels: () => ({}),
}));

import { PropertyDetailPanel } from "@/components/editor/PropertyDetailPanel";
import { IndividualDetailPanel } from "@/components/editor/IndividualDetailPanel";
import {
  useDraftStore,
  draftKey,
  type PropertyDraftEntry,
  type IndividualDraftEntry,
} from "@/lib/stores/draftStore";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });

const PROJECT_ID = "proj-1";
const BRANCH = "main";
const PROPERTY_IRI = "http://example.org/ontology#hasParent";
const INDIVIDUAL_IRI = "http://example.org/ontology#JohnDoe";

const SOURCE = `@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix : <http://example.org/ontology#> .
:Person a owl:Class .
:hasParent a owl:ObjectProperty ;
  rdfs:label "hasParent"@en ;
  rdfs:domain :Person ;
  rdfs:range :Person .
:JohnDoe a owl:NamedIndividual , :Person ;
  rdfs:label "John Doe"@en .
`;

function labelInputValues(): string[] {
  return screen
    .getAllByPlaceholderText("Label text")
    .map((el) => (el as HTMLInputElement).value);
}

beforeEach(() => {
  useDraftStore.setState({ drafts: {} });
});

describe("PropertyDetailPanel draft restore", () => {
  it("shows a draft that is already in the store when the panel mounts", () => {
    const draft: PropertyDraftEntry = {
      entityType: "property",
      propertyType: "object",
      labels: [{ value: "Draft label" }],
      comments: [],
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
    };
    useDraftStore.getState().setDraft(draftKey(PROJECT_ID, BRANCH, PROPERTY_IRI), draft);

    render(
      <PropertyDetailPanel
        projectId={PROJECT_ID}
        branch={BRANCH}
        propertyIri={PROPERTY_IRI}
        sourceContent={SOURCE}
        canEdit
        onUpdateProperty={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(labelInputValues()).toContain("Draft label");
    expect(labelInputValues()).not.toContain("hasParent");
  });

  it("seeds the form from the loaded property when there is no draft", () => {
    render(
      <PropertyDetailPanel
        projectId={PROJECT_ID}
        branch={BRANCH}
        propertyIri={PROPERTY_IRI}
        sourceContent={SOURCE}
        canEdit
        onUpdateProperty={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(labelInputValues()).toContain("hasParent");
  });
});

describe("IndividualDetailPanel draft restore", () => {
  it("shows a draft that is already in the store when the panel mounts", () => {
    const draft: IndividualDraftEntry = {
      entityType: "individual",
      labels: [{ value: "Draft individual" }],
      comments: [],
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
    };
    useDraftStore.getState().setDraft(draftKey(PROJECT_ID, BRANCH, INDIVIDUAL_IRI), draft);

    render(
      <IndividualDetailPanel
        projectId={PROJECT_ID}
        branch={BRANCH}
        individualIri={INDIVIDUAL_IRI}
        sourceContent={SOURCE}
        canEdit
        onUpdateIndividual={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(labelInputValues()).toContain("Draft individual");
    expect(labelInputValues()).not.toContain("John Doe");
  });

  it("seeds the form from the loaded individual when there is no draft", () => {
    render(
      <IndividualDetailPanel
        projectId={PROJECT_ID}
        branch={BRANCH}
        individualIri={INDIVIDUAL_IRI}
        sourceContent={SOURCE}
        canEdit
        onUpdateIndividual={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(labelInputValues()).toContain("John Doe");
  });

  it("re-seeds the form when the selected individual changes without a remount", () => {
    const source = `${SOURCE}:JaneDoe a owl:NamedIndividual , :Person ;
  rdfs:label "Jane Doe"@en .
`;
    const props = {
      projectId: PROJECT_ID,
      branch: BRANCH,
      sourceContent: source,
      canEdit: true,
      onUpdateIndividual: vi.fn().mockResolvedValue(undefined),
    };
    const { rerender } = render(<IndividualDetailPanel {...props} individualIri={INDIVIDUAL_IRI} />);
    expect(labelInputValues()).toContain("John Doe");

    rerender(<IndividualDetailPanel {...props} individualIri="http://example.org/ontology#JaneDoe" />);
    expect(labelInputValues()).toContain("Jane Doe");
    expect(labelInputValues()).not.toContain("John Doe");
  });
});
