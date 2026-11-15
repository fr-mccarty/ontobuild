import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { AnnotationUpdate } from "@/lib/api/client";

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

vi.mock("@/components/editor/LanguageFlag", () => ({
  LanguageFlag: ({ lang }: { lang: string }) => <span data-testid="lang-flag">{lang}</span>,
}));

vi.mock("@/components/editor/standard/AnnotationRow", () => ({
  AnnotationRow: ({
    propertyIri,
    value,
    lang,
    onValueChange,
    onLangChange,
    onRemove,
    showPropertyLabel,
  }: {
    propertyIri: string;
    value: string;
    lang: string;
    onValueChange: (v: string) => void;
    onLangChange: (l: string) => void;
    onRemove: () => void;
    showPropertyLabel?: boolean;
  }) => (
    <div data-testid="annotation-row">
      <span data-testid="row-property">{propertyIri}</span>
      <input
        data-testid="row-value-input"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      />
      <input
        data-testid="row-lang-input"
        value={lang}
        onChange={(e) => onLangChange(e.target.value)}
      />
      {showPropertyLabel && <span data-testid="row-label">label</span>}
      <button data-testid="row-remove" onClick={onRemove}>Remove</button>
    </div>
  ),
}));

const {
  mockRdfsLabel,
  mockRdfsComment,
  mockSkosPrefLabel,
  mockSkosDefinition,
} = vi.hoisted(() => ({
  mockRdfsLabel: {
    iri: "http://www.w3.org/2000/01/rdf-schema#label",
    curie: "rdfs:label",
    displayLabel: "Label",
    vocabulary: "RDFS",
  },
  mockRdfsComment: {
    iri: "http://www.w3.org/2000/01/rdf-schema#comment",
    curie: "rdfs:comment",
    displayLabel: "Comment",
    vocabulary: "RDFS",
  },
  mockSkosPrefLabel: {
    iri: "http://www.w3.org/2004/02/skos/core#prefLabel",
    curie: "skos:prefLabel",
    displayLabel: "Preferred Label",
    vocabulary: "SKOS",
  },
  mockSkosDefinition: {
    iri: "http://www.w3.org/2004/02/skos/core#definition",
    curie: "skos:definition",
    displayLabel: "Definition",
    vocabulary: "SKOS",
  },
}));

vi.mock("@/lib/ontology/annotationProperties", () => ({
  ANNOTATION_PROPERTIES: [mockRdfsLabel, mockRdfsComment, mockSkosPrefLabel, mockSkosDefinition],
  getAnnotationPropertiesByVocabulary: () => ({
    RDFS: [mockRdfsLabel, mockRdfsComment],
    SKOS: [mockSkosPrefLabel, mockSkosDefinition],
  }),
  getAnnotationPropertyInfo: vi.fn((iri: string) => ({ curie: iri, label: iri })),
}));

import { AnnotationEditor, AnnotationPropertyPicker } from "@/components/editor/standard/AnnotationEditor";

const rdfsLabel = "http://www.w3.org/2000/01/rdf-schema#label";
const rdfsComment = "http://www.w3.org/2000/01/rdf-schema#comment";

const sampleAnnotations: AnnotationUpdate[] = [
  {
    property_iri: rdfsLabel,
    values: [
      { value: "My Class", lang: "en" },
      { value: "Ma Classe", lang: "fr" },
    ],
  },
  {
    property_iri: rdfsComment,
    values: [{ value: "A description", lang: "en" }],
  },
];

describe("AnnotationEditor", () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a row for each annotation value", () => {
    render(<AnnotationEditor annotations={sampleAnnotations} onChange={onChange} />);
    const rows = screen.getAllByTestId("annotation-row");
    expect(rows.length).toBe(3);
  });

  it("shows correct values in each row", () => {
    render(<AnnotationEditor annotations={sampleAnnotations} onChange={onChange} />);
    const inputs = screen.getAllByTestId("row-value-input");
    expect((inputs[0] as HTMLInputElement).value).toBe("My Class");
    expect((inputs[1] as HTMLInputElement).value).toBe("Ma Classe");
    expect((inputs[2] as HTMLInputElement).value).toBe("A description");
  });

  it("shows property labels by default", () => {
    render(<AnnotationEditor annotations={sampleAnnotations} onChange={onChange} />);
    const labels = screen.getAllByTestId("row-label");
    expect(labels.length).toBe(3);
  });

  it("hides property labels when showPropertyLabels is false", () => {
    render(
      <AnnotationEditor
        annotations={sampleAnnotations}
        onChange={onChange}
        showPropertyLabels={false}
      />
    );
    expect(screen.queryByTestId("row-label")).toBeNull();
  });

  it("renders empty state with add button when no annotations", () => {
    render(<AnnotationEditor annotations={[]} onChange={onChange} />);
    expect(screen.queryByTestId("annotation-row")).toBeNull();
    expect(screen.getByText("Add annotation")).toBeDefined();
  });

  it("filters annotations by propertyFilter whitelist", () => {
    render(
      <AnnotationEditor
        annotations={sampleAnnotations}
        onChange={onChange}
        propertyFilter={[rdfsLabel]}
      />
    );
    const rows = screen.getAllByTestId("annotation-row");
    expect(rows.length).toBe(2);
  });

  it("excludes annotations by excludeProperties blacklist", () => {
    render(
      <AnnotationEditor
        annotations={sampleAnnotations}
        onChange={onChange}
        excludeProperties={[rdfsLabel]}
      />
    );
    const rows = screen.getAllByTestId("annotation-row");
    expect(rows.length).toBe(1);
  });

  it("calls onChange when a value is updated", () => {
    render(<AnnotationEditor annotations={sampleAnnotations} onChange={onChange} />);
    const inputs = screen.getAllByTestId("row-value-input");
    fireEvent.change(inputs[0], { target: { value: "Updated Class" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as AnnotationUpdate[];
    expect(updated[0].values[0].value).toBe("Updated Class");
    expect(updated[0].values[1].value).toBe("Ma Classe");
    expect(updated[1].values[0].value).toBe("A description");
  });

  it("calls onChange when a language is updated", () => {
    render(<AnnotationEditor annotations={sampleAnnotations} onChange={onChange} />);
    const langInputs = screen.getAllByTestId("row-lang-input");
    fireEvent.change(langInputs[1], { target: { value: "de" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as AnnotationUpdate[];
    expect(updated[0].values[1].lang).toBe("de");
  });

  it("calls onChange with value removed when remove is clicked", () => {
    render(<AnnotationEditor annotations={sampleAnnotations} onChange={onChange} />);
    const removeButtons = screen.getAllByTestId("row-remove");
    fireEvent.click(removeButtons[1]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as AnnotationUpdate[];
    expect(updated[0].values.length).toBe(1);
    expect(updated[0].values[0].value).toBe("My Class");
  });

  it("removes the annotation entry entirely when last value is removed", () => {
    render(<AnnotationEditor annotations={sampleAnnotations} onChange={onChange} />);
    const removeButtons = screen.getAllByTestId("row-remove");
    fireEvent.click(removeButtons[2]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as AnnotationUpdate[];
    expect(updated.length).toBe(1);
    expect(updated[0].property_iri).toBe(rdfsLabel);
  });

  it("shows picker when 'Add annotation' button is clicked", () => {
    render(<AnnotationEditor annotations={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Add annotation"));
    expect(screen.getByPlaceholderText("Search annotation properties...")).toBeDefined();
  });

  it("adds a new annotation when a property is selected from picker", () => {
    render(<AnnotationEditor annotations={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Add annotation"));
    fireEvent.click(screen.getByText("Label"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as AnnotationUpdate[];
    expect(updated.length).toBe(1);
    expect(updated[0].property_iri).toBe(rdfsLabel);
    expect(updated[0].values).toEqual([{ value: "", lang: "en" }]);
  });

  it("appends a value to existing property when selected from picker", () => {
    render(<AnnotationEditor annotations={sampleAnnotations} onChange={onChange} />);
    fireEvent.click(screen.getByText("Add annotation"));
    fireEvent.click(screen.getByText("Label"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0] as AnnotationUpdate[];
    expect(updated[0].values.length).toBe(3);
    expect(updated[0].values[2]).toEqual({ value: "", lang: "en" });
  });

  it("hides picker after selecting a property", () => {
    render(<AnnotationEditor annotations={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText("Add annotation"));
    expect(screen.getByPlaceholderText("Search annotation properties...")).toBeDefined();
    fireEvent.click(screen.getByText("Label"));
    expect(screen.queryByPlaceholderText("Search annotation properties...")).toBeNull();
  });
});

describe("AnnotationPropertyPicker", () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders grouped properties", () => {
    render(<AnnotationPropertyPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText("RDFS")).toBeDefined();
    expect(screen.getByText("SKOS")).toBeDefined();
    expect(screen.getByText("Label")).toBeDefined();
    expect(screen.getByText("Comment")).toBeDefined();
    expect(screen.getByText("Preferred Label")).toBeDefined();
    expect(screen.getByText("Definition")).toBeDefined();
  });

  it("shows curie alongside display label", () => {
    render(<AnnotationPropertyPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText("rdfs:label")).toBeDefined();
    expect(screen.getByText("skos:prefLabel")).toBeDefined();
  });

  it("filters properties by search query", async () => {
    const user = userEvent.setup();
    render(<AnnotationPropertyPicker onSelect={onSelect} onClose={onClose} />);
    const input = screen.getByPlaceholderText("Search annotation properties...");
    await user.type(input, "pref");
    expect(screen.getByText("Preferred Label")).toBeDefined();
    expect(screen.queryByText("Label")).toBeNull();
    expect(screen.queryByText("Comment")).toBeNull();
  });

  it("shows 'No matching properties' when search has no results", async () => {
    const user = userEvent.setup();
    render(<AnnotationPropertyPicker onSelect={onSelect} onClose={onClose} />);
    const input = screen.getByPlaceholderText("Search annotation properties...");
    await user.type(input, "zzzznonexistent");
    expect(screen.getByText("No matching properties")).toBeDefined();
  });

  it("calls onSelect with IRI when property is clicked", () => {
    render(<AnnotationPropertyPicker onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByText("Comment"));
    expect(onSelect).toHaveBeenCalledWith(rdfsComment);
  });

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    render(<AnnotationPropertyPicker onSelect={onSelect} onClose={onClose} />);
    const input = screen.getByPlaceholderText("Search annotation properties...");
    await user.type(input, "{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when X button is clicked", () => {
    const { container } = render(
      <AnnotationPropertyPicker onSelect={onSelect} onClose={onClose} />
    );
    const buttons = container.querySelectorAll("button");
    const closeButton = Array.from(buttons).find(
      (btn) => btn.closest(".flex.items-center.gap-2") !== null
    );
    if (closeButton) {
      fireEvent.click(closeButton);
    } else {
      fireEvent.click(buttons[0]);
    }
    expect(onClose).toHaveBeenCalled();
  });

  it("excludes properties listed in excludeIris", () => {
    render(
      <AnnotationPropertyPicker
        onSelect={onSelect}
        onClose={onClose}
        excludeIris={[rdfsLabel, rdfsComment]}
      />
    );
    expect(screen.queryByText("Label")).toBeNull();
    expect(screen.queryByText("Comment")).toBeNull();
    expect(screen.getByText("Preferred Label")).toBeDefined();
    expect(screen.getByText("Definition")).toBeDefined();
  });

  it("hides vocabulary group when all its properties are excluded", () => {
    render(
      <AnnotationPropertyPicker
        onSelect={onSelect}
        onClose={onClose}
        excludeIris={[rdfsLabel, rdfsComment]}
      />
    );
    expect(screen.queryByText("RDFS")).toBeNull();
    expect(screen.getByText("SKOS")).toBeDefined();
  });

  it("calls onClose when clicking outside the picker", () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <AnnotationPropertyPicker onSelect={onSelect} onClose={onClose} />
      </div>
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
  });
});
