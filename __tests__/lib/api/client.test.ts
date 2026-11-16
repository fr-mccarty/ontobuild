import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  api,
  ApiError,
  projectOntologyApi,
} from "@/lib/api/client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("ApiError", () => {
  it("creates error with status and statusText", () => {
    const error = new ApiError(404, "Not Found", "Resource not found");
    expect(error.status).toBe(404);
    expect(error.statusText).toBe("Not Found");
    expect(error.message).toBe("Resource not found");
    expect(error.name).toBe("ApiError");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("api.get", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("makes GET request and returns data", async () => {
    const data = { id: "1", name: "Test" };
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(data)),
    });

    const result = await api.get("/api/v1/test");
    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/test");
    expect(options.method).toBe("GET");
  });

  it("throws ApiError on non-OK response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("Not found"),
    });

    await expect(api.get("/api/v1/missing")).rejects.toThrow(ApiError);
  });

  it("handles empty response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(""),
    });

    const result = await api.get("/api/v1/empty");
    expect(result).toBeUndefined();
  });

  it("appends query parameters", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("{}"),
    });

    await api.get("/api/v1/test", {
      params: { page: 1, q: "search", empty: undefined },
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("page=1");
    expect(url).toContain("q=search");
    expect(url).not.toContain("empty");
  });
});

describe("api.post", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("makes POST request with JSON body", async () => {
    const responseData = { id: "1" };
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(responseData)),
    });

    const result = await api.post("/api/v1/items", { name: "New Item" });
    expect(result).toEqual(responseData);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify({ name: "New Item" }));
  });

  it("sends POST without body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("{}"),
    });

    await api.post("/api/v1/action");
    const [, options] = mockFetch.mock.calls[0];
    expect(options.body).toBeUndefined();
  });
});

describe("api.put", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("makes PUT request", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("{}"),
    });

    await api.put("/api/v1/items/1", { name: "Updated" });
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("PUT");
  });
});

describe("api.delete", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("makes DELETE request", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(""),
    });

    await api.delete("/api/v1/items/1");
    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("DELETE");
  });
});

describe("request retry logic", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries up to 2 times on 5xx errors then throws", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: () => Promise.resolve("server error"),
    });

    const promise = api.get("/api/v1/fail");

    let caughtError: unknown;
    const handled = promise.catch((e) => {
      caughtError = e;
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await handled;

    expect(caughtError).toBeInstanceOf(ApiError);
    expect((caughtError as ApiError).message).toBe("server error");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 4xx errors", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      text: () => Promise.resolve("validation error"),
    });

    const promise = api.get("/api/v1/bad-request");
    await expect(promise).rejects.toThrow(ApiError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("succeeds on second attempt after initial 5xx", async () => {
    const successData = { ok: true };
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("first fail"),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(successData)),
      });

    const promise = api.get("/api/v1/flaky");

    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toEqual(successData);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("api.patch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("makes PATCH request with JSON body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ updated: true })),
    });

    const result = await api.patch("/api/v1/items/1", { name: "Patched" });
    expect(result).toEqual({ updated: true });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("PATCH");
    expect(options.body).toBe(JSON.stringify({ name: "Patched" }));
  });
});

describe("api.upload", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("uploads FormData and returns parsed response", async () => {
    const responseData = { id: "file-1", filename: "test.ttl" };
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(responseData)),
    });

    const formData = new FormData();
    formData.append("file", new Blob(["content"]), "test.ttl");

    const result = await api.upload("/api/v1/upload", formData);
    expect(result).toEqual(responseData);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/upload");
    expect(options.method).toBe("POST");
    expect(options.body).toBe(formData);
    const headers = options.headers as Headers;
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("throws ApiError on upload failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 413,
      statusText: "Payload Too Large",
      text: () => Promise.resolve("File too large"),
    });

    const formData = new FormData();
    await expect(api.upload("/api/v1/upload", formData)).rejects.toThrow(ApiError);
  });

  it("handles empty response from upload", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(""),
    });

    const formData = new FormData();
    const result = await api.upload("/api/v1/upload", formData);
    expect(result).toBeUndefined();
  });

  it("passes query params through to upload URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("{}"),
    });

    const formData = new FormData();
    await api.upload("/api/v1/upload", formData, {
      params: { branch: "dev" },
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("branch=dev");
  });
});

class MockXHR {
  static instances: MockXHR[] = [];

  status = 0;
  statusText = "";
  responseText = "";
  timeout = 0;
  upload = {
    listeners: {} as Record<string, ((e: Partial<ProgressEvent>) => void)[]>,
    addEventListener(type: string, fn: (e: Partial<ProgressEvent>) => void) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    },
    dispatchEvent(type: string, event: Partial<ProgressEvent> = {}) {
      (this.listeners[type] || []).forEach((fn) => fn(event));
    },
  };

  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  constructor() {
    MockXHR.instances.push(this);
  }

  open = vi.fn();
  send = vi.fn();
  setRequestHeader = vi.fn();

  addEventListener(type: string, fn: (...args: unknown[]) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  dispatchEvent(type: string) {
    (this.listeners[type] || []).forEach((fn) => fn());
  }
}

describe("api.uploadWithProgress", () => {
  const OriginalXHR = globalThis.XMLHttpRequest;

  beforeEach(() => {
    mockFetch.mockReset();
    MockXHR.instances = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.XMLHttpRequest = MockXHR as any;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = OriginalXHR;
  });

  it("resolves with parsed JSON on success", async () => {
    const formData = new FormData();
    const promise = api.uploadWithProgress("/api/v1/upload", formData);

    const xhr = MockXHR.instances[0];
    expect(xhr.open).toHaveBeenCalledWith("POST", expect.stringContaining("/api/v1/upload"));
    expect(xhr.send).toHaveBeenCalledWith(formData);

    xhr.status = 200;
    xhr.responseText = JSON.stringify({ id: "1" });
    xhr.dispatchEvent("load");

    await expect(promise).resolves.toEqual({ id: "1" });
  });

  it("resolves undefined for empty response body", async () => {
    const formData = new FormData();
    const promise = api.uploadWithProgress("/api/v1/upload", formData);

    const xhr = MockXHR.instances[0];
    xhr.status = 200;
    xhr.responseText = "";
    xhr.dispatchEvent("load");

    await expect(promise).resolves.toBeUndefined();
  });

  it("resolves undefined for non-JSON response body", async () => {
    const formData = new FormData();
    const promise = api.uploadWithProgress("/api/v1/upload", formData);

    const xhr = MockXHR.instances[0];
    xhr.status = 200;
    xhr.responseText = "not-json";
    xhr.dispatchEvent("load");

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with ApiError on non-2xx response", async () => {
    const formData = new FormData();
    const promise = api.uploadWithProgress("/api/v1/upload", formData);

    const xhr = MockXHR.instances[0];
    xhr.status = 500;
    xhr.statusText = "Internal Server Error";
    xhr.responseText = "server broke";
    xhr.dispatchEvent("load");

    await expect(promise).rejects.toThrow(ApiError);
    await expect(promise).rejects.toThrow("server broke");
  });

  it("calls onProgress during upload and switches to processing phase on load", async () => {
    const onProgress = vi.fn();
    const formData = new FormData();
    const promise = api.uploadWithProgress("/api/v1/upload", formData, {
      onProgress,
    });

    const xhr = MockXHR.instances[0];

    xhr.upload.dispatchEvent("progress", {
      lengthComputable: true,
      loaded: 50,
      total: 100,
    });
    expect(onProgress).toHaveBeenCalledWith({
      loaded: 50,
      total: 100,
      percentage: 50,
      phase: "uploading",
    });

    xhr.upload.dispatchEvent("load", {});
    expect(onProgress).toHaveBeenCalledWith({
      loaded: 100,
      total: 100,
      percentage: 100,
      phase: "processing",
    });

    xhr.status = 200;
    xhr.responseText = "{}";
    xhr.dispatchEvent("load");
    await promise;
  });

  it("does not call onProgress when lengthComputable is false", async () => {
    const onProgress = vi.fn();
    const formData = new FormData();
    const promise = api.uploadWithProgress("/api/v1/upload", formData, {
      onProgress,
    });

    const xhr = MockXHR.instances[0];

    xhr.upload.dispatchEvent("progress", {
      lengthComputable: false,
      loaded: 50,
      total: 0,
    });
    expect(onProgress).not.toHaveBeenCalled();

    xhr.status = 200;
    xhr.responseText = "{}";
    xhr.dispatchEvent("load");
    await promise;
  });

  it("rejects with network error message when server is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const formData = new FormData();
    const promise = api.uploadWithProgress("/api/v1/upload", formData);

    const xhr = MockXHR.instances[0];
    xhr.dispatchEvent("error");

    await expect(promise).rejects.toThrow(ApiError);
    await expect(promise).rejects.toThrow("Could not reach the server");
  });

  it("rejects with server error message when server is reachable but CORS blocked", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const formData = new FormData();
    const promise = api.uploadWithProgress("/api/v1/upload", formData);

    const xhr = MockXHR.instances[0];
    xhr.dispatchEvent("error");

    await expect(promise).rejects.toThrow(ApiError);
    await expect(promise).rejects.toThrow("server encountered an error");
  });

  it("rejects with timeout error", async () => {
    const formData = new FormData();
    const promise = api.uploadWithProgress("/api/v1/upload", formData);

    const xhr = MockXHR.instances[0];
    xhr.dispatchEvent("timeout");

    await expect(promise).rejects.toThrow(ApiError);
    await expect(promise).rejects.toThrow("timed out");
  });

  it("rejects with abort error", async () => {
    const formData = new FormData();
    const promise = api.uploadWithProgress("/api/v1/upload", formData);

    const xhr = MockXHR.instances[0];
    xhr.dispatchEvent("abort");

    await expect(promise).rejects.toThrow(ApiError);
    await expect(promise).rejects.toThrow("cancelled");
  });

  it("sets custom headers but skips Content-Type", async () => {
    const formData = new FormData();
    api.uploadWithProgress("/api/v1/upload", formData, {
      headers: {
        Authorization: "Bearer tok",
        "Content-Type": "should-be-skipped",
        "X-Custom": "value",
      },
    });

    const xhr = MockXHR.instances[0];
    expect(xhr.setRequestHeader).not.toHaveBeenCalledWith("Authorization", "Bearer tok");
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("X-Custom", "value");
    expect(xhr.setRequestHeader).not.toHaveBeenCalledWith(
      "Content-Type",
      expect.anything()
    );
  });

  it("sets 5-minute timeout on XHR", () => {
    const formData = new FormData();
    api.uploadWithProgress("/api/v1/upload", formData);

    const xhr = MockXHR.instances[0];
    expect(xhr.timeout).toBe(300000);
  });
});

describe("projectOntologyApi", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("{}"),
    });
  });

  it("getRootClasses with token and branch", async () => {
    await projectOntologyApi.getRootClasses("p1", "tok123", "dev");
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/projects/p1/ontology/tree");
    expect(url).toContain("branch=dev");
    const headers = options.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("getRootClasses without token omits Authorization header", async () => {
    await projectOntologyApi.getRootClasses("p1");
    const [, options] = mockFetch.mock.calls[0];
    const headers = options.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("getClassChildren encodes classIri and includes branch", async () => {
    await projectOntologyApi.getClassChildren("p1", "http://ex.org/C", "tok", "main");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain(encodeURIComponent("http://ex.org/C"));
    expect(url).toContain("/children");
    expect(url).toContain("branch=main");
  });

  it("getClassAncestors calls correct endpoint", async () => {
    await projectOntologyApi.getClassAncestors("p1", "http://ex.org/C", "tok", "main");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/ancestors");
  });

  it("getClassDetail calls correct endpoint", async () => {
    await projectOntologyApi.getClassDetail("p1", "http://ex.org/C", "tok", "main");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/projects/p1/ontology/classes/");
    expect(url).toContain(encodeURIComponent("http://ex.org/C"));
  });

  it("searchEntities passes query and entityTypes", async () => {
    await projectOntologyApi.searchEntities("p1", "Person", "tok", "main", "class");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/projects/p1/ontology/search");
    expect(url).toContain("q=Person");
    expect(url).toContain("branch=main");
    expect(url).toContain("entity_types=class");
  });

  it("updateClass sends PATCH with auth and data", async () => {
    const data = {
      labels: [{ value: "Test" }],
      comments: [],
      parent_iris: [],
    };
    await projectOntologyApi.updateClass("p1", "http://ex.org/C", data, "update labels", "tok", "dev");
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/projects/p1/ontology/classes/");
    expect(url).toContain("branch=dev");
    expect(options.method).toBe("PATCH");
    const body = JSON.parse(options.body as string);
    expect(body.commit_message).toBe("update labels");
    expect(body.labels).toEqual([{ value: "Test" }]);
    const headers = options.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("deleteClass sends DELETE with commit_message param", async () => {
    await projectOntologyApi.deleteClass("p1", "http://ex.org/C", "remove class", "tok", "dev");
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain(encodeURIComponent("http://ex.org/C"));
    expect(url).toContain("commit_message=remove+class");
    expect(url).toContain("branch=dev");
    expect(options.method).toBe("DELETE");
    const headers = options.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });

  it("reindex sends POST with auth", async () => {
    await projectOntologyApi.reindex("p1", "tok", "main");
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/projects/p1/ontology/reindex");
    expect(url).toContain("branch=main");
    expect(options.method).toBe("POST");
  });

  it("getIndexStatus calls correct endpoint", async () => {
    await projectOntologyApi.getIndexStatus("p1", "tok", "main");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/projects/p1/ontology/index-status");
    expect(url).toContain("branch=main");
  });

  it("saveSource sends PUT with content and commit message", async () => {
    await projectOntologyApi.saveSource("p1", "@prefix ex: <http://ex.org/> .", "save source", "tok", "dev");
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/projects/p1/source");
    expect(url).toContain("branch=dev");
    expect(options.method).toBe("PUT");
    const body = JSON.parse(options.body as string);
    expect(body.content).toBe("@prefix ex: <http://ex.org/> .");
    expect(body.commit_message).toBe("save source");
    const headers = options.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });
});
