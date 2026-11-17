import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

import { TerminalPanel } from "@/components/workspace/TerminalPanel";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";

const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
};

describe("TerminalPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", memoryStorage());
    useWorkspaceStore.setState({ terminals: [], activeTerminalId: null, terminalPanelOpen: false });
  });

  it("adopts the server's sessions on mount and shows their status", async () => {
    workspaceApiMock.listTerminals.mockResolvedValue({
      items: [
        { id: "a", title: "zsh", kind: "shell", running: true, exit_code: null, cwd: "" },
        { id: "b", title: "app.py", kind: "run", running: false, exit_code: 2, cwd: "code" },
      ],
    });
    renderWithQueryClient(<TerminalPanel projectId="p1" />);
    await waitFor(() => expect(useWorkspaceStore.getState().terminals).toHaveLength(2));
    useWorkspaceStore.getState().setTerminalPanelOpen(true);
    expect(await screen.findByRole("tab", { name: /zsh/ })).toBeTruthy();
    expect(screen.getByTestId("terminal-status-b").getAttribute("aria-label")).toBe("exited with code 2");
    // Both sessions stay mounted; only the active one is visible.
    expect(screen.getAllByTestId("dynamic-component")).toHaveLength(2);
  });

  it("closes a session with DELETE", async () => {
    workspaceApiMock.listTerminals.mockResolvedValue({
      items: [{ id: "a", title: "zsh", kind: "shell", running: true, exit_code: null, cwd: "" }],
    });
    workspaceApiMock.closeTerminal.mockResolvedValue(undefined);
    useWorkspaceStore.setState({ terminalPanelOpen: true });
    renderWithQueryClient(<TerminalPanel projectId="p1" />);
    fireEvent.click(await screen.findByLabelText("Close zsh"));
    await waitFor(() => expect(workspaceApiMock.closeTerminal).toHaveBeenCalledWith("p1", "a"));
    expect(useWorkspaceStore.getState().terminals).toEqual([]);
  });

  it("opens a new shell with the + button and hides the panel", async () => {
    workspaceApiMock.listTerminals.mockResolvedValue({ items: [] });
    workspaceApiMock.createTerminal.mockResolvedValue({ id: "n", title: "zsh", kind: "shell", running: true, exit_code: null, cwd: "" });
    useWorkspaceStore.setState({ terminalPanelOpen: true });
    renderWithQueryClient(<TerminalPanel projectId="p1" />);
    fireEvent.click(screen.getAllByRole("button", { name: "New terminal" })[0]);
    await waitFor(() => expect(useWorkspaceStore.getState().activeTerminalId).toBe("n"));
    fireEvent.click(screen.getByLabelText("Hide terminal panel"));
    expect(useWorkspaceStore.getState().terminalPanelOpen).toBe(false);
  });
});
