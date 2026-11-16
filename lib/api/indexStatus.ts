import { projectOntologyApi, type IndexStatus } from "@/lib/api/client";

export interface IndexStatusEvent {
  type: "index_started" | "index_complete" | "index_failed";
  project_id: string;
  branch?: string;
  entity_count?: number;
  error?: string;
}

export const INDEX_POLL_INTERVAL_MS = 3000;

export class IndexStatusPoller {
  private projectId: string;
  private onMessage: (message: IndexStatusEvent) => void;
  private branch?: string;
  private intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastStatus: IndexStatus | null = null;
  private active = false;

  constructor(
    projectId: string,
    onMessage: (message: IndexStatusEvent) => void,
    options: { branch?: string; intervalMs?: number } = {}
  ) {
    this.projectId = projectId;
    this.onMessage = onMessage;
    this.branch = options.branch;
    this.intervalMs = options.intervalMs ?? INDEX_POLL_INTERVAL_MS;
  }

  connect(): void {
    if (this.active) return;
    this.active = true;
    void this.poll();
  }

  disconnect(): void {
    this.active = false;
    this.lastStatus = null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (!this.active) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, this.intervalMs);
  }

  private async poll(): Promise<void> {
    try {
      const status = await projectOntologyApi.getIndexStatus(this.projectId, this.branch);
      if (!this.active) return;
      const prev = this.lastStatus;
      this.lastStatus = status.status;
      const base = { project_id: this.projectId, branch: status.branch ?? this.branch };
      if (status.status === "indexing" && prev !== "indexing") {
        this.onMessage({ type: "index_started", ...base });
      } else if (prev === "indexing" && status.status === "ready") {
        this.onMessage({
          type: "index_complete",
          ...base,
          entity_count: status.entity_count ?? undefined,
        });
      } else if (prev === "indexing" && status.status === "failed") {
        this.onMessage({
          type: "index_failed",
          ...base,
          error: status.error_message ?? undefined,
        });
      }
    } catch {
    } finally {
      this.schedule();
    }
  }
}
