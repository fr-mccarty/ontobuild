import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { ProjectCard } from "@/components/projects/project-card";
import type { Project } from "@/lib/api/projects";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-123",
    name: "Test Ontology",
    description: "A test project for ontology editing",
    is_public: true,
    owner_id: "user-1",
    created_at: "2024-06-01T12:00:00Z",
    updated_at: "2024-06-15T12:00:00Z",
    member_count: 3,
    ...overrides,
  };
}

describe("ProjectCard", () => {
  it("renders the project name", () => {
    render(<ProjectCard project={makeProject()} />);
    expect(screen.getByText("Test Ontology")).toBeDefined();
  });

  it("renders the project description", () => {
    render(<ProjectCard project={makeProject()} />);
    expect(screen.getByText("A test project for ontology editing")).toBeDefined();
  });

  it("does not render description when absent", () => {
    render(<ProjectCard project={makeProject({ description: undefined })} />);
    expect(screen.queryByText("A test project for ontology editing")).toBeNull();
  });

  it("links to the project editor", () => {
    render(<ProjectCard project={makeProject({ user_role: "owner" })} />);
    const link = screen.getByRole("link", { name: /Open project Test Ontology/ });
    expect(link.getAttribute("href")).toBe("/projects/proj-123");
  });

  it("shows no public or private indicator", () => {
    render(<ProjectCard project={makeProject({ is_public: true })} />);
    expect(screen.queryByTitle("Public project")).toBeNull();
    expect(screen.queryByTitle("Private project")).toBeNull();
  });

  it("does not show role badge when user_role is absent", () => {
    render(<ProjectCard project={makeProject({ user_role: undefined })} />);
    expect(screen.queryByText("Owner")).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.queryByText("Editor")).toBeNull();
    expect(screen.queryByText("Viewer")).toBeNull();
  });

  it("shows Exemplar badge when is_exemplar is true", () => {
    render(<ProjectCard project={makeProject({ is_exemplar: true })} />);
    expect(screen.getByText("Exemplar")).toBeDefined();
  });

  it("does not show Exemplar badge when is_exemplar is false", () => {
    render(<ProjectCard project={makeProject({ is_exemplar: false })} />);
    expect(screen.queryByText("Exemplar")).toBeNull();
  });

  it("shows the updated_at date when present", () => {
    render(<ProjectCard project={makeProject({
      updated_at: "2025-03-20T12:00:00Z",
      created_at: "2024-01-10T12:00:00Z",
    })} />);
    const dateText = screen.getByText(/Updated/).textContent!;
    expect(dateText).toContain("2025");
    expect(dateText).not.toContain("2024");
  });

  it("falls back to created_at when updated_at is absent", () => {
    render(<ProjectCard project={makeProject({
      updated_at: undefined,
      created_at: "2023-11-05T12:00:00Z",
    })} />);
    const dateText = screen.getByText(/Updated/).textContent!;
    expect(dateText).toContain("2023");
  });

  it("merges custom className onto the card", () => {
    render(<ProjectCard project={makeProject()} className="extra-class" />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("extra-class");
  });
});
