import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddEntityDialog } from "@/components/editor/AddEntityDialog";

vi.mock("@/lib/ontology/iriGeneration", () => ({
  labelToLocalName: (label: string) => label.replace(/\s+/g, ""),
  uuidToBase62: () => "TestBase62Uuid",
}));

describe("AddEntityDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onConfirm: vi.fn(),
    iriPattern: "uuid" as const,
    nextNumeric: 1,
    ontologyNamespace: "http://example.org/ontology#",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders dialog title and description when open", () => {
    render(<AddEntityDialog {...defaultProps} />);
    expect(screen.getByText("Add Entity")).toBeDefined();
    expect(
      screen.getByText("Create a new entity in this ontology")
    ).toBeDefined();
  });

  it("does not render when closed", () => {
    render(<AddEntityDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Add Entity")).toBeNull();
  });

  it("shows subclass description when parentIri is provided", () => {
    render(
      <AddEntityDialog
        {...defaultProps}
        parentIri="http://example.org/ontology#Animal"
        parentLabel="Animal"
      />
    );
    expect(screen.getByText("Animal")).toBeDefined();
    expect(screen.getByText(/Create a new subclass of/)).toBeDefined();
  });

  it("extracts parent display name from IRI with hash", () => {
    render(
      <AddEntityDialog
        {...defaultProps}
        parentIri="http://example.org/ontology#MyClass"
      />
    );
    expect(screen.getByText("MyClass")).toBeDefined();
  });

  it("extracts parent display name from IRI with slash", () => {
    render(
      <AddEntityDialog
        {...defaultProps}
        parentIri="http://example.org/ontology/SomeClass"
      />
    );
    expect(screen.getByText("SomeClass")).toBeDefined();
  });

  it("limits type to Class or Individual when parentIri is set", () => {
    render(
      <AddEntityDialog
        {...defaultProps}
        parentIri="http://example.org/ontology#Animal"
      />
    );
    const select = screen.getByLabelText("Type") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect([...select.options].map((o) => o.value)).toEqual(["class", "individual"]);
    expect(select.value).toBe("class");
    expect(screen.getByText(/Create a new subclass of/)).toBeDefined();
    fireEvent.change(select, { target: { value: "individual" } });
    expect(screen.getByText(/Create a new individual of/)).toBeDefined();
  });

  it("preselects Individual when opened with initialType", () => {
    render(
      <AddEntityDialog
        {...defaultProps}
        parentIri="http://example.org/ontology#Animal"
        initialType="individual"
      />
    );
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("individual");
  });

  it("renders all entity type options", () => {
    render(<AddEntityDialog {...defaultProps} />);
    expect(screen.getByText("Class")).toBeDefined();
    expect(screen.getByText("Object Property")).toBeDefined();
    expect(screen.getByText("Data Property")).toBeDefined();
    expect(screen.getByText("Annotation Property")).toBeDefined();
    expect(screen.getByText("Individual")).toBeDefined();
  });

  it("disables Create button when label is empty", () => {
    render(<AddEntityDialog {...defaultProps} />);
    const createBtn = screen.getByText("Create");
    expect((createBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Create button when label is typed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText("e.g., Privileged Altar");
    await user.type(input, "NewEntity");

    const createBtn = screen.getByText("Create");
    expect((createBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls onConfirm and closes dialog on submit", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText("e.g., Privileged Altar");
    await user.type(input, "NewEntity");
    await user.click(screen.getByText("Create"));

    expect(defaultProps.onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "NewEntity",
        entityType: "class",
        iri: expect.any(String),
      })
    );
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("includes parentIri in onConfirm payload when creating a subclass", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AddEntityDialog
        {...defaultProps}
        parentIri="http://example.org/ontology#Animal"
        parentLabel="Animal"
      />
    );

    const input = screen.getByPlaceholderText("e.g., Privileged Altar");
    await user.type(input, "Dog");
    await user.click(screen.getByText("Create"));

    expect(defaultProps.onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Dog",
        entityType: "class",
        iri: expect.any(String),
        parentIri: "http://example.org/ontology#Animal",
      })
    );
  });

  it("calls onOpenChange(false) on Cancel click", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} />);

    await user.click(screen.getByText("Cancel"));
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("toggles Advanced section and shows IRI field", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} />);

    expect(screen.queryByLabelText("IRI")).toBeNull();
    await user.click(screen.getByText("Advanced"));
    expect(screen.getByLabelText("IRI")).toBeDefined();
    expect(screen.getByText("Auto-generated UUID-based IRI")).toBeDefined();
  });

  it("shows numeric pattern description in Advanced", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} iriPattern="numeric" nextNumeric={42} />);

    await user.click(screen.getByText("Advanced"));
    expect(screen.getByText("Sequential numeric IRI (next: 42)")).toBeDefined();
  });

  it("shows named pattern description in Advanced", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} iriPattern="named" />);

    await user.click(screen.getByText("Advanced"));
    expect(screen.getByText("Derived from label")).toBeDefined();
  });

  it("allows changing entity type", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} />);

    const select = screen.getByLabelText("Type");
    await user.selectOptions(select, "objectProperty");
    expect((select as HTMLSelectElement).value).toBe("objectProperty");
  });

  it("does not submit when label is empty (prevents empty submit)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText("e.g., Privileged Altar");
    await user.type(input, "{Enter}");

    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });

  it("submits on Enter key with label filled", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} />);

    const input = screen.getByPlaceholderText("e.g., Privileged Altar");
    await user.type(input, "SomeEntity{Enter}");

    expect(defaultProps.onConfirm).toHaveBeenCalled();
  });

  it("allows manual IRI editing in Advanced", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} />);

    await user.click(screen.getByText("Advanced"));
    const iriInput = screen.getByLabelText("IRI");
    await user.clear(iriInput);
    await user.type(iriInput, "http://custom.iri/Foo");

    expect((iriInput as HTMLInputElement).value).toBe("http://custom.iri/Foo");
  });

  it("generates named IRI from label when iriPattern is named", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddEntityDialog {...defaultProps} iriPattern="named" />);

    await user.click(screen.getByText("Advanced"));
    const labelInput = screen.getByPlaceholderText("e.g., Privileged Altar");
    await user.type(labelInput, "Red Blood Cell");

    const iriInput = screen.getByLabelText("IRI");
    expect((iriInput as HTMLInputElement).value).toBe(
      "http://example.org/ontology#RedBloodCell"
    );
  });

  describe("while the dialog stays open", () => {
    const labelInput = () => screen.getByPlaceholderText("e.g., Privileged Altar") as HTMLInputElement;
    const iriInput = () => screen.getByLabelText("IRI") as HTMLInputElement;
    const typeSelect = () => screen.getByLabelText("Type") as HTMLSelectElement;

    it("keeps the typed label when nextNumeric changes, and follows it in the untouched IRI", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(
        <AddEntityDialog {...defaultProps} iriPattern="numeric" nextNumeric={5} />
      );
      await user.click(screen.getByText("Advanced"));
      await user.type(labelInput(), "Half typed");
      expect(iriInput().value).toBe("http://example.org/ontology#5");

      rerender(<AddEntityDialog {...defaultProps} iriPattern="numeric" nextNumeric={6} />);

      expect(labelInput().value).toBe("Half typed");
      expect(iriInput().value).toBe("http://example.org/ontology#6");
    });

    it("keeps a hand-edited IRI when nextNumeric changes", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(
        <AddEntityDialog {...defaultProps} iriPattern="numeric" nextNumeric={5} />
      );
      await user.click(screen.getByText("Advanced"));
      await user.clear(iriInput());
      await user.type(iriInput(), "http://custom.iri/Mine");

      rerender(<AddEntityDialog {...defaultProps} iriPattern="numeric" nextNumeric={6} />);

      expect(iriInput().value).toBe("http://custom.iri/Mine");
    });

    it("keeps the label and re-derives a named IRI when the namespace is detected late", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(
        <AddEntityDialog {...defaultProps} iriPattern="uuid" ontologyNamespace="http://example.org/ont#" />
      );
      await user.click(screen.getByText("Advanced"));
      await user.type(labelInput(), "Red Cell");

      rerender(
        <AddEntityDialog {...defaultProps} iriPattern="named" ontologyNamespace="http://real.org/onto#" />
      );

      expect(labelInput().value).toBe("Red Cell");
      expect(iriInput().value).toBe("http://real.org/onto#RedCell");
    });

    it("keeps the uuid IRI stable across unrelated prop changes", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<AddEntityDialog {...defaultProps} nextNumeric={1} />);
      await user.click(screen.getByText("Advanced"));
      expect(iriInput().value).toBe("http://example.org/ontology#TestBase62Uuid");

      rerender(<AddEntityDialog {...defaultProps} nextNumeric={2} />);
      expect(iriInput().value).toBe("http://example.org/ontology#TestBase62Uuid");
    });

    it("keeps the label when the parent changes, and only updates an untouched type", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<AddEntityDialog {...defaultProps} />);
      await user.type(labelInput(), "Child");
      expect(typeSelect().value).toBe("class");

      rerender(
        <AddEntityDialog {...defaultProps} parentIri="http://example.org/ontology#Animal" initialType="individual" />
      );
      expect(labelInput().value).toBe("Child");
      expect(typeSelect().value).toBe("individual");
      expect(screen.getByText(/Create a new individual of/)).toBeDefined();

      await user.selectOptions(typeSelect(), "class");
      rerender(
        <AddEntityDialog {...defaultProps} parentIri="http://example.org/ontology#Plant" initialType="individual" />
      );
      expect(labelInput().value).toBe("Child");
      expect(typeSelect().value).toBe("class");
    });

    it("drops a chosen type that the new parent does not allow", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(<AddEntityDialog {...defaultProps} />);
      await user.selectOptions(typeSelect(), "objectProperty");

      rerender(<AddEntityDialog {...defaultProps} parentIri="http://example.org/ontology#Animal" />);
      expect(typeSelect().value).toBe("class");
    });

    it("submits the values on screen after props changed mid-edit", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = render(
        <AddEntityDialog {...defaultProps} iriPattern="numeric" nextNumeric={5} />
      );
      await user.type(labelInput(), "Thing");
      rerender(<AddEntityDialog {...defaultProps} iriPattern="numeric" nextNumeric={7} />);
      await user.click(screen.getByText("Create"));

      expect(defaultProps.onConfirm).toHaveBeenCalledWith({
        iri: "http://example.org/ontology#7",
        label: "Thing",
        entityType: "class",
        parentIri: undefined,
      });
    });
  });

  it("starts with a fresh form each time it is reopened", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = render(<AddEntityDialog {...defaultProps} />);
    await user.type(screen.getByPlaceholderText("e.g., Privileged Altar"), "Leftover");

    rerender(<AddEntityDialog {...defaultProps} open={false} />);
    rerender(<AddEntityDialog {...defaultProps} open />);

    expect((screen.getByPlaceholderText("e.g., Privileged Altar") as HTMLInputElement).value).toBe("");
  });
});
