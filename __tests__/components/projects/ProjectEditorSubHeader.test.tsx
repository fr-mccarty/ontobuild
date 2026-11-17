import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

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
  StandardEditorLayout: ({ treePanelOpen }: { treePanelOpen?: boolean }) => (
    <div data-testid="editor-layout" data-tree-open={String(treePanelOpen)} />
  ),
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
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mockViewer = makeViewer();
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
  it("explains the Back link, project name and class count", async () => {
    renderPage();
    const bar = subHeader();
    expect(await tooltipFor(within(bar).getByRole("link", { name: "Back" }))).toBe(
      "Back to projects: return to the list of all projects",
    );
    expect(await tooltipFor(within(bar).getByRole("heading", { level: 1 }))).toBe(
      "Project: Newman Center. Campus ministry ontology",
    );
    expect(await tooltipFor(within(bar).getByText("14 classes"))).toBe(
      "Class count: the number of classes in the ontology on the main branch",
    );
  });

  it("explains the Repository button with the current branch, commit and GitHub link", async () => {
    renderPage();
    const button = within(subHeader()).getByRole("button", { name: "Repository" });
    expect(await tooltipFor(button)).toBe(
      "Repository: on branch main at commit a47aeb0. GitHub: link this project to a repository. Click to switch branches, view history or push and pull.",
    );
  });

  it("explains Share, Normalize, dashboard, shortcuts, settings and the panel toggles", async () => {
    renderPage();
    const bar = subHeader();
    expect(await tooltipFor(within(bar).getByRole("button", { name: /^Share options/ }))).toBe(
      "Share: copy a link to this project, or open pull requests (2 open). Also holds the editor controls that don't fit in the bar at this width",
    );
    expect(await tooltipFor(within(bar).getByRole("link", { name: "Normalize ontology" }))).toBe(
      "Normalization recommended: the ontology file isn't in canonical Turtle format. Opens project settings to normalize it",
    );
    expect(await tooltipFor(within(bar).getByRole("link", { name: "Project dashboard" }))).toBe(
      "Project dashboard: overview of this project with its description and links to the editor and settings",
    );
    expect(await tooltipFor(within(bar).getByRole("button", { name: "Keyboard shortcuts" }))).toBe(
      "Keyboard shortcuts: list the shortcuts available in the editor (shortcut: ?)",
    );
    expect(await tooltipFor(within(bar).getByRole("link", { name: "Project settings" }))).toBe(
      "Project settings: settings for this project only (ontology import, normalization, lint rules)",
    );
    expect(await tooltipFor(within(bar).getByRole("button", { name: /Agent and health panel/ }))).toBe(
      "Hide the agent and health panel (shortcut: Esc)",
    );
    expect(await tooltipFor(within(bar).getByRole("button", { name: "Entity tree" }))).toBe(
      "Hide the entity tree: the classes, properties and individuals list",
    );
  });

  it("describes the toggles as 'show' once the panels are closed", async () => {
    renderPage();
    const bar = subHeader();
    fireEvent.click(within(bar).getByRole("button", { name: /Agent and health panel/ }));
    fireEvent.click(within(bar).getByRole("button", { name: "Entity tree" }));
    expect(await tooltipFor(within(bar).getByRole("button", { name: /Agent and health panel/ }))).toBe(
      "Show the agent and health panel: chat with the ontology agent and review lint health checks (3 lint issues)",
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
    expect(cls(within(bar).getByRole("link", { name: "Normalize ontology" }))).toEqual(
      expect.arrayContaining(["hidden", "xl:inline-flex"]),
    );
    expect(cls(within(bar).getByRole("button", { name: "Keyboard shortcuts" }))).toEqual(
      expect.arrayContaining(["hidden", "lg:inline-flex"]),
    );
    // The Repository button shows at every width (its branch name hides below sm).
    expect(cls(within(bar).getByRole("button", { name: "Repository" }))).not.toContain("hidden");
    expect(cls(within(bar).getByRole("link", { name: "Project dashboard" }))).toEqual(
      expect.arrayContaining(["hidden", "sm:inline-flex"]),
    );
    expect(cls(within(bar).getByRole("link", { name: "Project settings" }))).toEqual(
      expect.arrayContaining(["hidden", "sm:inline-flex"]),
    );
  });
});

describe("Share overflow menu", () => {
  const openMenu = () => {
    fireEvent.click(within(subHeader()).getByRole("button", { name: /^Share options/ }));
    return screen.getByRole("menu");
  };
  const cls = (el: Element) => el.className.split(/\s+/);

  it("holds each overflowed control, shown only below the width where its inline version hides", () => {
    renderPage();
    const menu = openMenu();
    // Versioning lives in the Repository popover, not the overflow menu.
    expect(within(menu).queryByRole("group", { name: "Branch" })).toBeNull();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /revision history/i })).toBeNull();
    expect(cls(within(menu).getByRole("menuitem", { name: "Keyboard shortcuts" }))).toContain("lg:hidden");
    expect(cls(within(menu).getByRole("menuitem", { name: "Normalize ontology" }))).toContain("xl:hidden");
    expect(cls(within(menu).getByRole("menuitem", { name: "Project dashboard" }))).toContain("sm:hidden");
    expect(cls(within(menu).getByRole("menuitem", { name: "Project settings" }))).toContain("sm:hidden");
    // The share items themselves stay.
    expect(within(menu).getByRole("menuitem", { name: "Copy project link" })).toBeDefined();
    expect(within(menu).getByRole("menuitem", { name: /Pull requests/ }).textContent).toContain("2");
  });

  it("links Normalize, dashboard and settings where the inline controls go", () => {
    renderPage();
    const menu = openMenu();
    expect(within(menu).getByRole("menuitem", { name: "Normalize ontology" }).getAttribute("href")).toBe(
      `/projects/${PROJECT_ID}/settings#normalization`,
    );
    expect(within(menu).getByRole("menuitem", { name: "Project dashboard" }).getAttribute("href")).toBe(
      `/projects/${PROJECT_ID}/dashboard`,
    );
    expect(within(menu).getByRole("menuitem", { name: "Project settings" }).getAttribute("href")).toBe(
      `/projects/${PROJECT_ID}/settings`,
    );
  });

  it("leaves out Normalize when it doesn't apply, and hides the overflow from lg up", () => {
    mockViewer = makeViewer({ normalizationStatus: { needs_normalization: false } });
    renderPage();
    const menu = openMenu();
    expect(within(menu).queryByRole("menuitem", { name: "Normalize ontology" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Project settings" })).toBeDefined();
    expect(cls(within(menu).getByRole("menuitem", { name: "Keyboard shortcuts" }).parentElement!)).toContain("lg:hidden");
  });

  it("opens the keyboard shortcuts dialog", async () => {
    renderPage();
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "Keyboard shortcuts" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(await screen.findByRole("dialog")).toBeDefined();
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
  const rightToggle = () => within(subHeader()).getByRole("button", { name: /Agent and health panel/ });

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
