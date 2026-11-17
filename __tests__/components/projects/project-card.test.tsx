import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient as render } from "@/__tests__/helpers/renderWithProviders";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/api/imports", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, importsApi: { list: vi.fn() } };
});

import { importsApi, type ImportStatus } from "@/lib/api/imports";
import { ProjectCard } from "@/components/projects/project-card";
import type { Project } from "@/lib/api/projects";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-123",
    name: "Test Ontology",
    description: "A test project for ontology editing",
    is_public: true,
    created_at: "2024-06-01T12:00:00Z",
    updated_at: "2024-06-15T12:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(importsApi.list).mockResolvedValue({ direct: [], closure: [] });
});

function imp(overrides: Partial<ImportStatus>): ImportStatus {
  return { iri: "http://x.org/a", source: "project", status: "ok", class_count: 1, direct: true, imported_by: [], label: null, ...overrides };
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
    render(<ProjectCard project={makeProject()} />);
    const link = screen.getByRole("link", { name: /Open project Test Ontology/ });
    expect(link.getAttribute("href")).toBe("/projects/proj-123");
  });

  it("shows no public or private indicator", () => {
    render(<ProjectCard project={makeProject({ is_public: true })} />);
    expect(screen.queryByTitle("Public project")).toBeNull();
    expect(screen.queryByTitle("Private project")).toBeNull();
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

  it("lists the ontologies the project imports directly, between description and date", async () => {
    vi.mocked(importsApi.list).mockResolvedValue({
      direct: ["http://x.org/food", "http://w3id.org/remote"],
      closure: [
        imp({ iri: "http://x.org/food", project_id: "p2", project_name: "Food" }),
        imp({ iri: "http://w3id.org/remote", source: "remote", label: "Remote Onto" }),
        imp({ iri: "http://x.org/deep", direct: false, project_name: "Deep" }),
      ],
    });
    render(<ProjectCard project={makeProject()} />);
    const list = await screen.findByRole("list", { name: "Imported ontologies" });
    expect([...list.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Food", "Remote Onto"]);
    expect(screen.queryByText("Deep")).toBeNull();
    expect(importsApi.list).toHaveBeenCalledWith("proj-123", undefined);
    const block = screen.getByTestId("project-card-imports");
    const description = screen.getByText("A test project for ontology editing");
    const updated = screen.getByText(/Updated/);
    expect(description.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(updated) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no imports section when the project imports nothing", async () => {
    render(<ProjectCard project={makeProject()} />);
    await screen.findByText(/Updated/);
    expect(screen.queryByTestId("project-card-imports")).toBeNull();
  });
});
