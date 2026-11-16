import { describe, expect, it, beforeEach } from "vitest";
import {
  mockFetch,
  mockOk,
  resetFetch,
} from "@/__tests__/helpers/mockFetch";
import { qualityApi } from "@/lib/api/quality";

describe("qualityApi", () => {
  beforeEach(() => {
    resetFetch();
  });

  describe("getCrossReferences", () => {
    it("fetches cross references for an entity", async () => {
      const data = { incoming: [], outgoing: [] };
      mockOk(data);

      const result = await qualityApi.getCrossReferences(
        "proj-1",
        "http://example.org/Foo"
      );
      expect(result).toEqual(data);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain(
        "/api/v1/projects/proj-1/entities/" +
          encodeURIComponent("http://example.org/Foo") +
          "/references"
      );
      expect(options.method).toBe("GET");
    });

    it("includes branch when provided", async () => {
      mockOk({ incoming: [], outgoing: [] });

      await qualityApi.getCrossReferences(
        "proj-1",
        "http://example.org/Foo",
        "dev"
      );

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("branch=dev");
    });
  });

  describe("triggerConsistencyCheck", () => {
    it("triggers a consistency check", async () => {
      const data = { job_id: "job-1" };
      mockOk(data);

      const result = await qualityApi.triggerConsistencyCheck("proj-1");
      expect(result).toEqual(data);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/proj-1/quality/check");
      expect(options.method).toBe("POST");
    });

    it("includes branch param", async () => {
      mockOk({ job_id: "job-1" });

      await qualityApi.triggerConsistencyCheck("proj-1", "dev");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("branch=dev");
    });
  });

  describe("getConsistencyJobResult", () => {
    it("fetches consistency result by job ID", async () => {
      const data = { project_id: "proj-1", branch: "main", issues: [], checked_at: "", duration_ms: 50 };
      mockOk(data);

      const result = await qualityApi.getConsistencyJobResult("proj-1", "job-1");
      expect(result).toEqual(data);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/proj-1/quality/jobs/job-1");
      expect(options.method).toBe("GET");
    });
  });

  describe("getConsistencyIssues", () => {
    it("fetches consistency issues", async () => {
      const data = { issues: [], total: 0 };
      mockOk(data);

      const result = await qualityApi.getConsistencyIssues("proj-1");
      expect(result).toEqual(data);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/proj-1/quality/issues");
    });
  });

  describe("triggerDuplicateDetection", () => {
    it("triggers duplicate detection and returns job_id", async () => {
      const data = { job_id: "dup-job-1" };
      mockOk(data);

      const result = await qualityApi.triggerDuplicateDetection("proj-1");
      expect(result).toEqual(data);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/proj-1/quality/duplicates");
      expect(options.method).toBe("POST");
      expect(url).toContain("threshold=0.85");
    });

    it("passes custom threshold and branch", async () => {
      mockOk({ job_id: "dup-job-2" });

      await qualityApi.triggerDuplicateDetection("proj-1", "dev", 0.9);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("threshold=0.9");
      expect(url).toContain("branch=dev");
    });
  });

  describe("getDuplicateJobResult", () => {
    it("fetches duplicate detection result by job ID", async () => {
      const data = { clusters: [], threshold: 0.85, checked_at: "" };
      mockOk(data);

      const result = await qualityApi.getDuplicateJobResult("proj-1", "job-1");
      expect(result).toEqual(data);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/proj-1/quality/duplicates/jobs/job-1");
      expect(options.method).toBe("GET");
    });
  });

  describe("getLatestDuplicates", () => {
    it("fetches latest cached duplicate results", async () => {
      const data = { clusters: [], threshold: 0.85, checked_at: "" };
      mockOk(data);

      const result = await qualityApi.getLatestDuplicates("proj-1", "dev");
      expect(result).toEqual(data);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/proj-1/quality/duplicates/latest");
      expect(url).toContain("branch=dev");
    });

    it("omits branch param when not provided", async () => {
      mockOk({ clusters: [], threshold: 0.85, checked_at: "" });

      await qualityApi.getLatestDuplicates("proj-1");

      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain("branch=");
    });
  });
});
