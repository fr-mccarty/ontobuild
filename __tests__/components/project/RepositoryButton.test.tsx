import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GitHubRemote } from "@/lib/api/github";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  fetch: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/api/github", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/github")>();
  return { ...actual, githubApi: api };
});

const branchFns = vi.hoisted(() => ({
  switchBranch: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
}));
let mockBranchState: Record<string, unknown>;
vi.mock("@/lib/context/BranchContext", () => ({
  useBranch: () => mockBranchState,
  branchQueryKeys: { list: (...args: unknown[]) => ["branches", ...args] },
}));

import { RepositoryButton } from "@/components/project/RepositoryButton";

const base: GitHubRemote = {
  remote_url: null,
  web_url: null,
  host: null,
  is_github: false,
  branch: "main",
  upstream: null,
  ahead: null,
  behind: null,
  last_fetched_at: null,
  gh_available: false,
  gh_authenticated: false,
};
const linked: GitHubRemote = {
  ...base,
  remote_url: "git@github.com:acme/pizza.git",
  web_url: "https://github.com/acme/pizza",
  host: "github.com",
  is_github: true,
  upstream: "origin/main",
  ahead: 2,
  behind: 1,
};

function renderButton(props: Partial<Parameters<typeof RepositoryButton>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const all = {
    projectId: "p1",
    historyOpen: false,
    onToggleHistory: vi.fn(),
    onBranchChange: vi.fn(),
    onPulled: vi.fn(),
    ...props,
  };
  render(
    <QueryClientProvider client={client}>
      <TooltipPrimitive.Provider>
        <RepositoryButton {...all} />
      </TooltipPrimitive.Provider>
    </QueryClientProvider>,
  );
  return all;
}

const openPopover = () => {
  fireEvent.click(screen.getByRole("button", { name: "Repository" }));
  return screen.getByRole("dialog", { name: "Repository" });
};

describe("RepositoryButton", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.values(api).forEach((f) => f.mockReset());
    Object.values(branchFns).forEach((f) => f.mockReset().mockResolvedValue({ name: "feature/new" }));
    mockBranchState = {
      branches: [
        { name: "main", is_default: true, commit_hash: "a47aeb0123456", commits_ahead: 0, commits_behind: 0, can_delete: false, has_open_pr: false, has_delete_permission: false },
        { name: "feature/x", is_default: false, commit_hash: "bbbbbbb1234", commits_ahead: 3, commits_behind: 0, can_delete: true, has_open_pr: false, has_delete_permission: true },
      ],
      currentBranch: "main",
      defaultBranch: "main",
      isLoading: false,
      isFeatureBranch: false,
      ...branchFns,
    };
  });

  it("shows the current branch and the GitHub ahead/behind indicator on the trigger", async () => {
    api.get.mockResolvedValue(linked);
    const props = renderButton();
    const trigger = screen.getByRole("button", { name: "Repository" });
    expect(within(trigger).getByTestId("repository-branch").textContent).toBe("main");
    await waitFor(() => expect(within(trigger).getByTestId("github-ahead-behind").textContent).toContain("21"));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // The active branch is reported even while the popover is closed.
    expect(props.onBranchChange).toHaveBeenCalledWith("main");
  });

  it("has no GitHub indicator when the project isn't linked", async () => {
    api.get.mockResolvedValue(base);
    renderButton();
    openPopover();
    expect(await screen.findByText("gh auth login")).toBeTruthy();
    expect(screen.queryByTestId("github-ahead-behind")).toBeNull();
  });

  it("groups branch switching/creation, history and GitHub in one popover", async () => {
    api.get.mockResolvedValue({ ...base, gh_available: true, gh_authenticated: true });
    renderButton();
    const popover = openPopover();
    const branch = within(popover).getByRole("region", { name: "Branch" });
    expect(within(branch).getByRole("option", { name: /feature\/x/ })).toBeDefined();
    expect(within(branch).getByText("Create new branch")).toBeDefined();
    expect(within(within(popover).getByRole("region", { name: "History" })).getByRole("button", { name: "Revision history" })).toBeDefined();
    const github = within(popover).getByRole("region", { name: "GitHub" });
    expect(await within(github).findByRole("button", { name: "Create on GitHub" })).toBeDefined();
    expect(within(github).getByLabelText("Link an existing repository")).toBeDefined();
  });

  it("switches and creates branches, closing the popover", async () => {
    api.get.mockResolvedValue(base);
    const props = renderButton();
    fireEvent.click(within(openPopover()).getByRole("option", { name: /feature\/x/ }));
    await waitFor(() => expect(branchFns.switchBranch).toHaveBeenCalledWith("feature/x"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Repository" })).toBeNull());
    expect(props.onBranchChange).toHaveBeenCalledWith("feature/x");

    fireEvent.click(within(openPopover()).getByText("Create new branch"));
    fireEvent.change(screen.getByPlaceholderText("feature/my-changes"), { target: { value: "feature/new" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(branchFns.createBranch).toHaveBeenCalledWith("feature/new"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Repository" })).toBeNull());
  });

  it("toggles revision history and closes the popover", () => {
    api.get.mockResolvedValue(base);
    const props = renderButton({ historyOpen: true });
    const item = within(openPopover()).getByRole("button", { name: "Hide revision history" });
    expect(item.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(item);
    expect(props.onToggleHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Repository" })).toBeNull();
  });

  it("pulls from a linked remote and tells the editor to reload", async () => {
    api.get.mockResolvedValue(linked);
    api.pull.mockResolvedValue({ ...linked, behind: 0, output: "Fast-forward" });
    const props = renderButton();
    const popover = openPopover();
    expect((await within(popover).findByTestId("github-status")).textContent).toContain("2 ahead, 1 behind");
    fireEvent.click(within(popover).getByRole("button", { name: /Pull/ }));
    await waitFor(() => expect(props.onPulled).toHaveBeenCalledTimes(1));
    expect(await within(popover).findByText("Fast-forward")).toBeTruthy();
  });

  it("closes on Esc and on an outside click", () => {
    api.get.mockResolvedValue(base);
    renderButton();
    const popover = openPopover();
    fireEvent.keyDown(within(popover).getByRole("button", { name: "Revision history" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Repository" })).toBeNull();
    openPopover();
    fireEvent.click(document.querySelector(".fixed.inset-0")!);
    expect(screen.queryByRole("dialog", { name: "Repository" })).toBeNull();
  });
});
