import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/api/client";
import { projectApi } from "@/lib/api/projects";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function mockOk(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: () => Promise.resolve(JSON.stringify(data)),
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

describe("projectApi", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("list", () => {
    it("calls GET /api/v1/projects with default params", async () => {
      const response = { items: [], total: 0, unfiltered_total: 0, skip: 0, limit: 20 };
      mockOk(response);

      const result = await projectApi.list();
      expect(result).toEqual(response);

      const [url, options] = mockFetch.mock.calls[0];
      expect(options.method).toBe("GET");
      expect(url).toContain("/api/v1/projects");
      expect(url).toContain("skip=0");
      expect(url).toContain("limit=20");
    });

    it("passes paging and search params without a visibility filter", async () => {
      mockOk({ items: [], total: 0, unfiltered_total: 0, skip: 0, limit: 10 });

      await projectApi.list(5, 10, "test");

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("skip=5");
      expect(url).toContain("limit=10");
      expect(url).not.toContain("filter=");
      expect(url).toContain("search=test");
    });

    it("omits search param when empty string", async () => {
      mockOk({ items: [], total: 0, unfiltered_total: 0, skip: 0, limit: 20 });

      await projectApi.list(0, 20, "");

      const [url] = mockFetch.mock.calls[0];
      expect(url).not.toContain("search=");
    });

    it("throws ApiError on failure after retrying", async () => {
      mockError(500, "Internal Server Error", "Server error");
      mockError(500, "Internal Server Error", "Server error");
      mockError(500, "Internal Server Error", "Server error");

      await expect(projectApi.list()).rejects.toThrow(ApiError);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("get", () => {
    it("calls GET /api/v1/projects/:id", async () => {
      const project = { id: "p1", name: "Test" };
      mockOk(project);

      const result = await projectApi.get("p1");
      expect(result).toEqual(project);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1");
      expect(options.method).toBe("GET");
    });
  });

  describe("create", () => {
    it("calls POST /api/v1/projects with body", async () => {
      const project = { id: "p1", name: "New" };
      mockOk(project);

      const result = await projectApi.create({ name: "New" });
      expect(result).toEqual(project);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ name: "New" });
    });
  });

  describe("update", () => {
    it("calls PATCH /api/v1/projects/:id", async () => {
      const updated = { id: "p1", name: "Updated" };
      mockOk(updated);

      const result = await projectApi.update("p1", { name: "Updated" });
      expect(result).toEqual(updated);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1");
      expect(options.method).toBe("PATCH");
      expect(JSON.parse(options.body)).toEqual({ name: "Updated" });
    });
  });

  describe("delete", () => {
    it("calls DELETE /api/v1/projects/:id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(""),
      });

      await projectApi.delete("p1");

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/p1");
      expect(options.method).toBe("DELETE");
    });
  });

  describe("import", () => {
    it("calls POST /api/v1/projects/import with FormData", async () => {
      const importResp = { id: "p1", name: "Imported", file_path: "/tmp/ont.ttl" };
      mockOk(importResp);

      const file = new File(["content"], "ontology.ttl", { type: "text/turtle" });
      const result = await projectApi.import(
        { file, is_public: true, name: "My Ont" }
      );
      expect(result).toEqual(importResp);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/v1/projects/import");
      expect(options.method).toBe("POST");
      expect(options.body).toBeInstanceOf(FormData);

      const formData = options.body as FormData;
      const fileEntry = formData.get("file") as File;
      expect(fileEntry).toBeInstanceOf(File);
      expect(fileEntry.name).toBe("ontology.ttl");
      expect(fileEntry.type).toBe("text/turtle");
      expect(formData.get("is_public")).toBe("true");
      expect(formData.get("name")).toBe("My Ont");
    });
  });
});
