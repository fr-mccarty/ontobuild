import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type {
  PullRequest,
  Review,
  Comment,
  PRCommit,
  PRDiffResponse,
} from "@/lib/api/pullRequests";

vi.mock("@/lib/api/pullRequests", () => ({
  pullRequestsApi: {
    get: vi.fn(),
    listReviews: vi.fn(),
    listComments: vi.fn(),
    createComment: vi.fn(),
    getCommits: vi.fn(),
    getDiff: vi.fn(),
  },
}));

vi.mock("@/components/pr/PRActions", () => ({
  PRActions: (props: Record<string, unknown>) => (
    <div data-testid="pr-actions" data-project-id={props.projectId} />
  ),
}));

vi.mock("@/components/pr/PRCommentThread", () => ({
  PRCommentThread: (props: Record<string, unknown>) => (
    <div data-testid="pr-comment-thread" data-pr-number={props.prNumber} />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string;
    variant?: string;
    children?: React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));

import { PRDetail } from "@/components/pr/PRDetail";
import { pullRequestsApi } from "@/lib/api/pullRequests";

function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    merged_by: null,
    merged_by_user: null,
    merged_at: null,
    merge_commit_hash: null,
    base_commit_hash: null,
    head_commit_hash: null,
    updated_at: null,
    id: "pr-1",
    project_id: "proj-1",
    pr_number: 7,
    title: "Add owl:Thing subclass",
    description: "Introduces a new top-level class.",
    source_branch: "feature/thing",
    target_branch: "main",
    status: "open",
    author_id: "user-1",
    author: { id: "user-1", name: "Alice", email: null },
    created_at: "2025-06-01T10:00:00Z",
    review_count: 0,
    approval_count: 0,
    comment_count: 2,
    commits_ahead: 3,
    can_merge: true,
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: "rev-1",
    pull_request_id: "pr-1",
    reviewer_id: "user-2",
    reviewer: { id: "user-2", name: "Bob", email: null },
    status: "approved",
    body: "Looks good!",
    created_at: "2025-06-02T10:00:00Z",
    ...overrides,
  };
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    parent_id: null,
    updated_at: null,
    id: "comment-1",
    pull_request_id: "pr-1",
    author_id: "user-1",
    author: { id: "user-1", name: "Alice", email: null },
    body: "Ready for review.",
    created_at: "2025-06-01T12:00:00Z",
    replies: [],
    ...overrides,
  };
}

function makeCommit(overrides: Partial<PRCommit> = {}): PRCommit {
  return {
    hash: "abc123def456",
    short_hash: "abc123d",
    message: "Add owl:Thing subclass\n\nExtended description",
    author_name: "Alice",
    author_email: "alice@example.com",
    timestamp: "2025-06-01T11:00:00Z",
    ...overrides,
  };
}

const mockApi = pullRequestsApi as unknown as {
  get: ReturnType<typeof vi.fn>;
  listReviews: ReturnType<typeof vi.fn>;
  listComments: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  getCommits: ReturnType<typeof vi.fn>;
  getDiff: ReturnType<typeof vi.fn>;
};

function setupSuccessfulLoad(
  pr: PullRequest = makePR(),
  reviews: Review[] = [],
  comments: Comment[] = []
) {
  mockApi.get.mockResolvedValue(pr);
  mockApi.listReviews.mockResolvedValue({ items: reviews, total: reviews.length });
  mockApi.listComments.mockResolvedValue({ items: comments, total: comments.length });
}

describe("PRDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading spinner initially", () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    const { container } = render(<PRDetail projectId="proj-1" prNumber={7} />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("shows error message when API call fails", async () => {
    mockApi.get.mockRejectedValue(new Error("Network failure"));
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Network failure")).toBeDefined();
    });
  });

  it("shows 'Pull request not found' when PR is null and no error", async () => {
    mockApi.get.mockResolvedValue(null);
    mockApi.listReviews.mockResolvedValue({ items: [], total: 0 });
    mockApi.listComments.mockResolvedValue({ items: [], total: 0 });
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Pull request not found")).toBeDefined();
    });
  });

  it("renders PR title and number", async () => {
    setupSuccessfulLoad();
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Add owl:Thing subclass")).toBeDefined();
      expect(screen.getByText("#7")).toBeDefined();
    });
  });

  it("renders Open status badge for open PRs", async () => {
    setupSuccessfulLoad(makePR({ status: "open" }));
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Open")).toBeDefined();
    });
  });

  it("renders Merged status badge for merged PRs", async () => {
    setupSuccessfulLoad(makePR({ status: "merged", merged_at: "2025-06-05T10:00:00Z" }));
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Merged")).toBeDefined();
    });
  });

  it("renders Closed status badge for closed PRs", async () => {
    setupSuccessfulLoad(makePR({ status: "closed" }));
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Closed")).toBeDefined();
    });
  });

  it("shows branch names", async () => {
    setupSuccessfulLoad();
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("feature/thing")).toBeDefined();
      expect(screen.getByText("main")).toBeDefined();
    });
  });

  it("shows author name", async () => {
    setupSuccessfulLoad();
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeDefined();
    });
  });

  it("falls back to author_id when author name is absent", async () => {
    setupSuccessfulLoad(makePR({ author: undefined, author_id: "uid-xyz" }));
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("uid-xyz")).toBeDefined();
    });
  });

  it("shows merged date for merged PRs", async () => {
    setupSuccessfulLoad(
      makePR({ status: "merged", merged_at: "2025-06-05T10:00:00Z" })
    );
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText(/merged/)).toBeDefined();
    });
  });

  it("shows opened date for open PRs", async () => {
    setupSuccessfulLoad(makePR({ status: "open" }));
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText(/opened/)).toBeDefined();
    });
  });

  it("renders PR description when present", async () => {
    setupSuccessfulLoad(makePR({ description: "Some details here." }));
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Some details here.")).toBeDefined();
    });
  });

  it("does not render description block when absent", async () => {
    setupSuccessfulLoad(makePR({ description: undefined }));
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Add owl:Thing subclass")).toBeDefined();
    });
    expect(screen.queryByText("Some details here.")).toBeNull();
  });

  it("renders PRActions", async () => {
    setupSuccessfulLoad();
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByTestId("pr-actions")).toBeDefined();
    });
  });

  it("defaults to conversation tab", async () => {
    setupSuccessfulLoad(makePR(), [], [makeComment()]);
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Comments")).toBeDefined();
      expect(screen.getByTestId("pr-comment-thread")).toBeDefined();
    });
  });

  it("shows comment count badge on conversation tab", async () => {
    const comments = [makeComment(), makeComment({ id: "comment-2" })];
    setupSuccessfulLoad(makePR(), [], comments);
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("2")).toBeDefined();
    });
  });

  it("shows commits ahead count badge on commits tab", async () => {
    setupSuccessfulLoad(makePR({ commits_ahead: 5 }));
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("5")).toBeDefined();
    });
  });

  it("switches to commits tab and loads commits", async () => {
    setupSuccessfulLoad();
    const commits = [makeCommit({ message: "Implement subclass hierarchy\n\nDetailed changes" })];
    mockApi.getCommits.mockResolvedValue({ items: commits, total: 1 });

    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Commits")).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Commits"));
    });

    await waitFor(() => {
      expect(mockApi.getCommits).toHaveBeenCalledWith("proj-1", 7);
      expect(screen.getByText("Implement subclass hierarchy")).toBeDefined();
      expect(screen.getAllByText("abc123d").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows 'No commits found' when commits list is empty", async () => {
    setupSuccessfulLoad();
    mockApi.getCommits.mockResolvedValue({ items: [], total: 0 });

    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => screen.getByText("Commits"));

    await act(async () => {
      fireEvent.click(screen.getByText("Commits"));
    });

    await waitFor(() => {
      expect(screen.getByText("No commits found")).toBeDefined();
    });
  });

  it("switches to files tab and loads diff", async () => {
    setupSuccessfulLoad();
    const diffData: PRDiffResponse = {
      files: [
        {
          path: "ontology.ttl",
          change_type: "modified",
          old_path: null,
          additions: 10,
          deletions: 2,
          patch: "+added line\n-removed line",
        },
      ],
      total_additions: 10,
      total_deletions: 2,
      files_changed: 1,
    };
    mockApi.getDiff.mockResolvedValue(diffData);

    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => screen.getByText("Files Changed"));

    await act(async () => {
      fireEvent.click(screen.getByText("Files Changed"));
    });

    await waitFor(() => {
      expect(mockApi.getDiff).toHaveBeenCalledWith("proj-1", 7);
      expect(screen.getAllByText("1 file changed").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("+10").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("-2").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("ontology.ttl").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows plural 'files changed' for multiple files", async () => {
    setupSuccessfulLoad();
    const diffData: PRDiffResponse = {
      files: [
        { path: "a.ttl", change_type: "added", old_path: null, additions: 1, deletions: 0, patch: null },
        { path: "b.ttl", change_type: "modified", old_path: null, additions: 2, deletions: 1, patch: null },
      ],
      total_additions: 3,
      total_deletions: 1,
      files_changed: 2,
    };
    mockApi.getDiff.mockResolvedValue(diffData);

    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => screen.getByText("Files Changed"));

    await act(async () => {
      fireEvent.click(screen.getByText("Files Changed"));
    });

    await waitFor(() => {
      expect(screen.getByText("2 files changed")).toBeDefined();
    });
  });

  it("shows 'No file changes found' when diff is empty", async () => {
    setupSuccessfulLoad();
    mockApi.getDiff.mockResolvedValue({
      files: [],
      total_additions: 0,
      total_deletions: 0,
      files_changed: 0,
    });

    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => screen.getByText("Files Changed"));

    await act(async () => {
      fireEvent.click(screen.getByText("Files Changed"));
    });

    await waitFor(() => {
      expect(screen.getByText("No file changes found")).toBeDefined();
    });
  });

  it("renders reviews in conversation tab", async () => {
    const reviews = [
      makeReview({ status: "approved", body: "Looks good!", reviewer: { id: "u2", name: "Bob", email: null } }),
    ];
    setupSuccessfulLoad(makePR(), reviews, []);
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("Reviews")).toBeDefined();
      expect(screen.getByText("Bob")).toBeDefined();
      expect(screen.getByText("approved")).toBeDefined();
      expect(screen.getByText("Looks good!")).toBeDefined();
    });
  });

  it("shows 'requested changes' status text for changes_requested reviews", async () => {
    const reviews = [
      makeReview({ status: "changes_requested", reviewer: { id: "u2", name: "Bob", email: null } }),
    ];
    setupSuccessfulLoad(makePR(), reviews, []);
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("requested changes")).toBeDefined();
    });
  });

  it("shows 'commented' status text for commented reviews", async () => {
    const reviews = [
      makeReview({ status: "commented" as Review["status"], reviewer: { id: "u2", name: "Bob", email: null } }),
    ];
    setupSuccessfulLoad(makePR(), reviews, []);
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByText("commented")).toBeDefined();
    });
  });

  it("shows the comment form", async () => {
    setupSuccessfulLoad(makePR(), [], []);
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Leave a comment...")).toBeDefined();
      expect(screen.getByText("Comment")).toBeDefined();
    });
  });

  it("submits a new comment and reloads comments", async () => {
    setupSuccessfulLoad(makePR(), [], []);
    mockApi.createComment.mockResolvedValue(makeComment({ body: "New comment" }));
    mockApi.listComments.mockResolvedValueOnce({ items: [], total: 0 });
    mockApi.listComments.mockResolvedValue({
      items: [makeComment({ body: "New comment" })],
      total: 1,
    });

    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => screen.getByPlaceholderText("Leave a comment..."));

    const textarea = screen.getByPlaceholderText("Leave a comment...");
    fireEvent.change(textarea, { target: { value: "New comment" } });

    const commentBtn = screen.getByText("Comment");
    await act(async () => {
      fireEvent.click(commentBtn);
    });

    await waitFor(() => {
      expect(mockApi.createComment).toHaveBeenCalledWith(
        "proj-1",
        7,
        { body: "New comment" },
      );
    });
  });

  it("disables comment button when textarea is empty", async () => {
    setupSuccessfulLoad(makePR(), [], []);
    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => screen.getByText("Comment"));

    const commentBtn = screen.getByText("Comment");
    expect(commentBtn.hasAttribute("disabled")).toBe(true);
  });

  it("collapses file diff when header is clicked", async () => {
    setupSuccessfulLoad();
    const diffData: PRDiffResponse = {
      files: [
        {
          path: "ontology.ttl",
          change_type: "modified",
          old_path: null,
          additions: 1,
          deletions: 0,
          patch: "+new line",
        },
      ],
      total_additions: 1,
      total_deletions: 0,
      files_changed: 1,
    };
    mockApi.getDiff.mockResolvedValue(diffData);

    render(<PRDetail projectId="proj-1" prNumber={7} />);
    await waitFor(() => screen.getByText("Files Changed"));

    await act(async () => {
      fireEvent.click(screen.getByText("Files Changed"));
    });

    await waitFor(() => {
      expect(screen.getByText("ontology.ttl")).toBeDefined();
      expect(screen.getByText("+new line")).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByText("ontology.ttl"));
    });

    expect(screen.queryByText("+new line")).toBeNull();
  });
});
