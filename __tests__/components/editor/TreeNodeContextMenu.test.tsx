import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

let capturedItems: Array<{
  text: string;
  onSelect?: () => void;
  destructive?: boolean;
}> = [];
let _separatorCount = 0;

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="context-menu-content">{children}</div>
  ),
  ContextMenuItem: ({
    children,
    onSelect,
    destructive,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    destructive?: boolean;
  }) => {
    const text =
      typeof children === "string"
        ? children
        : React.Children.toArray(children)
            .filter((c) => typeof c === "string")
            .join("");
    capturedItems.push({ text, onSelect, destructive });
    return (
      <button
        data-testid={`menu-item-${text.trim()}`}
        data-destructive={destructive ? "true" : undefined}
        onClick={onSelect}
      >
        {children}
      </button>
    );
  },
  ContextMenuSeparator: () => {
    _separatorCount++;
    return <hr data-testid="separator" />;
  },
}));

vi.mock("lucide-react", () => ({
  Plus: () => <span data-testid="icon-plus" />,
  Copy: () => <span data-testid="icon-copy" />,
  Trash2: () => <span data-testid="icon-trash" />,
}));

import { TreeNodeContextMenu } from "@/components/editor/TreeNodeContextMenu";

const baseNode = { iri: "http://example.org/ontology#Person", label: "Person" };

describe("TreeNodeContextMenu", () => {
  beforeEach(() => {
    capturedItems = [];
    _separatorCount = 0;
  });

  describe("with all callbacks provided", () => {
    it("renders all menu items", () => {
      render(
        <TreeNodeContextMenu
          node={baseNode}
          onAddChild={vi.fn()}
          onCopyIri={vi.fn()}
          onDelete={vi.fn()}
        />
      );
      expect(screen.getByTestId("context-menu-content")).not.toBeNull();
      expect(screen.getByTestId("menu-item-Add Subclass")).not.toBeNull();
      expect(screen.getByTestId("menu-item-Copy IRI")).not.toBeNull();
      expect(screen.getByTestId("menu-item-Delete")).not.toBeNull();
    });

    it("renders two separators", () => {
      render(
        <TreeNodeContextMenu
          node={baseNode}
          onAddChild={vi.fn()}
          onCopyIri={vi.fn()}
          onDelete={vi.fn()}
        />
      );
      const seps = screen.getAllByTestId("separator");
      expect(seps).toHaveLength(2);
    });

    it("renders correct icons", () => {
      render(
        <TreeNodeContextMenu
          node={baseNode}
          onAddChild={vi.fn()}
          onCopyIri={vi.fn()}
          onDelete={vi.fn()}
        />
      );
      expect(screen.getByTestId("icon-plus")).not.toBeNull();
      expect(screen.getByTestId("icon-copy")).not.toBeNull();
      expect(screen.getByTestId("icon-trash")).not.toBeNull();
    });
  });

  describe("conditional rendering", () => {
    it("hides Add Subclass when onAddChild is not provided", () => {
      render(
        <TreeNodeContextMenu
          node={baseNode}
          onCopyIri={vi.fn()}
        />
      );
      expect(screen.queryByTestId("menu-item-Add Subclass")).toBeNull();
    });

    it("hides Copy IRI when onCopyIri is not provided", () => {
      render(
        <TreeNodeContextMenu
          node={baseNode}
          onAddChild={vi.fn()}
        />
      );
      expect(screen.queryByTestId("menu-item-Copy IRI")).toBeNull();
    });

    it("hides Delete when onDelete is not provided", () => {
      render(
        <TreeNodeContextMenu
          node={baseNode}
          onAddChild={vi.fn()}
          onCopyIri={vi.fn()}
        />
      );
      expect(screen.queryByTestId("menu-item-Delete")).toBeNull();
    });

    it("renders no items when no callbacks are provided", () => {
      render(<TreeNodeContextMenu node={baseNode} />);
      expect(screen.getByTestId("context-menu-content")).not.toBeNull();
      expect(screen.queryByTestId("menu-item-Add Subclass")).toBeNull();
      expect(screen.queryByTestId("menu-item-Copy IRI")).toBeNull();
      expect(screen.queryByTestId("menu-item-Delete")).toBeNull();
    });

    it("renders no separators when only middle items are provided", () => {
      render(
        <TreeNodeContextMenu
          node={baseNode}
          onCopyIri={vi.fn()}
        />
      );
      expect(screen.queryByTestId("separator")).toBeNull();
    });
  });

  describe("callback invocations", () => {
    it("calls onAddChild with the node IRI", () => {
      const onAddChild = vi.fn();
      render(
        <TreeNodeContextMenu node={baseNode} onAddChild={onAddChild} />
      );
      fireEvent.click(screen.getByTestId("menu-item-Add Subclass"));
      expect(onAddChild).toHaveBeenCalledWith(baseNode.iri);
    });

    it("calls onCopyIri with the node IRI", () => {
      const onCopyIri = vi.fn();
      render(
        <TreeNodeContextMenu node={baseNode} onCopyIri={onCopyIri} />
      );
      fireEvent.click(screen.getByTestId("menu-item-Copy IRI"));
      expect(onCopyIri).toHaveBeenCalledWith(baseNode.iri);
    });

    it("calls onDelete with the node IRI and label", () => {
      const onDelete = vi.fn();
      render(
        <TreeNodeContextMenu node={baseNode} onDelete={onDelete} />
      );
      fireEvent.click(screen.getByTestId("menu-item-Delete"));
      expect(onDelete).toHaveBeenCalledWith(baseNode.iri, "Person");
    });
  });

  describe("label fallback", () => {
    it("uses IRI as label when node.label is empty", () => {
      const onDelete = vi.fn();
      const nodeWithoutLabel = { iri: "http://example.org#Thing", label: "" };
      render(
        <TreeNodeContextMenu node={nodeWithoutLabel} onDelete={onDelete} />
      );
      fireEvent.click(screen.getByTestId("menu-item-Delete"));
      expect(onDelete).toHaveBeenCalledWith(
        "http://example.org#Thing",
        "http://example.org#Thing"
      );
    });
  });

  describe("destructive styling", () => {
    it("marks Delete menu item as destructive", () => {
      render(
        <TreeNodeContextMenu node={baseNode} onDelete={vi.fn()} />
      );
      const deleteItem = screen.getByTestId("menu-item-Delete");
      expect(deleteItem.getAttribute("data-destructive")).toBe("true");
    });

    it("does not mark non-delete items as destructive", () => {
      render(
        <TreeNodeContextMenu
          node={baseNode}
          onAddChild={vi.fn()}
          onCopyIri={vi.fn()}
        />
      );
      const addItem = screen.getByTestId("menu-item-Add Subclass");
      expect(addItem.getAttribute("data-destructive")).toBeNull();
      const copyItem = screen.getByTestId("menu-item-Copy IRI");
      expect(copyItem.getAttribute("data-destructive")).toBeNull();
    });
  });
});
