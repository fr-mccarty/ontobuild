import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";
import type { PullRequest } from "@/lib/api/pullRequests";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });

vi.mock("@/lib/api/pullRequests", () => ({
  pullRequestsApi: { get: vi.fn(), merge: vi.fn(), close: vi.fn(), reopen: vi.fn(), createReview: vi.fn() },
}));

vi.mock("@/lib/api/revisions", () => ({
  branchesApi: { list: vi.fn().mockResolvedValue({ items: [] }), delete: vi.fn() },
}));

import { PRActions } from "@/components/pr/PRActions";
import { pullRequestsApi } from "@/lib/api/pullRequests";
import { ApiError } from "@/lib/api/client";

const api = vi.mocked(pullRequestsApi);

const BLOCKED = "Merging would add 2 rule violations to 'main'. Fix them on 'feature' first";

function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: "pr-1",
    project_id: "p1",
    pr_number: 7,
    title: "Add books",
    status: "open",
    source_branch: "feature",
    target_branch: "main",
    approval_count: 1,
    commits_ahead: 2,
    can_merge: true,
    merge_blocked_reason: null,
    rule_violations_added: [],
    ...overrides,
  } as PullRequest;
}

describe("PRActions rule violations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows why merging is blocked and disables the merge button", () => {
    render(<PRActions projectId="p1" pr={makePR({ can_merge: false, merge_blocked_reason: BLOCKED })} onUpdate={vi.fn()} />);
    expect(screen.getByTestId("merge-blocked-reason").textContent).toBe(BLOCKED);
    expect(screen.getByRole("button", { name: "Merge" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the server's refusal and reloads the pull request when the merge returns rule_violations", async () => {
    const blocked = makePR({ can_merge: false, merge_blocked_reason: BLOCKED });
    api.merge.mockRejectedValue(new ApiError(409, "Conflict", JSON.stringify({ detail: BLOCKED, code: "rule_violations" })));
    api.get.mockResolvedValue(blocked);
    const onUpdate = vi.fn();
    render(<PRActions projectId="p1" pr={makePR()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Merge")!);
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(blocked));
    expect(await screen.findByText(BLOCKED)).toBeDefined();
  });
});
