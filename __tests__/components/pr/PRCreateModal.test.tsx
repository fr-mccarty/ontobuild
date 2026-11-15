import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PullRequest } from "@/lib/api/pullRequests";

const mockCreate = vi.fn();

vi.mock("@/lib/api/pullRequests", () => ({
  pullRequestsApi: {
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("lucide-react", () => ({
  X: () => <span data-testid="icon-x" />,
  GitBranch: () => <span data-testid="icon-git-branch" />,
  ArrowRight: () => <span data-testid="icon-arrow-right" />,
}));

const mockUseBranch = vi.fn();
vi.mock("@/lib/context/BranchContext", () => ({
  useBranch: () => mockUseBranch(),
}));

import { PRCreateModal } from "@/components/pr/PRCreateModal";

const defaultBranchContext = {
  currentBranch: "feature/test",
  defaultBranch: "main",
  branches: [
    { name: "main", is_default: true },
    { name: "feature/test", is_default: false },
    { name: "dev", is_default: false },
  ],
};

const defaultProps = {
  projectId: "proj-1",
  accessToken: "token-123",
  isOpen: true,
  onClose: vi.fn(),
  onCreated: vi.fn(),
};

function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: "pr-1",
    project_id: "proj-1",
    pr_number: 1,
    title: "Test PR",
    source_branch: "feature/test",
    target_branch: "main",
    status: "open",
    author_id: "user-1",
    created_at: new Date().toISOString(),
    review_count: 0,
    approval_count: 0,
    comment_count: 0,
    commits_ahead: 1,
    can_merge: true,
    ...overrides,
  };
}

describe("PRCreateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseBranch.mockReturnValue(defaultBranchContext);
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <PRCreateModal {...defaultProps} isOpen={false} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the modal when isOpen is true", () => {
    render(<PRCreateModal {...defaultProps} />);
    expect(screen.getAllByText("Create Pull Request").length).toBeGreaterThan(0);
  });

  it("renders title and description inputs", () => {
    render(<PRCreateModal {...defaultProps} />);
    expect(screen.getByLabelText("Title")).toBeDefined();
    expect(screen.getByLabelText("Description")).toBeDefined();
  });

  it("renders branch selectors with correct values", () => {
    render(<PRCreateModal {...defaultProps} />);
    expect(screen.getByText("From")).toBeDefined();
    expect(screen.getByText("Into")).toBeDefined();
    const options = screen.getAllByRole("option");
    expect(options.length).toBe(6);
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<PRCreateModal {...defaultProps} onClose={onClose} />);
    const backdrop = document.querySelector(".fixed.inset-0");
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when X button is clicked", () => {
    const onClose = vi.fn();
    render(<PRCreateModal {...defaultProps} onClose={onClose} />);
    const closeBtn = screen.getByTestId("icon-x").parentElement!;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Cancel button is clicked", () => {
    const onClose = vi.fn();
    render(<PRCreateModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not submit when title is empty (native validation)", () => {
    render(<PRCreateModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Pull Request" }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("shows title required error when whitespace-only title bypasses native validation", async () => {
    render(<PRCreateModal {...defaultProps} />);
    const titleInput = screen.getByLabelText("Title");
    fireEvent.change(titleInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pull Request" }));

    await waitFor(() => {
      expect(screen.getByText("Title is required")).toBeDefined();
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("shows error when source and target branches are the same", async () => {
    mockUseBranch.mockReturnValue({
      ...defaultBranchContext,
      currentBranch: "main",
      defaultBranch: "main",
    });
    render(<PRCreateModal {...defaultProps} />);

    const titleInput = screen.getByLabelText("Title");
    fireEvent.change(titleInput, { target: { value: "My PR" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pull Request" }));

    await waitFor(() => {
      expect(
        screen.getByText("Source and target branches must be different")
      ).toBeDefined();
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("submits form successfully and calls onCreated and onClose", async () => {
    const pr = makePR();
    mockCreate.mockResolvedValueOnce(pr);
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(
      <PRCreateModal
        {...defaultProps}
        onCreated={onCreated}
        onClose={onClose}
      />
    );

    const titleInput = screen.getByLabelText("Title");
    fireEvent.change(titleInput, { target: { value: "Add Person class" } });

    const descInput = screen.getByLabelText("Description");
    fireEvent.change(descInput, {
      target: { value: "Adds the Person entity" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Pull Request" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        "proj-1",
        {
          title: "Add Person class",
          description: "Adds the Person entity",
          source_branch: "feature/test",
          target_branch: "main",
        },
        "token-123"
      );
    });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(pr);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows Creating... text while submitting", async () => {
    mockCreate.mockReturnValue(new Promise(() => {}));
    render(<PRCreateModal {...defaultProps} />);

    const titleInput = screen.getByLabelText("Title");
    fireEvent.change(titleInput, { target: { value: "Test PR" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pull Request" }));

    await waitFor(() => {
      expect(screen.getByText("Creating...")).toBeDefined();
    });
  });

  it("shows API error message on failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Conflict detected"));
    render(<PRCreateModal {...defaultProps} />);

    const titleInput = screen.getByLabelText("Title");
    fireEvent.change(titleInput, { target: { value: "Test PR" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pull Request" }));

    await waitFor(() => {
      expect(screen.getByText("Conflict detected")).toBeDefined();
    });
  });

  it("shows generic error when non-Error is thrown", async () => {
    mockCreate.mockRejectedValueOnce("something bad");
    render(<PRCreateModal {...defaultProps} />);

    const titleInput = screen.getByLabelText("Title");
    fireEvent.change(titleInput, { target: { value: "Test PR" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pull Request" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to create pull request")).toBeDefined();
    });
  });

  it("trims whitespace from title and description", async () => {
    const pr = makePR();
    mockCreate.mockResolvedValueOnce(pr);
    render(<PRCreateModal {...defaultProps} />);

    const titleInput = screen.getByLabelText("Title");
    fireEvent.change(titleInput, { target: { value: "  Trimmed Title  " } });

    const descInput = screen.getByLabelText("Description");
    fireEvent.change(descInput, { target: { value: "  Trimmed Desc  " } });

    fireEvent.click(screen.getByRole("button", { name: "Create Pull Request" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({
          title: "Trimmed Title",
          description: "Trimmed Desc",
        }),
        "token-123"
      );
    });
  });

  it("sends undefined description when empty", async () => {
    const pr = makePR();
    mockCreate.mockResolvedValueOnce(pr);
    render(<PRCreateModal {...defaultProps} />);

    const titleInput = screen.getByLabelText("Title");
    fireEvent.change(titleInput, { target: { value: "No desc PR" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pull Request" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        "proj-1",
        expect.objectContaining({
          description: undefined,
        }),
        "token-123"
      );
    });
  });

  it("allows changing source and target branches", () => {
    render(<PRCreateModal {...defaultProps} />);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "dev" } });
    fireEvent.change(selects[1], { target: { value: "feature/test" } });

    expect((selects[0] as HTMLSelectElement).value).toBe("dev");
    expect((selects[1] as HTMLSelectElement).value).toBe("feature/test");
  });
});
