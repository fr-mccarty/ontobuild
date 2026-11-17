import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OntologyFileList, Project } from "@/lib/api/projects";

// Project settings: the Ontology File section (and its entry in the contents).

const PROJECT_ID = "proj-1";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: PROJECT_ID }),
  useSearchParams: () => new URLSearchParams("branch=develop"),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => `/projects/${PROJECT_ID}/settings`,
}));
vi.mock("@/components/layout/header", () => ({ Header: () => <header /> }));
vi.mock("@/lib/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/components/project/ImportsManager", () => ({ ImportsManager: () => <div /> }));
vi.mock("@/components/project/GitHub", () => ({ GitHubMark: () => <svg />, GitHubPanel: () => <div /> }));
vi.mock("@/lib/api/indexStatus", () => ({
  IndexStatusPoller: class {
    connect() {}
    disconnect() {}
  },
}));
vi.mock("@/lib/hooks/useNormalizationStatus", () => ({
  normalizationQueryKeys: { status: (id: string) => ["normalization", id] },
  useNormalizationStatus: () => ({ data: null }),
}));
vi.mock("@/lib/hooks/useIndexStatus", () => ({
  indexQueryKeys: { status: (id: string) => ["index", id] },
  useIndexStatus: () => ({ data: null }),
}));
vi.mock("@/lib/api/pullRequests", () => ({
  prSettingsApi: { get: vi.fn().mockResolvedValue({ pr_approval_required: 0 }), update: vi.fn() },
}));
vi.mock("@/lib/api/lint", () => ({
  lintApi: {
    getRules: vi.fn().mockResolvedValue({ rules: [] }),
    getLevels: vi.fn().mockResolvedValue({ levels: [] }),
    getLintConfig: vi.fn().mockResolvedValue({ lint_level: null, enabled_rules: null, effective_rules: [] }),
    getStatus: vi.fn().mockResolvedValue({ last_run: null, total_issues: 0, error_count: 0, warning_count: 0, info_count: 0 }),
  },
}));

let mockProject: Partial<Project>;
vi.mock("@/lib/hooks/useProject", () => ({
  projectQueryKeys: { detail: (id: string) => ["project", id] },
  useProject: () => ({ project: mockProject, isLoading: false, error: null }),
}));

const api = vi.hoisted(() => ({
  listOntologyFiles: vi.fn(),
  switchOntologyFile: vi.fn(),
  createOntologyFile: vi.fn(),
}));
vi.mock("@/lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/projects")>();
  return { ...actual, projectApi: { ...actual.projectApi, ...api } };
});

import ProjectSettingsPage from "@/app/projects/[id]/settings/page";

const LIST: OntologyFileList = {
  project_id: PROJECT_ID,
  branch: "develop",
  active_path: "src/onto.ttl",
  active_exists: true,
  suggested_file_name: "ontology.ttl",
  files: [
    { path: "src/onto.ttl", format: "turtle", size_bytes: 10, declares_ontology: true, active: true, turtle_path: null, turtle_exists: false },
    { path: "other.ttl", format: "turtle", size_bytes: 10, declares_ontology: true, active: false, turtle_path: null, turtle_exists: false },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipPrimitive.Provider delayDuration={0}>
        <ProjectSettingsPage />
      </TooltipPrimitive.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProject = {
    id: PROJECT_ID,
    name: "Onto",
    is_public: false,
    created_at: "2026-01-01T00:00:00Z",
    source_file_path: `projects/${PROJECT_ID}/src/onto.ttl`,
    git_ontology_path: "src/onto.ttl",
    label_preferences: [],
  };
  api.listOntologyFiles.mockResolvedValue(LIST);
});

describe("Project settings: Ontology File", () => {
  it("lists the section in the contents after General", () => {
    renderPage();
    const toc = screen.getByRole("navigation", { name: "Settings sections" });
    const labels = within(toc).getAllByRole("link").map((a) => a.textContent?.trim());
    expect(labels.slice(0, 2)).toEqual(["General", "Ontology File"]);
    expect(within(toc).getByRole("link", { name: /Ontology File/ }).getAttribute("href")).toBe("#ontology-file");
  });

  it("shows the active file and switches or creates on the editor's branch", async () => {
    renderPage();
    const section = document.getElementById("ontology-file")!;
    expect(within(section).getByTestId("settings-active-ontology-file").textContent).toBe("src/onto.ttl");
    expect(section.textContent).toContain("branch develop");
    expect(section.textContent).toMatch(/committed on branch develop/);
    fireEvent.click(await within(section).findByRole("button", { name: "Use other.ttl" }));
    await waitFor(() => expect(api.switchOntologyFile).toHaveBeenCalledWith(PROJECT_ID, "other.ttl", "develop"));
    expect(api.listOntologyFiles).toHaveBeenCalledWith(PROJECT_ID, "develop");

    fireEvent.click(within(section).getByRole("button", { name: /New ontology/ }));
    const dialog = await screen.findByTestId("new-ontology-dialog");
    expect(within(dialog).getByTestId("new-ontology-replace-warning").textContent).toContain("src/onto.ttl");
  });

  it("says when the project has no ontology file, and flags the section", async () => {
    mockProject = { ...mockProject, source_file_path: undefined, git_ontology_path: undefined };
    api.listOntologyFiles.mockResolvedValue({ ...LIST, active_path: null, files: [] });
    renderPage();
    const section = document.getElementById("ontology-file")!;
    expect(section.textContent).toContain("It has none yet.");
    expect(within(section).queryByTestId("settings-active-ontology-file")).toBeNull();
    fireEvent.click(await within(section).findByRole("button", { name: /New ontology/ }));
    const dialog = await screen.findByTestId("new-ontology-dialog");
    expect(within(dialog).queryByTestId("new-ontology-replace-warning")).toBeNull();
  });
});
