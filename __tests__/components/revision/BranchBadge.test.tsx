import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });

const mockBranchContext = {
  currentBranch: "feature/add-class",
  defaultBranch: "main",
  branches: [
    { name: "feature/add-class", commits_ahead: 3, commits_behind: 0 },
  ],
  isFeatureBranch: true,
};

vi.mock("@/lib/context/BranchContext", () => ({
  useBranch: () => mockBranchContext,
}));

import { BranchBadge } from "@/components/revision/BranchBadge";

describe("BranchBadge", () => {
  beforeEach(() => {
    mockBranchContext.currentBranch = "feature/add-class";
    mockBranchContext.defaultBranch = "main";
    mockBranchContext.branches = [
      { name: "feature/add-class", commits_ahead: 3, commits_behind: 0 },
    ];
    mockBranchContext.isFeatureBranch = true;
  });

  it("renders the current branch name", () => {
    render(<BranchBadge />);
    expect(screen.getByText("feature/add-class")).toBeDefined();
  });

  it("returns null when not on a feature branch", () => {
    mockBranchContext.isFeatureBranch = false;
    const { container } = render(<BranchBadge />);
    expect(container.innerHTML).toBe("");
  });

  it("shows commits ahead count when showCommitCount is true", () => {
    render(<BranchBadge showCommitCount />);
    expect(screen.getByText("3")).toBeDefined();
  });

  it("does not show commits ahead when showCommitCount is false", () => {
    render(<BranchBadge showCommitCount={false} />);
    expect(screen.queryByText("3")).toBeNull();
  });

  it("does not show commits ahead when 0", () => {
    mockBranchContext.branches = [
      { name: "feature/add-class", commits_ahead: 0, commits_behind: 0 },
    ];
    render(<BranchBadge />);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("shows commits behind indicator when > 0", () => {
    mockBranchContext.branches = [
      { name: "feature/add-class", commits_ahead: 3, commits_behind: 2 },
    ];
    render(<BranchBadge />);
    expect(screen.getByText("2 behind")).toBeDefined();
  });

  it("does not show behind indicator when commits_behind is 0", () => {
    render(<BranchBadge />);
    expect(screen.queryByText(/behind/)).toBeNull();
  });

  it("shows tooltip with commits behind info", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    mockBranchContext.branches = [
      { name: "feature/add-class", commits_ahead: 3, commits_behind: 5 },
    ];
    render(<BranchBadge />);
    fireEvent.focus(screen.getByText("5 behind"));
    expect((await screen.findAllByText("5 commits behind main")).length).toBeGreaterThan(0);
  });

  it("uses singular 'commit' for 1 behind", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    mockBranchContext.branches = [
      { name: "feature/add-class", commits_ahead: 3, commits_behind: 1 },
    ];
    render(<BranchBadge />);
    fireEvent.focus(screen.getByText("1 behind"));
    expect((await screen.findAllByText("1 commit behind main")).length).toBeGreaterThan(0);
  });

  it("applies custom className", () => {
    const { container } = render(<BranchBadge className="my-badge" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge?.className).toContain("my-badge");
  });

  it("handles missing branch info gracefully", () => {
    mockBranchContext.branches = [];
    render(<BranchBadge />);
    expect(screen.getByText("feature/add-class")).toBeDefined();
    expect(screen.queryByText(/behind/)).toBeNull();
  });
});
