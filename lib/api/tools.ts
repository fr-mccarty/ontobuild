/**
 * Typed client for the project meta-tools API (base /api/v1/projects/:id/tools/...).
 * Types mirror server/tools/componentTree.ts and server/tools/orphans.ts.
 */
import { api } from "./client";

export type ComponentNodeKind = "component" | "module" | "external" | "unknown";

export interface ComponentChild {
  id: string;
  count: number;
  line: number;
}

export interface ComponentNode {
  id: string;
  name: string;
  kind: ComponentNodeKind;
  file: string | null;
  line: number | null;
  exported: boolean;
  source: string | null;
  children: ComponentChild[];
}

export interface ComponentTree {
  nodes: ComponentNode[];
  roots: string[];
  files_scanned: number;
  parse_errors: { file: string; message: string }[];
  truncated: boolean;
}

export type OrphanCategory = "file" | "component" | "class" | "function" | "variable" | "type" | "test" | "script";

export interface OrphanItem {
  id: string;
  category: OrphanCategory;
  name: string;
  file: string;
  line: number | null;
  reason: string;
}

export interface OrphanReport {
  items: OrphanItem[];
  entry_points: string[];
  files_scanned: number;
  parse_errors: { file: string; message: string }[];
  truncated: boolean;
}

const base = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/tools`;

export const toolsApi = {
  componentTree: (projectId: string) => api.get<ComponentTree>(`${base(projectId)}/component-tree`),
  orphans: (projectId: string) => api.get<OrphanReport>(`${base(projectId)}/orphans`),
};
