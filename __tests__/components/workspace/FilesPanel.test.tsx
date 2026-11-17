import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/__tests__/helpers/renderWithProviders";
import { workspaceApiMock } from "./workspaceMocks";

vi.mock("@/lib/api/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/workspace")>()),
  workspaceApi: (await import("./workspaceMocks")).workspaceApiMock,
}));
vi.mock("next/dynamic", async () => (await import("./workspaceMocks")).dynamicMock);
vi.mock("@/lib/context/ToastContext", async () => {
  const { toastMock } = await import("./workspaceMocks");
  return { useToast: () => toastMock };
});

import { FilesPanel, matchScore } from "@/components/workspace/FilesPanel";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";

const ENTRIES = [
  { path: "ontology.ttl", type: "file", size: 1200 },
  { path: "code", type: "dir", size: 0 },
  { path: "code/app.py", type: "file", size: 40 },
  { path: "code/data.csv", type: "file", size: 30 },
  { path: "docs", type: "dir", size: 0 },
  { path: "docs/readme.md", type: "file", size: 10 },
];

function renderPanel() {
  return renderWithQueryClient(<FilesPanel projectId="p1" isActive />);
}

const rowNames = () =>
  screen.getAllByRole("treeitem").map((r) => r.getAttribute("data-path"));

describe("FilesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceApiMock.listFiles.mockResolvedValue({ entries: ENTRIES, truncated: false });
    workspaceApiMock.readFile.mockResolvedValue({ path: "code/app.py", content: "print('hi')\n", size: 12 });
    useWorkspaceStore.setState({ terminals: [], activeTerminalId: null, terminalPanelOpen: false });
  });

  it("renders a tree with directories first and code/ expanded", async () => {
    renderPanel();
    await screen.findByText("app.py");
    expect(rowNames()).toEqual(["code", "code/app.py", "code/data.csv", "docs", "ontology.ttl"]);
    expect(screen.queryByText("readme.md")).toBeNull();
  });

  it("expands and collapses directories with the arrow keys", async () => {
    renderPanel();
    await screen.findByText("app.py");
    const tree = screen.getByRole("tree");
    act(() => tree.focus());
    // Focus selects the first row (code); Left collapses it.
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(screen.queryByText("app.py")).toBeNull();
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // docs
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(screen.getByText("readme.md")).toBeTruthy();
  });

  it("filters to flat results while searching", async () => {
    renderPanel();
    await screen.findByText("app.py");
    fireEvent.change(screen.getByLabelText("Search files"), { target: { value: "readme" } });
    const list = screen.getByRole("listbox");
    const options = within(list).getAllByRole("option");
    expect(options.map((o) => o.getAttribute("data-path"))).toEqual(["docs/readme.md"]);
    expect(screen.queryByRole("tree")).toBeNull();
  });

  it("fuzzy-matches path characters in order", () => {
    expect(matchScore("code/app.py", "cdapp")).not.toBeNull();
    expect(matchScore("code/app.py", "zzz")).toBeNull();
    expect(matchScore("code/app.py", "app")!).toBeGreaterThan(matchScore("code/app.py", "cdap")!);
  });

  it("opens Quick View with Space and closes it with Space", async () => {
    renderPanel();
    await screen.findByText("app.py");
    const tree = screen.getByRole("tree");
    act(() => tree.focus());
    fireEvent.keyDown(tree, { key: "ArrowDown" }); // code/app.py
    fireEvent.keyDown(tree, { key: " " });
    const dialog = await screen.findByTestId("quickview");
    expect(within(dialog).getByText("app.py")).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByTestId("dynamic-component").getAttribute("data-language")).toBe("python"));
    fireEvent.keyDown(dialog, { key: " " });
    await waitFor(() => expect(screen.queryByTestId("quickview")).toBeNull());
  });

  it("does not open Quick View when Space is typed in the search box; Down moves into results", async () => {
    renderPanel();
    await screen.findByText("app.py");
    const search = screen.getByLabelText("Search files");
    fireEvent.change(search, { target: { value: "app" } });
    fireEvent.keyDown(search, { key: " " });
    expect(screen.queryByTestId("quickview")).toBeNull();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("listbox"));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: " " });
    expect(await screen.findByTestId("quickview")).toBeTruthy();
  });

  it("runs a runnable file in a new terminal tab", async () => {
    workspaceApiMock.createTerminal.mockResolvedValue({
      id: "t1", title: "app.py", kind: "run", running: true, exit_code: null, cwd: "code",
    });
    workspaceApiMock.listTerminals.mockResolvedValue({ items: [] });
    renderPanel();
    await screen.findByText("app.py");
    expect(screen.queryByLabelText("Run data.csv in a new terminal")).toBeNull();
    fireEvent.click(screen.getByLabelText("Run app.py in a new terminal"));
    await waitFor(() =>
      expect(workspaceApiMock.createTerminal).toHaveBeenCalledWith("p1", { kind: "run", run: "code/app.py" }),
    );
    await waitFor(() => expect(useWorkspaceStore.getState().terminals).toEqual([{ id: "t1", title: "app.py", kind: "run" }]));
    expect(useWorkspaceStore.getState().terminalPanelOpen).toBe(true);
  });

  it("opens a shell in a directory", async () => {
    workspaceApiMock.createTerminal.mockResolvedValue({
      id: "t2", title: "zsh", kind: "shell", running: true, exit_code: null, cwd: "docs",
    });
    workspaceApiMock.listTerminals.mockResolvedValue({ items: [] });
    renderPanel();
    await screen.findByText("app.py");
    const docsRow = screen.getAllByRole("treeitem").find((r) => r.getAttribute("data-path") === "docs")!;
    fireEvent.click(within(docsRow).getByLabelText("New terminal here"));
    await waitFor(() => expect(workspaceApiMock.createTerminal).toHaveBeenCalledWith("p1", { kind: "shell", cwd: "docs" }));
  });

  it("deletes a file after confirmation", async () => {
    workspaceApiMock.deleteFile.mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText("app.py");
    fireEvent.click(screen.getByLabelText("Delete data.csv"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(workspaceApiMock.deleteFile).toHaveBeenCalledWith("p1", "code/data.csv"));
  });
});
