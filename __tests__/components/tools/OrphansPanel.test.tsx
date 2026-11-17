import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/__tests__/helpers/renderWithProviders";
import type { OrphanReport } from "@/lib/api/tools";

const orphans = vi.fn();
const componentTree = vi.fn();
vi.mock("@/lib/api/tools", () => ({
  toolsApi: { orphans: (id: string) => orphans(id), componentTree: (id: string) => componentTree(id) },
}));
vi.mock("@/lib/api/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/workspace")>()),
  workspaceApi: (await import("../workspace/workspaceMocks")).workspaceApiMock,
}));
vi.mock("next/dynamic", async () => (await import("../workspace/workspaceMocks")).dynamicMock);

import { OrphansPanel, filterOrphans } from "@/components/tools/orphans/OrphansPanel";
import { ToolsPanel } from "@/components/tools/ToolsPanel";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";
import { workspaceApiMock } from "../workspace/workspaceMocks";

const REPORT: OrphanReport = {
  items: [
    { id: "file:code/src/Old.tsx", category: "file", name: "Old.tsx", file: "code/src/Old.tsx", line: null, reason: "Nothing imports it" },
    { id: "function:code/src/util.ts#pad", category: "function", name: "pad", file: "code/src/util.ts", line: 4, reason: "Exported, but nothing imports it" },
    { id: "variable:code/src/util.ts#LIMIT", category: "variable", name: "LIMIT", file: "code/src/util.ts", line: 1, reason: "Declared, but never used" },
  ],
  entry_points: ["code/src/main.tsx"],
  files_scanned: 12,
  parse_errors: [],
  truncated: false,
};

const optionIds = () => screen.getAllByRole("option").map((o) => o.getAttribute("data-orphan-id"));

describe("OrphansPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orphans.mockResolvedValue(REPORT);
    workspaceApiMock.listFiles.mockResolvedValue({ entries: [{ path: "code/src/util.ts", type: "file", size: 80 }], truncated: false });
    workspaceApiMock.readFile.mockResolvedValue({ path: "code/src/util.ts", content: "export const pad = 1;", size: 80 });
    useWorkspaceStore.setState({ activeTool: "component-tree" });
  });

  it("lists every orphan with counts per kind and filters by kind", async () => {
    renderWithQueryClient(<OrphansPanel projectId="p1" isActive />);
    await screen.findByText("pad");
    expect(optionIds()).toHaveLength(3);
    expect(screen.getByRole("button", { name: "All 3" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Classes 0" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Functions 1" }));
    expect(optionIds()).toEqual(["function:code/src/util.ts#pad"]);
    expect(screen.getByText("src/util.ts:4")).toBeTruthy();
    expect(screen.getByText("Exported, but nothing imports it")).toBeTruthy();
  });

  it("filters by text and opens the file with Enter", async () => {
    renderWithQueryClient(<OrphansPanel projectId="p1" isActive />);
    await screen.findByText("pad");
    const search = screen.getByLabelText("Filter orphans");
    fireEvent.change(search, { target: { value: "never used" } });
    expect(optionIds()).toEqual(["variable:code/src/util.ts#LIMIT"]);
    fireEvent.keyDown(search, { key: "Enter" });
    const dialog = await screen.findByTestId("quickview");
    expect(within(dialog).getByText("util.ts")).toBeTruthy();
  });

  it("moves through the list with the arrow keys", async () => {
    renderWithQueryClient(<OrphansPanel projectId="p1" isActive />);
    await screen.findByText("pad");
    const list = screen.getByRole("listbox");
    act(() => list.focus());
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
  });

  it("shows the entry points the result is based on", async () => {
    renderWithQueryClient(<OrphansPanel projectId="p1" isActive />);
    fireEvent.click(await screen.findByText(/Based on 1 entry point/));
    expect(within(screen.getByRole("list", { name: "Entry points" })).getByText("src/main.tsx")).toBeTruthy();
  });

  it("warns when no entry points were found", async () => {
    orphans.mockResolvedValue({ ...REPORT, entry_points: [] });
    renderWithQueryClient(<OrphansPanel projectId="p1" isActive />);
    expect(await screen.findByText(/No entry points found/)).toBeTruthy();
  });

  it("says so when there are no orphans", async () => {
    orphans.mockResolvedValue({ ...REPORT, items: [] });
    renderWithQueryClient(<OrphansPanel projectId="p1" isActive />);
    expect(await screen.findByText("No orphans found")).toBeTruthy();
  });

  it("does not scan while hidden", () => {
    renderWithQueryClient(<OrphansPanel projectId="p1" isActive={false} />);
    expect(orphans).not.toHaveBeenCalled();
  });

  it("filters items by kind and text", () => {
    expect(filterOrphans(REPORT.items, "file", "").map((i) => i.name)).toEqual(["Old.tsx"]);
    expect(filterOrphans(REPORT.items, "all", "UTIL").map((i) => i.name)).toEqual(["pad", "LIMIT"]);
  });
});

describe("ToolsPanel tool picker", () => {
  it("switches to the Orphans tool", async () => {
    orphans.mockResolvedValue(REPORT);
    componentTree.mockResolvedValue({ nodes: [], roots: [], files_scanned: 0, parse_errors: [], truncated: false });
    useWorkspaceStore.setState({ activeTool: "component-tree" });
    renderWithQueryClient(<ToolsPanel projectId="p1" isActive />);
    fireEvent.change(screen.getByLabelText("Tool"), { target: { value: "orphans" } });
    expect(await screen.findByTestId("orphans-panel")).toBeTruthy();
    expect(useWorkspaceStore.getState().activeTool).toBe("orphans");
  });
});
