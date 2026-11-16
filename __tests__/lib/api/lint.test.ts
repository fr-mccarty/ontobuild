import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  lintApi,
  isLintRunActive,
  waitForLintRun,
  type LintConfig,
} from "@/lib/api/lint";

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

describe("lintApi", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("triggerLint", () => {
    it("calls POST /api/v1/projects/:id/lint/run", async () => {
      const response = { job_id: "j1", status: "queued", message: "Lint started" };
      mockOk(response);

      const result = await lintApi.triggerLint("p1");
      expect(result).toEqual(response);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/run");
      expect(options.method).toBe("POST");
    });

    it("throws ApiError on 403 with correct status", async () => {
      mockError(403, "Forbidden", "Not authorized");

      try {
        await lintApi.triggerLint("p1");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(403);
      }
    });
  });

  describe("getStatus", () => {
    it("calls GET /api/v1/projects/:id/lint/status", async () => {
      const summary = {
        project_id: "p1",
        last_run: null,
        error_count: 0,
        warning_count: 0,
        info_count: 0,
        total_issues: 0,
      };
      mockOk(summary);

      const result = await lintApi.getStatus("p1");
      expect(result).toEqual(summary);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/status");
    });
  });

  describe("listRuns", () => {
    it("calls GET /api/v1/projects/:id/lint/runs with pagination", async () => {
      mockOk({ items: [], total: 0, skip: 5, limit: 10 });

      await lintApi.listRuns("p1", { skip: 5, limit: 10 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/runs");
      expect(url).toContain("skip=5");
      expect(url).toContain("limit=10");
    });

    it("works without options", async () => {
      mockOk({ items: [], total: 0, skip: 0, limit: 20 });

      await lintApi.listRuns("p1");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/runs");
    });
  });

  describe("getRun", () => {
    it("calls GET /api/v1/projects/:id/lint/runs/:runId", async () => {
      const run = { id: "r1", project_id: "p1", status: "completed", issues: [] };
      mockOk(run);

      const result = await lintApi.getRun("p1", "r1");
      expect(result).toEqual(run);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/runs/r1");
    });
  });

  describe("getIssues", () => {
    it("calls GET /api/v1/projects/:id/lint/issues with filters", async () => {
      mockOk({ items: [], total: 0, skip: 0, limit: 50 });

      await lintApi.getIssues("p1", {
        issue_type: "error",
        rule_id: "R001",
        include_resolved: true,
        skip: 0,
        limit: 50,
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/issues");
      expect(url).toContain("issue_type=error");
      expect(url).toContain("rule_id=R001");
      expect(url).toContain("include_resolved=true");
    });

    it("works without options", async () => {
      mockOk({ items: [], total: 0, skip: 0, limit: 20 });

      await lintApi.getIssues("p1");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/issues");
    });

    it("passes subject_iri filter with full encoded value", async () => {
      mockOk({ items: [], total: 0, skip: 0, limit: 20 });

      await lintApi.getIssues("p1", { subject_iri: "http://example.org/Class1" });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("subject_iri=" + encodeURIComponent("http://example.org/Class1"));
    });
  });

  describe("dismissIssue", () => {
    it("calls DELETE /api/v1/projects/:id/lint/issues/:issueId", async () => {
      mockEmpty();

      await lintApi.dismissIssue("p1", "i1");

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/issues/i1");
      expect(options.method).toBe("DELETE");
    });
  });

  describe("getRules", () => {
    it("calls GET /api/v1/projects/lint/rules", async () => {
      const rules = {
        rules: [
          { rule_id: "R001", name: "Missing label", description: "Class has no label", severity: "warning", scope: ["class", "property", "individual"] },
        ],
      };
      mockOk(rules);

      const result = await lintApi.getRules();
      expect(result).toEqual(rules);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/lint/rules");
      expect(options.method).toBe("GET");
    });
  });

  describe("getLintConfig", () => {
    it("calls GET /api/v1/projects/:id/lint/config", async () => {
      const config = { config: { lint_level: 2, enabled_rules: ["R001", "R002"] } };
      mockOk(config);

      const result = await lintApi.getLintConfig("p1");
      expect(result).toEqual(config);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/config");
      expect(options.method).toBe("GET");
    });
  });

  describe("updateLintConfig", () => {
    it("calls PUT /api/v1/projects/:id/lint/config with config body", async () => {
      const config: LintConfig = { lint_level: null, enabled_rules: ["R001"] };
      const response = { config };
      mockOk(response);

      const result = await lintApi.updateLintConfig("p1", config);
      expect(result).toEqual(response);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/config");
      expect(options.method).toBe("PUT");

      const body = JSON.parse(options.body);
      expect(body).toEqual(config);
    });

    it("throws ApiError on 404", async () => {
      mockError(404, "Not Found", "Endpoint not available");

      try {
        const config: LintConfig = { lint_level: 2 };
        await lintApi.updateLintConfig("p1", config);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(404);
      }
    });
  });

  describe("getLevels", () => {
    it("calls GET /api/v1/projects/lint/levels", async () => {
      const levels = {
        levels: [
          { level: 1, name: "Critical", description: "Structural errors", rule_ids: ["R001"] },
          { level: 2, name: "Consistency", description: "Orphan classes", rule_ids: ["R001", "R002"] },
        ],
      };
      mockOk(levels);

      const result = await lintApi.getLevels();
      expect(result).toEqual(levels);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/lint/levels");
      expect(options.method).toBe("GET");
    });
  });

  describe("clearResults", () => {
    it("calls DELETE /api/v1/projects/:id/lint/results", async () => {
      mockEmpty();

      await lintApi.clearResults("p1");

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1/lint/results");
      expect(options.method).toBe("DELETE");
    });
  });
});

const runSummary = (status: "pending" | "running" | "completed" | "failed" | null) => ({
  project_id: "p1",
  last_run: status
    ? {
        id: "r1",
        project_id: "p1",
        branch: "main",
        status,
        started_at: "2025-01-01T00:00:00Z",
        completed_at: null,
        issues_found: null,
        error_message: null,
      }
    : null,
  counts_run_id: null,
  error_count: 0,
  warning_count: 0,
  info_count: 0,
  total_issues: 0,
});

describe("isLintRunActive", () => {
  it("is true only for pending/running runs", () => {
    expect(isLintRunActive(runSummary("pending"))).toBe(true);
    expect(isLintRunActive(runSummary("running"))).toBe(true);
    expect(isLintRunActive(runSummary("completed"))).toBe(false);
    expect(isLintRunActive(runSummary("failed"))).toBe(false);
    expect(isLintRunActive(runSummary(null))).toBe(false);
    expect(isLintRunActive(null)).toBe(false);
  });
});

describe("waitForLintRun", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("polls the status endpoint until the run finishes", async () => {
    mockOk(runSummary("pending"));
    mockOk(runSummary("running"));
    mockOk(runSummary("completed"));
    const result = await waitForLintRun("p1", { intervalMs: 1 });
    expect(result?.last_run?.status).toBe("completed");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/projects/p1/lint/status");
  });

  it("returns null when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await waitForLintRun("p1", { signal: controller.signal })).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
