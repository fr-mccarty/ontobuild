import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  pullRequestsApi,
  prSettingsApi,
} from "@/lib/api/pullRequests";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockOk(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockEmpty() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: () => Promise.resolve(""),
  });
}

function mockError(status: number, statusText: string, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(body),
  });
}

describe("pullRequestsApi", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("getOpenSummary", () => {
    it("calls GET /api/v1/projects/pull-requests/open-summary", async () => {
      const summary = { total_open: 3, by_project: [] };
      mockOk(summary);

      const result = await pullRequestsApi.getOpenSummary();
      expect(result).toEqual(summary);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/pull-requests/open-summary");
    });
  });

  describe("list", () => {
    it("calls GET with default pagination params", async () => {
      mockOk({ items: [], total: 0, skip: 0, limit: 20 });

      await pullRequestsApi.list("p1");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests");
      expect(url).toContain("skip=0");
      expect(url).toContain("limit=20");
    });

    it("passes status and author_id filters", async () => {
      mockOk({ items: [], total: 0, skip: 0, limit: 10 });

      await pullRequestsApi.list("p1", "open", "user1", 5, 10);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("status=open");
      expect(url).toContain("author_id=user1");
      expect(url).toContain("skip=5");
      expect(url).toContain("limit=10");
    });

    it("throws ApiError on failure", async () => {
      mockError(403, "Forbidden", "Access denied");

      await expect(pullRequestsApi.list("p1")).rejects.toThrow(ApiError);
    });

    it("throws ApiError on mutation failure", async () => {
      mockError(403, "Forbidden", "Access denied");

      try {
        await pullRequestsApi.create("p1", { title: "test", source_branch: "feat", target_branch: "main" });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(403);
      }
    });
  });

  describe("get", () => {
    it("calls GET /api/v1/projects/:id/pull-requests/:number", async () => {
      const pr = { id: "pr1", pr_number: 5, title: "Add class" };
      mockOk(pr);

      const result = await pullRequestsApi.get("p1", 5);
      expect(result).toEqual(pr);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/5");
    });
  });

  describe("create", () => {
    it("calls POST with PR data", async () => {
      const pr = { id: "pr1", title: "New PR" };
      mockOk(pr);

      const result = await pullRequestsApi.create(
        "p1",
        { title: "New PR", source_branch: "feat", target_branch: "main" }
      );
      expect(result).toEqual(pr);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body).title).toBe("New PR");
    });
  });

  describe("update", () => {
    it("calls PATCH with update data", async () => {
      mockOk({ id: "pr1", title: "Updated" });

      await pullRequestsApi.update("p1", 3, { title: "Updated" });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/3");
      expect(options.method).toBe("PATCH");
    });
  });

  describe("close", () => {
    it("calls POST /close endpoint", async () => {
      mockOk({ id: "pr1", status: "closed" });

      await pullRequestsApi.close("p1", 2);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/2/close");
      expect(options.method).toBe("POST");
    });
  });

  describe("reopen", () => {
    it("calls POST /reopen endpoint", async () => {
      mockOk({ id: "pr1", status: "open" });

      await pullRequestsApi.reopen("p1", 2);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/2/reopen");
      expect(options.method).toBe("POST");
    });
  });

  describe("merge", () => {
    it("calls POST /merge with merge data", async () => {
      const mergeResp = { success: true, message: "Merged" };
      mockOk(mergeResp);

      const result = await pullRequestsApi.merge(
        "p1",
        4,
        { merge_message: "Merging", delete_source_branch: true }
      );
      expect(result).toEqual(mergeResp);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/4/merge");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body).delete_source_branch).toBe(true);
    });
  });

  describe("getCommits", () => {
    it("calls GET /commits endpoint", async () => {
      mockOk({ items: [], total: 0 });

      await pullRequestsApi.getCommits("p1", 1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/1/commits");
    });
  });

  describe("getDiff", () => {
    it("calls GET /diff endpoint", async () => {
      mockOk({ files: [], total_additions: 0, total_deletions: 0, files_changed: 0 });

      await pullRequestsApi.getDiff("p1", 1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/1/diff");
    });
  });

  describe("listReviews", () => {
    it("calls GET /reviews endpoint", async () => {
      mockOk({ items: [], total: 0 });

      await pullRequestsApi.listReviews("p1", 1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/1/reviews");
    });
  });

  describe("createReview", () => {
    it("calls POST /reviews with review data", async () => {
      mockOk({ id: "r1", status: "approved" });

      await pullRequestsApi.createReview("p1", 1, { status: "approved", body: "LGTM" });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/1/reviews");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body).status).toBe("approved");
    });
  });

  describe("listComments", () => {
    it("calls GET /comments endpoint", async () => {
      mockOk({ items: [], total: 0 });

      await pullRequestsApi.listComments("p1", 1);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/1/comments");
    });
  });

  describe("createComment", () => {
    it("calls POST /comments with body", async () => {
      mockOk({ id: "c1", body: "Nice work" });

      await pullRequestsApi.createComment("p1", 1, { body: "Nice work" });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/1/comments");
      expect(options.method).toBe("POST");
    });
  });

  describe("updateComment", () => {
    it("calls PATCH /comments/:commentId", async () => {
      mockOk({ id: "c1", body: "Updated" });

      await pullRequestsApi.updateComment("p1", 1, "c1", { body: "Updated" });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/1/comments/c1");
      expect(options.method).toBe("PATCH");
    });
  });

  describe("deleteComment", () => {
    it("calls DELETE /comments/:commentId", async () => {
      mockEmpty();

      await pullRequestsApi.deleteComment("p1", 1, "c1");

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pull-requests/1/comments/c1");
      expect(options.method).toBe("DELETE");
    });
  });
});

describe("prSettingsApi", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("get", () => {
    it("calls GET /pr-settings", async () => {
      mockOk({ pr_approval_required: 1 });

      await prSettingsApi.get("p1");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pr-settings");
    });
  });

  describe("update", () => {
    it("calls PATCH /pr-settings", async () => {
      mockOk({ pr_approval_required: 2 });

      await prSettingsApi.update("p1", { pr_approval_required: 2 });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/pr-settings");
      expect(options.method).toBe("PATCH");
    });
  });
});
