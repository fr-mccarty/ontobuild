/**
 * Provenance of text values: whether each was approved through a pull request.
 * Lookups made in the same tick are sent as one batch request per project and branch.
 */
import { api } from "./client";

export type ProvenanceStatus = "approved" | "direct" | "pending" | "unknown";

export interface ProvenanceItem {
  iri: string;
  property: string;
  value: string;
}

export interface Provenance extends ProvenanceItem {
  status: ProvenanceStatus;
  introduced_in: {
    hash: string;
    short_hash: string;
    message: string;
    author_name: string;
    timestamp: string;
  } | null;
  pull_request: {
    number: number;
    title: string;
    status: string;
    merged_at: string | null;
    merged_by: string | null;
    approvals: { reviewer: string; at: string }[];
  } | null;
  on_default_branch: boolean;
}

const MAX_BATCH = 200;
const BATCH_DELAY_MS = 20;

interface Pending {
  item: ProvenanceItem;
  resolve: (p: Provenance) => void;
  reject: (e: unknown) => void;
}

const queues = new Map<string, Pending[]>();

function base(projectId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/provenance`;
}

async function flush(key: string, projectId: string, branch: string | undefined) {
  const queue = queues.get(key) ?? [];
  queues.delete(key);
  for (let i = 0; i < queue.length; i += MAX_BATCH) {
    const chunk = queue.slice(i, i + MAX_BATCH);
    try {
      const res = await api.post<{ items: Provenance[] }>(`${base(projectId)}/batch`, {
        branch,
        items: chunk.map((p) => p.item),
      });
      chunk.forEach((p, j) => p.resolve(res.items[j]));
    } catch (e) {
      chunk.forEach((p) => p.reject(e));
    }
  }
}

export const provenanceApi = {
  get: (projectId: string, item: ProvenanceItem, branch?: string) =>
    api.get<Provenance>(base(projectId), { params: { ...item, branch } }),

  batch: (projectId: string, items: ProvenanceItem[], branch?: string) =>
    api.post<{ items: Provenance[] }>(`${base(projectId)}/batch`, { branch, items }),

  /** Looks up one value, batched with other lookups made in the same moment. */
  lookup: (projectId: string, item: ProvenanceItem, branch?: string): Promise<Provenance> =>
    new Promise((resolve, reject) => {
      const key = `${projectId}\u0000${branch ?? ""}`;
      let queue = queues.get(key);
      if (!queue) {
        queue = [];
        queues.set(key, queue);
        setTimeout(() => void flush(key, projectId, branch), BATCH_DELAY_MS);
      }
      queue.push({ item, resolve, reject });
    }),
};

/** A short phrase for the agent prompt's source, e.g. "approved in PR #12". */
export function provenanceSummary(p: Provenance | undefined | null): string | null {
  if (!p) return null;
  if (p.status === "approved" && p.pull_request) return `approved in PR #${p.pull_request.number}`;
  if (p.status === "pending") return p.pull_request ? `pending in PR #${p.pull_request.number}` : "not yet in a pull request";
  if (p.status === "direct") return "not approved";
  return null;
}
