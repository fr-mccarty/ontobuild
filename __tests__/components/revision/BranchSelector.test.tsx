import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within, waitFor, fireEvent, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });
import userEvent from "@testing-library/user-event";

const mockSwitchBranch = vi.fn().mockResolvedValue(undefined);
const mockCreateBranch = vi.fn().mockResolvedValue({ name: "feature/new", is_default: false });
const mockDeleteBranch = vi.fn().mockResolvedValue(undefined);

let mockBranchState = {
  branches: [
    {
      name: "main",
      is_current: true,
      is_default: true,
      commit_hash: "abc1234567890",
      commit_message: "init",
      commit_date: new Date().toISOString(),
      commits_ahead: 0,
      commits_behind: 0,
      can_delete: false,
      has_open_pr: false,
      has_delete_permission: false,
    },
    {
      name: "feature/test",
      is_current: false,
      is_default: false,
      commit_hash: "def4567890123",
      commit_message: "feat",
      commit_date: new Date().toISOString(),
      commits_ahead: 2,
      commits_behind: 0,
      can_delete: true,
      has_open_pr: false,
      has_delete_permission: true,
    },
  ],
  currentBranch: "main",
  defaultBranch: "main",
  isLoading: false,
  isFeatureBranch: false,
  switchBranch: mockSwitchBranch,
  createBranch: mockCreateBranch,
  deleteBranch: mockDeleteBranch,
  error: null,
  pendingChanges: false,
  refreshBranches: vi.fn(),
  setPendingChanges: vi.fn(),
};

vi.mock("@/lib/context/BranchContext", () => ({
  useBranch: () => mockBranchState,
}));

import { BranchSelector } from "@/components/revision/BranchSelector";

beforeEach(() => {
  mockSwitchBranch.mockClear().mockResolvedValue(undefined);
  mockCreateBranch.mockClear().mockResolvedValue({ name: "feature/new", is_default: false });
  mockDeleteBranch.mockClear().mockResolvedValue(undefined);

  mockBranchState = {
    ...mockBranchState,
    branches: [
      {
        name: "main",
        is_current: true,
        is_default: true,
        commit_hash: "abc1234567890",
        commit_message: "init",
        commit_date: new Date().toISOString(),
        commits_ahead: 0,
        commits_behind: 0,
        can_delete: false,
        has_open_pr: false,
        has_delete_permission: false,
      },
      {
        name: "feature/test",
        is_current: false,
        is_default: false,
        commit_hash: "def4567890123",
        commit_message: "feat",
        commit_date: new Date().toISOString(),
        commits_ahead: 2,
        commits_behind: 0,
        can_delete: true,
        has_open_pr: false,
        has_delete_permission: true,
      },
    ],
    currentBranch: "main",
    defaultBranch: "main",
    isLoading: false,
    isFeatureBranch: false,
  };
});

describe("BranchSelector", () => {
  it("renders the current branch name", () => {
    render(<BranchSelector />);
    expect(screen.getByText("main")).toBeDefined();
  });

  it("renders the abbreviated commit hash", () => {
    render(<BranchSelector />);
    expect(screen.getByText("abc1234")).toBeDefined();
  });

  it("does not show dropdown initially", () => {
    render(<BranchSelector />);
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("opens dropdown on button click", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);

    const trigger = screen.getByRole("button");
    await user.click(trigger);

    const options = screen.getAllByRole("option");
    expect(options.length).toBe(2);
  });

  it("shows branch names in dropdown", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);

    await user.click(screen.getByRole("button"));

    expect(screen.getByText("feature/test")).toBeDefined();
  });

  it("shows 'default' badge on default branch", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));

    expect(screen.getByText("default")).toBeDefined();
  });

  it("marks current branch as selected", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));

    const mainOption = screen.getAllByRole("option").find(
      (o) => o.getAttribute("aria-selected") === "true"
    );
    expect(mainOption).toBeDefined();
    expect(within(mainOption!).getByText("main")).toBeDefined();
  });

  it("calls switchBranch when selecting a different branch", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));

    const featureOption = screen.getAllByRole("option").find(
      (o) => within(o).queryByText("feature/test") !== null
    );
    await user.click(featureOption!);

    expect(mockSwitchBranch).toHaveBeenCalledWith("feature/test");
  });

  it("does not call switchBranch when clicking the current branch", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));

    const mainOption = screen.getAllByRole("option").find(
      (o) => o.getAttribute("aria-selected") === "true"
    );
    await user.click(mainOption!);

    expect(mockSwitchBranch).not.toHaveBeenCalled();
  });

  it("closes dropdown after selecting a branch", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));

    const featureOption = screen.getAllByRole("option").find(
      (o) => within(o).queryByText("feature/test") !== null
    );
    await user.click(featureOption!);

    await waitFor(() => {
      expect(screen.queryByRole("option")).toBeNull();
    });
  });

  it("shows 'Create new branch' button", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));

    expect(screen.getByText("Create new branch")).toBeDefined();
  });

  it("shows create branch input when clicking 'Create new branch'", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Create new branch"));

    expect(screen.getByPlaceholderText("feature/my-changes")).toBeDefined();
  });

  it("calls createBranch with the typed name", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Create new branch"));

    const input = screen.getByPlaceholderText("feature/my-changes");
    await user.type(input, "feature/new-branch");
    await user.click(screen.getByText("Create"));

    expect(mockCreateBranch).toHaveBeenCalledWith("feature/new-branch");
  });

  it("does not call createBranch with empty name", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Create new branch"));

    await user.click(screen.getByText("Create"));

    expect(mockCreateBranch).not.toHaveBeenCalled();
  });

  it("hides create form when Cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Create new branch"));

    expect(screen.getByPlaceholderText("feature/my-changes")).toBeDefined();

    await user.click(screen.getByText("Cancel"));

    expect(screen.queryByPlaceholderText("feature/my-changes")).toBeNull();
  });

  it("creates branch on Enter key", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Create new branch"));

    const input = screen.getByPlaceholderText("feature/my-changes");
    await user.type(input, "feature/enter-branch{Enter}");

    expect(mockCreateBranch).toHaveBeenCalledWith("feature/enter-branch");
  });

  it("cancels create on Escape key", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Create new branch"));

    const input = screen.getByPlaceholderText("feature/my-changes");
    await user.type(input, "test");
    await user.keyboard("{Escape}");

    expect(screen.queryByPlaceholderText("feature/my-changes")).toBeNull();
  });

  it("shows delete button for non-default, non-current branch with permission", async () => {
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));

    const featureOption = screen.getAllByRole("option").find(
      (o) => within(o).queryByText("feature/test") !== null
    );
    const deleteBtn = featureOption!.querySelector("button");
    expect(deleteBtn).not.toBeNull();
  });

  it("shows loading state when isLoading is true", () => {
    mockBranchState = { ...mockBranchState, isLoading: true };
    render(<BranchSelector />);

    const trigger = screen.getByRole("button");
    expect(trigger.hasAttribute("disabled")).toBe(true);
  });

  it("displays commits ahead count", () => {
    mockBranchState = {
      ...mockBranchState,
      currentBranch: "feature/test",
      isFeatureBranch: true,
    };
    render(<BranchSelector />);

    expect(screen.getByText("+2")).toBeDefined();
  });

  it("calls onBranchChange callback when switching branches", async () => {
    const onBranchChange = vi.fn();
    const user = userEvent.setup();
    render(<BranchSelector onBranchChange={onBranchChange} />);
    await user.click(screen.getByRole("button"));

    const featureOption = screen.getAllByRole("option").find(
      (o) => within(o).queryByText("feature/test") !== null
    );
    await user.click(featureOption!);

    await waitFor(() => {
      expect(onBranchChange).toHaveBeenCalledWith("feature/test");
    });
  });

  it("shows error message when switchBranch fails", async () => {
    mockSwitchBranch.mockRejectedValueOnce(new Error("Network error"));
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));

    const featureOption = screen.getAllByRole("option").find(
      (o) => within(o).queryByText("feature/test") !== null
    );
    await user.click(featureOption!);

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeDefined();
    });
  });

  it("shows 'No branches found' when branch list is empty", async () => {
    mockBranchState = { ...mockBranchState, branches: [] };
    const user = userEvent.setup();
    render(<BranchSelector />);
    await user.click(screen.getByRole("button"));

    expect(screen.getByText("No branches found")).toBeDefined();
  });
});

describe("BranchSelector tooltip", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  });

  const tooltipText = async () => (await screen.findByRole("tooltip")).textContent;

  it("names the current branch and commit on focus", async () => {
    render(<BranchSelector />);
    fireEvent.focus(screen.getByRole("button"));
    expect(await tooltipText()).toBe("Branch: main at commit abc1234. Click to switch branches or create a new one.");
  });

  it("shows on hover too", async () => {
    const user = userEvent.setup();
    rtlRender(
      <TooltipPrimitive.Provider delayDuration={0}>
        <BranchSelector />
      </TooltipPrimitive.Provider>,
    );
    await user.hover(screen.getByRole("button"));
    expect(await tooltipText()).toBe("Branch: main at commit abc1234. Click to switch branches or create a new one.");
  });

  it("includes commits ahead of and behind the default branch", async () => {
    mockBranchState = {
      ...mockBranchState,
      currentBranch: "feature/test",
      isFeatureBranch: true,
      branches: mockBranchState.branches.map((b) =>
        b.name === "feature/test" ? { ...b, commits_ahead: 2, commits_behind: 1 } : b,
      ),
    };
    render(<BranchSelector />);
    fireEvent.focus(screen.getByRole("button"));
    expect(await tooltipText()).toBe(
      "Branch: feature/test at commit def4567, 2 commits ahead of main, 1 commit behind main. Click to switch branches or create a new one.",
    );
  });

  it("says when branches are loading", async () => {
    mockBranchState = { ...mockBranchState, isLoading: true };
    render(<BranchSelector />);
    fireEvent.focus(screen.getByRole("button").parentElement!);
    expect(await tooltipText()).toBe("Branch: loading branches…");
  });

  it("closes on click and stays closed while the branch menu is open", async () => {
    render(<BranchSelector />);
    const button = screen.getByRole("button");
    fireEvent.focus(button);
    await screen.findByRole("tooltip");
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    fireEvent.pointerUp(document);
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.blur(button);
    fireEvent.focus(button);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
