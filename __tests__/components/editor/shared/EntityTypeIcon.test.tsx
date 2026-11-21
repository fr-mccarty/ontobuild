import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  EntityTypeIcon,
  EntityTypeTooltipContent,
} from "@/components/editor/shared/EntityTypeIcon";

describe("EntityTypeIcon", () => {
  it.each([
    ["class", "Class"],
    ["property", "Property"],
    ["individual", "Individual"],
  ])("labels the %s marker as %s", (type, label) => {
    render(<EntityTypeIcon type={type} />);
    expect(screen.getByTestId(`${type}-icon`).getAttribute("aria-label")).toBe(label);
  });

  it("falls back to the Other marker for an unknown type", () => {
    render(<EntityTypeIcon type="axiom" />);
    expect(screen.getByTestId("other-icon").getAttribute("aria-label")).toBe("Other");
  });

  it("renders without a tooltip wrapper when tooltip is false", () => {
    const { container } = render(<EntityTypeIcon type="class" tooltip={false} />);
    expect(container.firstElementChild?.tagName.toLowerCase()).toBe("svg");
  });
});

describe("EntityTypeTooltipContent", () => {
  it("names the entity type and its meaning", () => {
    render(<EntityTypeTooltipContent type="individual" />);
    expect(screen.getByText("Individual")).toBeDefined();
    expect(screen.getByText("A specific instance of a class")).toBeDefined();
  });

  it("shows the IRI under the type when given", () => {
    render(<EntityTypeTooltipContent type="class" iri="https://example.org/onto#Audience" />);
    expect(screen.getByText("Class")).toBeDefined();
    expect(screen.getByText("https://example.org/onto#Audience")).toBeDefined();
  });
});
