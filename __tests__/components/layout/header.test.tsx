import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";
import { Header } from "@/components/layout/header";

const render = (ui: ReactElement) => rtlRender(<TooltipPrimitive.Provider>{ui}</TooltipPrimitive.Provider>);

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@/components/editor/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

describe("Header", () => {
  beforeEach(() => {
    mockPathname = "/";
  });

  it("renders the OntoKit brand link", () => {
    render(<Header />);
    expect(screen.getByText("OntoKit")).toBeDefined();
    const brandLink = screen.getByText("OntoKit").closest("a");
    expect(brandLink?.getAttribute("href")).toBe("/");
  });

  it("renders all navigation links", () => {
    render(<Header />);
    const links = [
      { label: "Projects", href: "/" },
      { label: "Info", href: "/info" },
      { label: "Documentation", href: "/docs" },
      { label: "API Reference", href: "/api-docs" },
    ];
    for (const { label, href } of links) {
      const link = screen.getByText(label).closest("a");
      expect(link?.getAttribute("href")).toBe(href);
    }
  });

  it("renders Settings link and ThemeToggle", () => {
    render(<Header />);
    expect(screen.getByLabelText("User settings").getAttribute("href")).toBe("/settings");
    expect(screen.getByTestId("theme-toggle")).toBeDefined();
  });

  it("highlights the Projects link when on /", () => {
    mockPathname = "/";
    render(<Header />);
    const projectsLink = screen.getByText("Projects");
    expect(projectsLink.className).toContain("bg-blue-100");
  });

  it("highlights Info link when pathname starts with /info", () => {
    mockPathname = "/info/about";
    render(<Header />);
    const infoLink = screen.getByText("Info");
    expect(infoLink.className).toContain("bg-blue-100");
  });

  it("does not highlight Projects link on non-root paths", () => {
    mockPathname = "/info";
    render(<Header />);
    const projectsLink = screen.getByText("Projects");
    expect(projectsLink.className).not.toContain("bg-blue-100");
  });
});
