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

describe("Header", () => {
  beforeEach(() => {
    mockPathname = "/";
  });

  it("renders the OntoBuild brand link", () => {
    render(<Header />);
    expect(screen.getByText("OntoBuild")).toBeDefined();
    const brandLink = screen.getByText("OntoBuild").closest("a");
    expect(brandLink?.getAttribute("href")).toBe("/");
  });

  it("renders all navigation links", () => {
    render(<Header />);
    const links = [
      { label: "Projects", href: "/" },
      { label: "Documentation", href: "/docs" },
      { label: "API Reference", href: "/api-docs" },
    ];
    for (const { label, href } of links) {
      const link = screen.getByText(label).closest("a");
      expect(link?.getAttribute("href")).toBe(href);
    }
  });

  it("renders the Settings link and leaves the theme to the settings page", () => {
    render(<Header />);
    expect(screen.getByLabelText("User settings").getAttribute("href")).toBe("/settings");
    expect(screen.queryByRole("group", { name: "Theme" })).toBeNull();
  });

  it("highlights the Projects link when on /", () => {
    mockPathname = "/";
    render(<Header />);
    const projectsLink = screen.getByText("Projects");
    expect(projectsLink.className).toContain("bg-blue-100");
  });

  it("highlights Documentation link when pathname starts with /docs", () => {
    mockPathname = "/docs/getting-started";
    render(<Header />);
    const docsLink = screen.getByText("Documentation");
    expect(docsLink.className).toContain("bg-blue-100");
  });

  it("has no Info link", () => {
    render(<Header />);
    expect(screen.queryByText("Info")).toBeNull();
  });

  it("does not highlight Projects link on non-root paths", () => {
    mockPathname = "/docs";
    render(<Header />);
    const projectsLink = screen.getByText("Projects");
    expect(projectsLink.className).not.toContain("bg-blue-100");
  });
});
