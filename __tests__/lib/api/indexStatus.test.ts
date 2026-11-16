import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getIndexStatus = vi.fn();
vi.mock("@/lib/api/client", () => ({
  projectOntologyApi: { getIndexStatus: (...args: unknown[]) => getIndexStatus(...args) },
}));

import { IndexStatusPoller } from "@/lib/api/indexStatus";

function status(s: string, extra: Record<string, unknown> = {}) {
  return {
    project_id: "p1",
    branch: "main",
    status: s,
    entity_count: 5,
    commit_hash: "abc",
    error_message: null,
    indexed_at: null,
    ...extra,
  };
}

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("IndexStatusPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getIndexStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls index-status for the project on connect", async () => {
    getIndexStatus.mockResolvedValue(status("ready"));
    const manager = new IndexStatusPoller("p1", vi.fn(), { intervalMs: 1000 });
    manager.connect();
    await flush();
    expect(getIndexStatus).toHaveBeenCalledWith("p1", undefined);
    manager.disconnect();
  });

  it("does not emit when the index is already ready", async () => {
    getIndexStatus.mockResolvedValue(status("ready"));
    const onMessage = vi.fn();
    const manager = new IndexStatusPoller("p1", onMessage, { intervalMs: 1000 });
    manager.connect();
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(onMessage).not.toHaveBeenCalled();
    manager.disconnect();
  });

  it("emits index_started then index_complete on transitions", async () => {
    getIndexStatus
      .mockResolvedValueOnce(status("ready"))
      .mockResolvedValueOnce(status("indexing"))
      .mockResolvedValueOnce(status("indexing"))
      .mockResolvedValue(status("ready", { entity_count: 9 }));
    const onMessage = vi.fn();
    const manager = new IndexStatusPoller("p1", onMessage, { intervalMs: 1000 });
    manager.connect();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onMessage).toHaveBeenCalledWith({ type: "index_started", project_id: "p1", branch: "main" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onMessage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onMessage).toHaveBeenLastCalledWith({
      type: "index_complete",
      project_id: "p1",
      branch: "main",
      entity_count: 9,
    });
    manager.disconnect();
  });

  it("emits index_failed with the error message", async () => {
    getIndexStatus
      .mockResolvedValueOnce(status("indexing"))
      .mockResolvedValue(status("failed", { error_message: "boom" }));
    const onMessage = vi.fn();
    const manager = new IndexStatusPoller("p1", onMessage, { intervalMs: 1000 });
    manager.connect();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onMessage).toHaveBeenLastCalledWith({
      type: "index_failed",
      project_id: "p1",
      branch: "main",
      error: "boom",
    });
    manager.disconnect();
  });

  it("keeps polling after errors and stops after disconnect", async () => {
    getIndexStatus.mockRejectedValueOnce(new Error("404")).mockResolvedValue(status("ready"));
    const manager = new IndexStatusPoller("p1", vi.fn(), { intervalMs: 1000 });
    manager.connect();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(getIndexStatus).toHaveBeenCalledTimes(2);
    manager.disconnect();
    await vi.advanceTimersByTimeAsync(5000);
    expect(getIndexStatus).toHaveBeenCalledTimes(2);
  });

  it("connect is idempotent", async () => {
    getIndexStatus.mockResolvedValue(status("ready"));
    const manager = new IndexStatusPoller("p1", vi.fn(), { intervalMs: 1000 });
    manager.connect();
    manager.connect();
    await flush();
    expect(getIndexStatus).toHaveBeenCalledTimes(1);
    manager.disconnect();
  });
});
