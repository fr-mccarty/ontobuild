import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/__tests__/helpers/renderWithProviders";
import type { ComponentTree } from "@/lib/api/tools";

const componentTree = vi.fn();
vi.mock("@/lib/api/tools", () => ({ toolsApi: { componentTree: (id: string) => componentTree(id), orphans: vi.fn() } }));
vi.mock("@/lib/api/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/workspace")>()),
  workspaceApi: (await import("../workspace/workspaceMocks")).workspaceApiMock,
}));
vi.mock("next/dynamic", async () => (await import("../workspace/workspaceMocks")).dynamicMock);

import { ComponentTreePanel, buildRows } from "@/components/tools/component-tree/ComponentTreePanel";
import { ToolsPanel } from "@/components/tools/ToolsPanel";
import { workspaceApiMock } from "../workspace/workspaceMocks";

const node = (id: string, name: string, children: string[] = [], extra: Partial<ComponentTree["nodes"][number]> = {}) => ({
  id,
  name,
  kind: "component" as const,
  file: id.split("#")[0],
  line: 1,
  exported: true,
  source: null,
  children: children.map((c) => ({ id: c, count: 1, line: 2 })),
  ...extra,
});

const TREE: ComponentTree = {
  nodes: [
    node("code/App.tsx#App", "App", ["code/Nav.tsx#Nav", "external:react-router-dom#Link"]),
    node("code/Nav.tsx#Nav", "Nav", ["code/Item.tsx#Item"]),
    node("code/Item.tsx#Item", "Item", ["code/Item.tsx#Item"]),
    node("external:react-router-dom#Link", "Link", [], { kind: "external", file: null, line: null, source: "react-router-dom" }),
  ],
  roots: ["code/App.tsx#App"],
  files_scanned: 3,
  parse_errors: [],
  truncated: false,
};

const rowIds = () => screen.getAllByRole("treeitem").map((r) => r.getAttribute("data-node-id"));

describe("ComponentTreePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    componentTree.mockResolvedValue(TREE);
    workspaceApiMock.listFiles.mockResolvedValue({ entries: [{ path: "code/Nav.tsx", type: "file", size: 50 }], truncated: false });
    workspaceApiMock.readFile.mockResolvedValue({ path: "code/Nav.tsx", content: "export function Nav() {}", size: 50 });
  });

  it("shows roots expanded one level and hides package components", async () => {
    renderWithQueryClient(<ComponentTreePanel projectId="p1" isActive />);
    await screen.findByText("Nav");
    expect(rowIds()).toEqual(["code/App.tsx#App", "code/Nav.tsx#Nav"]);
    fireEvent.click(screen.getByLabelText("Show components from packages"));
    expect(rowIds()).toEqual(["code/App.tsx#App", "code/Nav.tsx#Nav", "external:react-router-dom#Link"]);
    expect(screen.getByText("3 components in 3 files · Enter: open source")).toBeTruthy();
  });

  it("does not fetch while the tab is hidden", () => {
    renderWithQueryClient(<ComponentTreePanel projectId="p1" isActive={false} />);
    expect(componentTree).not.toHaveBeenCalled();
  });

  it("expands with the arrow keys and stops at a component that renders itself", async () => {
    renderWithQueryClient(<ComponentTreePanel projectId="p1" isActive />);
    await screen.findByText("Nav");
    const tree = screen.getByRole("tree");
    act(() => tree.focus());
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // Nav
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // Item
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(rowIds()).toEqual(["code/App.tsx#App", "code/Nav.tsx#Nav", "code/Item.tsx#Item", "code/Item.tsx#Item"]);
    expect(screen.getByLabelText("Renders itself")).toBeTruthy();
  });

  it("searches by name and opens the source file with Enter", async () => {
    renderWithQueryClient(<ComponentTreePanel projectId="p1" isActive />);
    await screen.findByText("Nav");
    const search = screen.getByLabelText("Search components");
    fireEvent.change(search, { target: { value: "na" } });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("data-node-id"))).toEqual(["code/Nav.tsx#Nav"]);
    fireEvent.keyDown(search, { key: "Enter" });
    const dialog = await screen.findByTestId("quickview");
    expect(within(dialog).getByText("Nav.tsx")).toBeTruthy();
  });

  it("explains an empty code/ folder", async () => {
    componentTree.mockResolvedValue({ nodes: [], roots: [], files_scanned: 0, parse_errors: [], truncated: false });
    renderWithQueryClient(<ComponentTreePanel projectId="p1" isActive />);
    expect(await screen.findByText("No JavaScript or TypeScript files in code/")).toBeTruthy();
  });

  it("builds rows without expanding collapsed nodes", () => {
    expect(buildRows(TREE, new Set(), true).map((r) => r.node.name)).toEqual(["App"]);
  });
});

describe("ToolsPanel", () => {
  it("shows the component tree as the selected tool", async () => {
    componentTree.mockResolvedValue(TREE);
    renderWithQueryClient(<ToolsPanel projectId="p1" isActive />);
    expect((screen.getByLabelText("Tool") as HTMLSelectElement).value).toBe("component-tree");
    expect(await screen.findByTestId("component-tree-panel")).toBeTruthy();
  });
});
