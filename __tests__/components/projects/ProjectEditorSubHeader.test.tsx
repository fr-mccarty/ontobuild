import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AgentHealthSummary } from "@/lib/agent/healthSummary";

// The project editor page's sub header (the bar under the main header): every
// control in it should explain itself in a tooltip on hover or keyboard focus.

const PROJECT_ID = "proj-1";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: PROJECT_ID }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => `/projects/${PROJECT_ID}`,
}));

vi.mock("@/lib/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/components/layout/header", () => ({ Header: () => <header /> }));
vi.mock("@/components/editor/standard/StandardEditorLayout", () => ({
  StandardEditorLayout: ({
    treePanelOpen,
    entityCounts,
    showGraph,
  }: {
    treePanelOpen?: boolean;
    entityCounts?: unknown;
    showGraph?: boolean;
  }) => (
    <div
      data-testid="editor-layout"
      data-tree-open={String(treePanelOpen)}
      data-entity-counts={JSON.stringify(entityCounts)}
      data-show-graph={String(showGraph)}
    />
  ),
}));

let mockHealthSummary: AgentHealthSummary | null;
vi.mock("@/lib/hooks/useHealthSummary", () => ({
  healthQueryKeys: { all: ["health"] },
  useHealthSummary: () => ({ data: mockHealthSummary }),
}));

let mockEntityCounts: { properties: number; individuals: number } | undefined;
vi.mock("@/lib/hooks/useEntityCounts", () => ({
  useEntityCounts: () => ({ data: mockEntityCounts }),
}));
vi.mock("@/components/editor/agent/AgentPanel", () => ({ AgentPanel: () => <div /> }));
vi.mock("@/components/editor/HealthCheckPanel", () => ({ HealthCheckPanel: () => <div /> }));
vi.mock("@/components/editor/AddEntityDialog", () => ({ AddEntityDialog: () => null }));
vi.mock("@/components/editor/DeleteImpactAnalysis", () => ({ DeleteImpactAnalysis: () => null }));
vi.mock("@/components/editor/RightSidebar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/editor/RightSidebar")>()),
  RightSidebar: () => <aside data-testid="right-sidebar" />,
}));
vi.mock("@/components/revision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/revision")>()),
  RevisionHistoryPanel: () => null,
}));

let mockBranchState: Record<string, unknown>;
vi.mock("@/lib/context/BranchContext", () => ({
  BranchProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useBranch: () => mockBranchState,
  branchQueryKeys: { list: (...args: unknown[]) => ["branches", ...args] },
}));

const ontologyFilesApi = vi.hoisted(() => ({
  listOntologyFiles: vi.fn(),
  switchOntologyFile: vi.fn(),
  createOntologyFile: vi.fn(),
}));
vi.mock("@/lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/projects")>();
  return { ...actual, projectApi: { ...actual.projectApi, ...ontologyFilesApi } };
});

let mockViewer: Record<string, unknown>;
vi.mock("@/lib/hooks/useProjectViewer", () => ({
  useProjectViewer: () => mockViewer,
}));

function makeViewer(overrides: Record<string, unknown> = {}) {
  const fns = new Map<PropertyKey, unknown>();
  const base: Record<string, unknown> = {
    project: { id: PROJECT_ID, name: "Newman Center", description: "Campus ministry ontology" },
    isLoading: false,
    error: null,
    openPRCount: 2,
    lintSummary: { total_issues: 3, error_count: 1, warning_count: 2, info_count: 0 },
    normalizationStatus: { needs_normalization: true },
    hasOntology: true,
    nodes: [],
    totalClasses: 14,
    isTreeLoading: false,
    treeError: null,
    selectedIri: null,
    hasExpandableNodes: false,
    hasExpandedNodes: false,
    isExpandingAll: false,
    selectedNodeFallback: null,
    sourceContent: "",
    sourceIriIndex: new Map(),
    ...overrides,
  };
  // Anything the page reads that this test doesn't set up is a stable no-op function.
  return new Proxy(base, {
    get(target, key) {
      if (key in target) return target[key as string];
      if (!fns.has(key)) fns.set(key, vi.fn());
      return fns.get(key);
    },
  });
}

import ProjectEditorPage from "@/app/projects/[id]/page";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipPrimitive.Provider delayDuration={0}>
        <ProjectEditorPage />
      </TooltipPrimitive.Provider>
    </QueryClientProvider>,
  );
}

/** Focus an element and return the text of the tooltip that opens for it. */
async function tooltipFor(el: Element): Promise<string> {
  fireEvent.focus(el);
  const tooltip = await screen.findByRole("tooltip");
  const text = tooltip.textContent ?? "";
  fireEvent.blur(el);
  return text;
}

function subHeader(): HTMLElement {
  return screen.getByRole("heading", { level: 1, name: "Newman Center" }).closest("main")!.firstElementChild as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  ontologyFilesApi.listOntologyFiles.mockResolvedValue({
    project_id: PROJECT_ID,
    branch: "main",
    active_path: "src/newman.ttl",
    active_exists: true,
    suggested_file_name: "ontology.ttl",
    files: [
      { path: "src/newman.ttl", format: "turtle", size_bytes: 10, declares_ontology: true, active: true, turtle_path: null, turtle_exists: false },
      { path: "legacy/newman.owl", format: "rdfxml", size_bytes: 20, declares_ontology: true, active: false, turtle_path: "legacy/newman.ttl", turtle_exists: false },
    ],
  });
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mockViewer = makeViewer();
  mockHealthSummary = null;
  mockEntityCounts = { properties: 5, individuals: 7 };
  mockBranchState = {
    branches: [
      {
        name: "main",
        is_default: true,
        commit_hash: "a47aeb0123456",
        commits_ahead: 0,
        commits_behind: 0,
        can_delete: false,
        has_open_pr: false,
        has_delete_permission: false,
      },
    ],
    currentBranch: "main",
    defaultBranch: "main",
    isLoading: false,
    isFeatureBranch: false,
    switchBranch: vi.fn(),
    createBranch: vi.fn(),
    deleteBranch: vi.fn(),
  };
});

describe("Project editor sub header tooltips", () => {
  it("shows a Projects › name breadcrumb in place of the Back link and class count", async () => {
    renderPage();
    const bar = subHeader();
    expect(within(bar).queryByRole("link", { name: "Back" })).toBeNull();
    const crumbs = within(bar).getByRole("navigation", { name: "Breadcrumb" });
    const projects = within(crumbs).getByRole("link", { name: "Projects" });
    expect(projects.getAttribute("href")).toBe("/");
    expect(await tooltipFor(projects)).toBe("Projects: return to the list of all projects");
    const heading = within(crumbs).getByRole("heading", { level: 1 });
    expect(heading.getAttribute("aria-current")).toBe("page");
    expect(await tooltipFor(heading)).toBe("Project: Newman Center. Campus ministry ontology");
    // The class count moved to the entity tree's tabs.
    expect(within(bar).queryByText(/\bclasses\b/)).toBeNull();
  });

  it("explains the Repository button with the current branch, commit and GitHub link", async () => {
    renderPage();
    const button = within(subHeader()).getByRole("button", { name: "Repository" });
    expect(await tooltipFor(button)).toBe(
      "Repository: on branch main at commit a47aeb0. GitHub: link this project to a repository. 2 open pull requests. Click to switch branches, view history and pull requests, or push and pull.",
    );
  });

  it("explains More, shortcuts, settings and the panel toggles", async () => {
    renderPage();
    const bar = subHeader();
    // Share was removed: its links only opened on this machine, and pull requests moved to Repository.
    expect(within(bar).queryByRole("button", { name: /^Share/ })).toBeNull();
    expect(await tooltipFor(within(bar).getByRole("button", { name: "More" }))).toBe(
      "More: relationship graph, keyboard shortcuts and other editor controls",
    );
    // Imports, Normalize and the project dashboard moved into project settings.
    expect(within(bar).queryByRole("link", { name: "Normalize ontology" })).toBeNull();
    expect(within(bar).queryByRole("link", { name: "Project dashboard" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: /^Imports/ })).toBeNull();
    // Keyboard shortcuts live in the More menu only.
    expect(within(bar).queryByRole("button", { name: "Keyboard shortcuts" })).toBeNull();
    // Normalization is recommended in this fixture, so the settings button says so and shows a dot.
    expect(await tooltipFor(within(bar).getByRole("link", { name: "Project settings" }))).toBe(
      "Project settings: project details, imports, GitHub, normalization, lint rules and pull requests. Normalization recommended: the ontology file isn't in canonical Turtle format",
    );
    expect(within(bar).getByTestId("settings-normalize-dot")).toBeDefined();
    expect(await tooltipFor(within(bar).getByRole("button", { name: "Side panel" }))).toBe(
      "Hide the side panel (shortcut: Esc)",
    );
    expect(await tooltipFor(within(bar).getByRole("button", { name: "Entity tree" }))).toBe(
      "Hide the entity tree: the classes, properties and individuals list",
    );
  });

  it("describes the toggles as 'show' once the panels are closed", async () => {
    renderPage();
    const bar = subHeader();
    fireEvent.click(within(bar).getByRole("button", { name: "Side panel" }));
    fireEvent.click(within(bar).getByRole("button", { name: "Entity tree" }));
    // Until the health summary loads, the count comes from the lint summary.
    expect(await tooltipFor(within(bar).getByRole("button", { name: "Side panel (3 health issues)" }))).toBe(
      "Show the side panel: Agent, Health, Files and Tools (3 health issues)",
    );
    expect(await tooltipFor(within(bar).getByRole("button", { name: "Entity tree" }))).toBe(
      "Show the entity tree: browse classes, properties and individuals",
    );
  });

  it("uses tooltips rather than native title attributes", () => {
    renderPage();
    expect(subHeader().querySelectorAll("[title]")).toHaveLength(0);
  });
});

describe("Project editor sub header on one line", () => {
  it("never wraps and lets the project name truncate", () => {
    renderPage();
    const bar = screen.getByTestId("editor-sub-header");
    expect(bar.className).toContain("flex-nowrap");
    expect(bar.className).not.toContain("flex-wrap ");
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("truncate");
  });

  it("hides inline controls below their breakpoints (display:none, so no extra tab stops)", () => {
    renderPage();
    const bar = subHeader();
    const cls = (el: Element) => el.className.split(/\s+/);
    // The Repository button shows at every width (its branch name hides below sm).
    expect(cls(within(bar).getByRole("button", { name: "Repository" }))).not.toContain("hidden");
    expect(cls(within(bar).getByRole("link", { name: "Project settings" }))).toEqual(
      expect.arrayContaining(["hidden", "sm:inline-flex"]),
    );
  });
});

describe("More menu", () => {
  const openMenu = () => {
    fireEvent.click(within(subHeader()).getByRole("button", { name: "More" }));
    return screen.getByRole("menu");
  };
  const cls = (el: Element) => el.className.split(/\s+/);

  it("shows at every width with a vertical ⋮ icon, holding the graph, shortcuts and (below sm) settings", () => {
    renderPage();
    const more = within(subHeader()).getByRole("button", { name: "More" });
    expect(cls(more.closest("div.relative")!).filter((c) => c === "hidden" || c.endsWith(":hidden"))).toEqual([]);
    expect(more.querySelector("svg")!.getAttribute("class")).toContain("lucide-ellipsis-vertical");
    const menu = openMenu();
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toBe(within(menu).getByRole("menuitem", { name: "Keyboard shortcuts" }));
    expect(items[0].getAttribute("aria-keyshortcuts")).toBe("?");
    expect(items[1]).toBe(within(menu).getByRole("menuitem", { name: "Relationship graph" }));
    expect(items[2]).toBe(within(menu).getByRole("menuitem", { name: /Project settings/ }));
    // Settings is inline from sm up, so its menu item hides there.
    expect(cls(within(menu).getByRole("menuitem", { name: /Project settings/ }))).toContain("sm:hidden");
  });

  it("disables the relationship graph until a class is selected", () => {
    renderPage();
    const item = within(openMenu()).getByRole("menuitem", { name: "Relationship graph" });
    expect((item as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("editor-layout").getAttribute("data-show-graph")).toBe("false");
  });

  it("opens the selected class's relationship graph in the centre panel and closes the menu", () => {
    mockViewer = makeViewer({ selectedIri: "http://example.org/Event" });
    renderPage();
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "Relationship graph" }));
    expect(screen.getByTestId("editor-layout").getAttribute("data-show-graph")).toBe("true");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("links settings on the editor's branch, at the Normalization card when it's recommended", () => {
    renderPage();
    const item = within(openMenu()).getByRole("menuitem", { name: /Project settings/ });
    expect(item.getAttribute("href")).toBe(`/projects/${PROJECT_ID}/settings?branch=main#normalization`);
    expect(within(item).getByRole("img", { name: "normalization recommended" })).toBeDefined();
  });

  it("drops the normalization dot and anchor when it doesn't apply", () => {
    mockViewer = makeViewer({ normalizationStatus: { needs_normalization: false } });
    renderPage();
    expect(within(subHeader()).queryByTestId("settings-normalize-dot")).toBeNull();
    const item = within(openMenu()).getByRole("menuitem", { name: /Project settings/ });
    expect(item.getAttribute("href")).toBe(`/projects/${PROJECT_ID}/settings?branch=main`);
    expect(within(item).queryByRole("img")).toBeNull();
  });

  it("opens the keyboard shortcuts dialog", async () => {
    renderPage();
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "Keyboard shortcuts" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(await screen.findByRole("dialog")).toBeDefined();
  });
});

describe("Side panel toggle", () => {
  const agentButton = () => within(subHeader()).getByRole("button", { name: /^Side panel/ });
  const health = (over: Partial<AgentHealthSummary> = {}): AgentHealthSummary => ({
    lint: { errors: 0, warnings: 0, info: 0, total: 0, checkedAt: "now", running: false },
    consistency: { count: 0, checkedAt: "now" },
    duplicates: { count: 0, checkedAt: "now" },
    ...over,
  });
  const lint = (errors: number, warnings: number, info: number) => ({
    errors, warnings, info, total: errors + warnings + info, checkedAt: "now", running: false,
  });
  const dot = () => within(subHeader()).queryByTestId("right-sidebar-lint-dot");
  const closePanel = () => fireEvent.click(agentButton());

  it("mirrors the entity tree toggle: an icon-only panel button with no text label", () => {
    renderPage();
    const tree = within(subHeader()).getByRole("button", { name: "Entity tree" });
    expect(agentButton().textContent).toBe("");
    expect(agentButton().getAttribute("aria-pressed")).toBe("true");
    for (const cls of ["-my-1", "flex-shrink-0"]) {
      expect(agentButton().className.split(/\s+/)).toContain(cls);
      expect(tree.className.split(/\s+/)).toContain(cls);
    }
    expect(agentButton().querySelector("svg.lucide-panel-right-close")).not.toBeNull();
    closePanel();
    expect(agentButton().getAttribute("aria-pressed")).toBe("false");
    expect(agentButton().querySelector("svg.lucide-panel-right-open")).not.toBeNull();
  });

  it("sits at the far right, after Repository, Project settings and More", () => {
    renderPage();
    const bar = subHeader();
    const order = [
      within(bar).getByRole("button", { name: "Entity tree" }),
      within(bar).getByRole("button", { name: "Repository" }),
      within(bar).getByRole("link", { name: "Project settings" }),
      within(bar).getByRole("button", { name: "More" }),
      agentButton(),
    ];
    const buttons = within(bar).getAllByRole("button");
    expect(buttons[0]).toBe(order[0]);
    expect(buttons[buttons.length - 1]).toBe(agentButton());
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("counts every health issue and colours the dot by the worst one", () => {
    mockHealthSummary = health({ lint: lint(0, 0, 2), consistency: { count: 1, checkedAt: "now" }, duplicates: { count: 3, checkedAt: "now" } });
    renderPage();
    closePanel();
    expect(agentButton().getAttribute("aria-label")).toBe("Side panel (6 health issues)");
    expect(dot()!.className).toContain("bg-amber-500");
  });

  it("shows a red dot for lint errors", () => {
    mockHealthSummary = health({ lint: lint(1, 2, 0) });
    renderPage();
    closePanel();
    expect(dot()!.className).toContain("bg-red-500");
  });

  it("shows a blue dot when there's only lint info", () => {
    mockHealthSummary = health({ lint: lint(0, 0, 1) });
    renderPage();
    closePanel();
    expect(dot()!.className).toContain("bg-blue-500");
  });

  it("falls back to the lint summary until the health summary loads", () => {
    renderPage();
    closePanel();
    // The fixture's lint summary has an error.
    expect(dot()!.className).toContain("bg-red-500");
  });

  it("has no dot or count when the Health tab is clean, nor while the panel is open", () => {
    mockHealthSummary = health();
    renderPage();
    expect(dot()).toBeNull();
    closePanel();
    expect(dot()).toBeNull();
    expect(agentButton().getAttribute("aria-label")).toBe("Side panel");
  });
});

describe("Entity counts", () => {
  const counts = () => JSON.parse(screen.getByTestId("editor-layout").getAttribute("data-entity-counts")!);

  it("passes the class, property and individual counts to the entity tree's tabs", () => {
    renderPage();
    expect(counts()).toEqual({ classes: 14, properties: 5, individuals: 7 });
  });

  it("omits counts that haven't loaded", () => {
    mockEntityCounts = undefined;
    mockViewer = makeViewer({ isTreeLoading: true });
    renderPage();
    expect(counts()).toEqual({});
  });
});

describe("Repository popover", () => {
  const openPopover = () => {
    fireEvent.click(within(subHeader()).getByRole("button", { name: "Repository" }));
    return screen.getByRole("dialog", { name: "Repository" });
  };

  it("replaces the separate GitHub, branch and History buttons", () => {
    renderPage();
    const bar = subHeader();
    expect(within(bar).queryByRole("button", { name: "History" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: /^GitHub/ })).toBeNull();
    expect(within(bar).getByTestId("repository-branch").textContent).toBe("main");
  });

  it("writes the branch to the URL in place, and not again once it is there", () => {
    // Regression: a router.replace() on every mount fell back to a full reload, which
    // remounted the page and reloaded it again about once a second.
    window.history.replaceState(null, "", `/projects/${PROJECT_ID}`);
    const replaceState = vi.spyOn(window.history, "replaceState");
    const { unmount } = renderPage();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?branch=main");
    unmount();
    replaceState.mockClear();
    renderPage();
    expect(replaceState).not.toHaveBeenCalled();
    replaceState.mockRestore();
    window.history.replaceState(null, "", "/");
  });

  it("groups the branch, history and GitHub sections", () => {
    renderPage();
    const popover = openPopover();
    expect(within(popover).getByRole("region", { name: "Branch" })).toBeDefined();
    expect(within(popover).getByRole("region", { name: "History" })).toBeDefined();
    expect(within(popover).getByRole("region", { name: "GitHub" })).toBeDefined();
    expect(within(popover).getByRole("option", { name: /main/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("toggles the history panel and closes the popover", () => {
    renderPage();
    const item = within(openPopover()).getByRole("button", { name: "Revision history" });
    expect(item.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(item);
    expect(screen.queryByRole("dialog", { name: "Repository" })).toBeNull();
    expect(within(openPopover()).getByRole("button", { name: "Hide revision history" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches branch from the popover", () => {
    mockBranchState = {
      ...mockBranchState,
      branches: [
        ...(mockBranchState.branches as unknown[]),
        { name: "feature/x", is_default: false, commit_hash: "bbbbbbb1234", commits_ahead: 1, commits_behind: 0, can_delete: true, has_open_pr: false, has_delete_permission: true },
      ],
    };
    renderPage();
    fireEvent.click(within(openPopover()).getByRole("option", { name: /feature\/x/ }));
    expect(mockBranchState.switchBranch).toHaveBeenCalledWith("feature/x");
  });

  it("closes with Esc without closing the agent panel", () => {
    renderPage();
    const popover = openPopover();
    fireEvent.keyDown(within(popover).getByRole("button", { name: "Revision history" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Repository" })).toBeNull();
    expect(screen.queryByTestId("right-sidebar")).not.toBeNull();
  });
});

describe("Project editor sidebars", () => {
  const treeOpen = () => screen.getByTestId("editor-layout").getAttribute("data-tree-open");
  const rightOpen = () => screen.queryByTestId("right-sidebar") !== null;
  const treeToggle = () => within(subHeader()).getByRole("button", { name: "Entity tree" });
  const rightToggle = () => within(subHeader()).getByRole("button", { name: /^Side panel/ });

  let setNarrow: (narrow: boolean) => void;
  beforeEach(() => {
    let narrow = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return query === "(max-width: 1023.98px)" && narrow;
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }));
    setNarrow = (next) => {
      narrow = next;
      act(() => listeners.forEach((l) => l()));
    };
  });

  it("opens both on a wide window and toggles them independently", () => {
    renderPage();
    expect(treeOpen()).toBe("true");
    expect(rightOpen()).toBe(true);
    fireEvent.click(rightToggle());
    expect(rightOpen()).toBe(false);
    expect(treeOpen()).toBe("true");
    fireEvent.click(rightToggle());
    expect(rightOpen()).toBe(true);
    expect(treeOpen()).toBe("true");
    fireEvent.click(treeToggle());
    expect(treeOpen()).toBe("false");
    expect(rightOpen()).toBe(true);
  });

  it("shows one sidebar at a time on a narrow window", () => {
    setNarrow(true);
    renderPage();
    expect(rightOpen()).toBe(true);
    expect(treeOpen()).toBe("false");
    expect(treeToggle().getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(treeToggle());
    expect(treeOpen()).toBe("true");
    expect(rightOpen()).toBe(false);

    fireEvent.click(rightToggle());
    expect(rightOpen()).toBe(true);
    expect(treeOpen()).toBe("false");
  });

  it("keeps the most recently opened sidebar when the window narrows, and both when it widens again", () => {
    renderPage();
    fireEvent.click(treeToggle());
    fireEvent.click(treeToggle()); // the tree is now the most recently opened
    setNarrow(true);
    expect(treeOpen()).toBe("true");
    expect(rightOpen()).toBe(false);
    setNarrow(false);
    expect(treeOpen()).toBe("true");
    expect(rightOpen()).toBe(true);
  });

  it("closes the agent panel with Esc", () => {
    setNarrow(true);
    renderPage();
    expect(rightOpen()).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(rightOpen()).toBe(false);
  });

  it("restores the persisted sidebar state", () => {
    localStorage.setItem("ontobuilder:editorSidebars", JSON.stringify({ left: false, right: true }));
    renderPage();
    expect(rightOpen()).toBe(true);
    expect(treeOpen()).toBe("false");
  });
});

describe("Ontology file in the breadcrumb", () => {
  beforeEach(() => {
    mockViewer = makeViewer({
      project: {
        id: PROJECT_ID,
        name: "Newman Center",
        description: "Campus ministry ontology",
        source_file_path: `projects/${PROJECT_ID}/src/newman.ttl`,
        git_ontology_path: "src/newman.ttl",
      },
    });
  });

  it("reads Projects › name › file, with a menu of the folder's RDF files and New ontology", async () => {
    renderPage();
    const crumbs = within(subHeader()).getByRole("navigation", { name: "Breadcrumb" });
    const button = within(crumbs).getByTestId("ontology-file-button");
    expect(button.textContent).toContain("newman.ttl");
    expect(button.getAttribute("aria-label")).toBe("Ontology file: src/newman.ttl");
    expect(await tooltipFor(button)).toMatch(/^Ontology file: src\/newman\.ttl\. The project edits one ontology file at a time/);
    fireEvent.click(button);
    const menu = screen.getByRole("menu", { name: "Ontology file" });
    expect(await within(menu).findByText("legacy/newman.owl")).toBeTruthy();
    expect(within(menu).getByRole("menuitemradio", { checked: true }).textContent).toContain("src/newman.ttl");
    expect(within(menu).getByRole("menuitem", { name: /New ontology/ })).toBeTruthy();
    expect(ontologyFilesApi.listOntologyFiles).toHaveBeenCalledWith(PROJECT_ID, "main");
  });
});

describe("No Ontology File view", () => {
  beforeEach(() => {
    mockViewer = makeViewer({ hasOntology: false });
    ontologyFilesApi.listOntologyFiles.mockResolvedValue({
      project_id: PROJECT_ID,
      branch: "main",
      active_path: null,
      active_exists: false,
      suggested_file_name: "ontology.ttl",
      files: [
        { path: "legacy/newman.owl", format: "rdfxml", size_bytes: 20, declares_ontology: true, active: false, turtle_path: "legacy/newman.ttl", turtle_exists: false },
      ],
    });
  });

  it("offers the folder's RDF files and a new ontology instead of pointing to settings", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "No Ontology File" })).toBeTruthy();
    expect(screen.queryByText(/Import an ontology file from the project settings/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Go to Settings" })).toBeNull();
    const panel = screen.getByTestId("ontology-file-panel");
    expect(await within(panel).findByRole("button", { name: "Use legacy/newman.owl" })).toBeTruthy();
    expect(within(panel).getByText(/Converts to legacy\/newman\.ttl/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: /New ontology/ }));
    const dialog = await screen.findByTestId("new-ontology-dialog");
    expect(within(dialog).queryByTestId("new-ontology-replace-warning")).toBeNull();
    expect((within(dialog).getByLabelText("File name") as HTMLInputElement).value).toBe("ontology.ttl");
  });
});
