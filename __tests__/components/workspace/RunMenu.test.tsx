import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/__tests__/helpers/renderWithProviders";
import { workspaceApiMock } from "./workspaceMocks";

vi.mock("@/lib/api/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/workspace")>()),
  workspaceApi: (await import("./workspaceMocks")).workspaceApiMock,
}));
vi.mock("@/lib/context/ToastContext", async () => {
  const { toastMock } = await import("./workspaceMocks");
  return { useToast: () => toastMock };
});

import { RunMenu } from "@/components/workspace/RunMenu";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";

const status = (over: Record<string, unknown> = {}) => ({
  command: "npm run dev",
  cwd: "code",
  configured_url: null,
  detected_url: null,
  url: null,
  running: false,
  terminal_id: null,
  suggested_command: "npm run dev",
  ...over,
});

describe("RunMenu", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    useWorkspaceStore.setState({ terminals: [], activeTerminalId: null, terminalPanelOpen: false, rightTab: "agent" });
  });
  afterEach(() => openSpy.mockRestore());

  it("disables View in Browser without a URL", async () => {
    workspaceApiMock.getDevServer.mockResolvedValue(status());
    renderWithQueryClient(<RunMenu projectId="p1" />);
    // The button appears once the dev server status says one is configured.
    const button = (await screen.findByRole("button", { name: "View in Browser" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("hides View in Browser until a dev server is set up, keeping the Run menu", async () => {
    workspaceApiMock.getDevServer.mockResolvedValue(status({ command: null }));
    renderWithQueryClient(<RunMenu projectId="p1" />);
    await waitFor(() => expect(workspaceApiMock.getDevServer).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: "View in Browser" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Run menu" }));
    expect(screen.getByRole("menuitem", { name: /New terminal/ })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Configure dev server/ })).toBeDefined();
  });

  it("opens the dev server URL in a new tab", async () => {
    workspaceApiMock.getDevServer.mockResolvedValue(status({ url: "http://localhost:5173/", running: true, terminal_id: "t9" }));
    renderWithQueryClient(<RunMenu projectId="p1" />);
    const button = (await screen.findByRole("button", { name: "View in Browser" })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(openSpy).toHaveBeenCalledWith("http://localhost:5173/", "_blank", "noopener");
  });

  it("starts the dev server and opens its terminal", async () => {
    workspaceApiMock.getDevServer.mockResolvedValue(status());
    workspaceApiMock.startDevServer.mockResolvedValue(status({ running: true, terminal_id: "dev1" }));
    workspaceApiMock.listTerminals.mockResolvedValue({ items: [] });
    renderWithQueryClient(<RunMenu projectId="p1" />);
    await waitFor(() => expect(workspaceApiMock.getDevServer).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Run menu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Start dev server/ }));
    await waitFor(() => expect(workspaceApiMock.startDevServer).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(useWorkspaceStore.getState().activeTerminalId).toBe("dev1"));
  });

  it("shows the Files tab and toggles the terminal panel from the menu", async () => {
    workspaceApiMock.getDevServer.mockResolvedValue(status());
    renderWithQueryClient(<RunMenu projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Run menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Files" }));
    expect(useWorkspaceStore.getState().rightTab).toBe("files");
    fireEvent.click(screen.getByRole("button", { name: "Run menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show terminal panel" }));
    expect(useWorkspaceStore.getState().terminalPanelOpen).toBe(true);
  });

  it("saves the dev server configuration", async () => {
    workspaceApiMock.getDevServer.mockResolvedValue(status({ command: null }));
    workspaceApiMock.configureDevServer.mockResolvedValue(status());
    workspaceApiMock.listTerminals.mockResolvedValue({ items: [] });
    renderWithQueryClient(<RunMenu projectId="p1" />);
    await waitFor(() => expect(workspaceApiMock.getDevServer).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Run menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Configure dev server/ }));
    const command = (await screen.findByLabelText("Command")) as HTMLInputElement;
    expect(command.value).toBe("npm run dev");
    fireEvent.change(screen.getByLabelText(/^URL/), { target: { value: "http://localhost:3001" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(workspaceApiMock.configureDevServer).toHaveBeenCalledWith("p1", {
        command: "npm run dev",
        cwd: "code",
        url: "http://localhost:3001",
      }),
    );
  });
});
