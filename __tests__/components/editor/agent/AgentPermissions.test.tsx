import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithQueryClient } from "@/__tests__/helpers/renderWithProviders";

// Node 26's experimental global localStorage shadows jsdom's and has no methods without a backing file.
vi.hoisted(() => {
  if (!globalThis.localStorage || typeof globalThis.localStorage.setItem !== "function") {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (index: number) => [...store.keys()][index] ?? null,
    };
  }
});

vi.mock("@/lib/context/ToastContext", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock("@/lib/api/agentSettings", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    agentSettingsApi: { getStatus: vi.fn(), listModels: vi.fn(), saveSettings: vi.fn(), testConnection: vi.fn() },
  };
});

vi.mock("@/lib/api/agentChat", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, streamAgentChat: vi.fn() };
});

import { agentSettingsApi, type AgentStatus } from "@/lib/api/agentSettings";
import { streamAgentChat, type AgentPermissions } from "@/lib/api/agentChat";
import { useAgentChatStore } from "@/lib/stores/agentChatStore";
import {
  AGENT_PERMISSIONS_STORAGE_KEY,
  DEFAULT_AGENT_PERMISSIONS,
  useAgentPermissionsStore,
} from "@/lib/stores/agentPermissionsStore";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";
import { AgentPanel } from "@/components/editor/agent/AgentPanel";

const status: AgentStatus = {
  configured: true,
  secrets_file: "/home/u/.env.local",
  settings: { model: "anthropic/claude-opus-5.5", effort: "high", custom_instructions: "" },
};

const pageInfo = { projectId: "p1", projectName: "Zoo", branch: "main", leftTab: "classes", selectedEntity: null };

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAgentChatStore.setState({ conversations: {}, model: null, effort: null });
  useAgentPermissionsStore.setState({ ...DEFAULT_AGENT_PERMISSIONS });
  localStorage.clear();
  useWorkspaceStore.setState({ pendingPrompt: null });
  vi.mocked(agentSettingsApi.getStatus).mockResolvedValue(status);
  vi.mocked(agentSettingsApi.listModels).mockResolvedValue({ models: [] });
  vi.mocked(streamAgentChat).mockImplementation(async ({ onEvent }) => {
    onEvent({ type: "done", stop_reason: "stop" });
  });
});

const ontologyToggle = () => screen.getByRole("button", { name: /Edit Ontology/ });
const codeToggle = () => screen.getByRole("button", { name: /Edit Code/ });

async function sendMessage(text: string): Promise<AgentPermissions | undefined> {
  const box = screen.getByLabelText("Message the agent");
  fireEvent.change(box, { target: { value: text } });
  const before = vi.mocked(streamAgentChat).mock.calls.length;
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(vi.mocked(streamAgentChat).mock.calls.length).toBe(before + 1));
  await waitFor(() => expect(screen.getByLabelText("Send")).toBeDefined());
  return vi.mocked(streamAgentChat).mock.calls[before][0].permissions;
}

describe("Edit Code / Edit Ontology toggles", () => {
  it("render as toggle buttons with Edit Ontology on and Edit Code off by default", async () => {
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    await screen.findByLabelText("Message the agent");
    expect(ontologyToggle().getAttribute("aria-pressed")).toBe("true");
    expect(codeToggle().getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("agent-read-only-note")).toBeNull();
  });

  it("send the current permissions with every request", async () => {
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    await screen.findByLabelText("Message the agent");

    expect(await sendMessage("one")).toEqual({ edit_ontology: true, edit_code: false });

    fireEvent.click(codeToggle());
    expect(codeToggle().getAttribute("aria-pressed")).toBe("true");
    expect(await sendMessage("two")).toEqual({ edit_ontology: true, edit_code: true });

    fireEvent.click(ontologyToggle());
    expect(ontologyToggle().getAttribute("aria-pressed")).toBe("false");
    expect(await sendMessage("three")).toEqual({ edit_ontology: false, edit_code: true });

    fireEvent.click(codeToggle());
    expect(await sendMessage("four")).toEqual({ edit_ontology: false, edit_code: false });
    expect(screen.getByTestId("agent-read-only-note").textContent).toContain("Read-only: the agent can't change anything");

    fireEvent.click(ontologyToggle());
    expect(screen.queryByTestId("agent-read-only-note")).toBeNull();
    expect(await sendMessage("five")).toEqual({ edit_ontology: true, edit_code: false });
  });

  it("persist the choice in localStorage and restore it on the next mount", async () => {
    const first = renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    await screen.findByLabelText("Message the agent");
    fireEvent.click(codeToggle());
    fireEvent.click(ontologyToggle());
    expect(JSON.parse(localStorage.getItem(AGENT_PERMISSIONS_STORAGE_KEY)!).state).toEqual({
      edit_code: true,
      edit_ontology: false,
    });
    first.unmount();

    // A fresh page load starts from the defaults and rehydrates from storage on mount.
    // (setState persists too, so put the saved value back afterwards.)
    const saved = localStorage.getItem(AGENT_PERMISSIONS_STORAGE_KEY)!;
    useAgentPermissionsStore.setState({ ...DEFAULT_AGENT_PERMISSIONS });
    localStorage.setItem(AGENT_PERMISSIONS_STORAGE_KEY, saved);
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    await screen.findByLabelText("Message the agent");
    await waitFor(() => expect(codeToggle().getAttribute("aria-pressed")).toBe("true"));
    expect(ontologyToggle().getAttribute("aria-pressed")).toBe("false");
    expect(await sendMessage("hi")).toEqual({ edit_ontology: false, edit_code: true });
  });

  it("fall back to the defaults when storage throws", async () => {
    const spy = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
      await screen.findByLabelText("Message the agent");
      expect(ontologyToggle().getAttribute("aria-pressed")).toBe("true");
      expect(codeToggle().getAttribute("aria-pressed")).toBe("false");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Run as prompt", () => {
  it("puts a queued prompt in the composer without sending, and adds its source", async () => {
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    const box = (await screen.findByLabelText("Message the agent")) as HTMLTextAreaElement;
    act(() => useWorkspaceStore.getState().queuePrompt("Summarize this file", "code/notes.md"));

    await waitFor(() => expect(box.value).toBe("Summarize this file"));
    expect(useWorkspaceStore.getState().pendingPrompt).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(screen.getByTestId("agent-prompt-source").textContent).toContain("From: code/notes.md");
    expect(streamAgentChat).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(streamAgentChat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(streamAgentChat).mock.calls[0][0].userMessage).toBe(
      "Prompt source: code/notes.md\nSummarize this file",
    );
    expect(screen.queryByTestId("agent-prompt-source")).toBeNull();
  });

  it("consumes a prompt queued before the panel mounted", async () => {
    useWorkspaceStore.getState().queuePrompt("Queued early");
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    const box = (await screen.findByLabelText("Message the agent")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe("Queued early"));
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(screen.queryByTestId("agent-prompt-source")).toBeNull();
    expect(streamAgentChat).not.toHaveBeenCalled();
  });

  it("drops the source line when the chip is dismissed", async () => {
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    const box = (await screen.findByLabelText("Message the agent")) as HTMLTextAreaElement;
    act(() => useWorkspaceStore.getState().queuePrompt("Do it", "README.md"));
    await screen.findByTestId("agent-prompt-source");
    fireEvent.click(screen.getByLabelText("Remove prompt source"));
    expect(screen.queryByTestId("agent-prompt-source")).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(streamAgentChat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(streamAgentChat).mock.calls[0][0].userMessage).toBe("Do it");
  });
});

describe("streamAgentChat", () => {
  it("puts permissions in the request body", async () => {
    const actual = await vi.importActual<typeof import("@/lib/api/agentChat")>("@/lib/api/agentChat");
    const fetchMock = vi.fn().mockResolvedValue(new Response("event: done\ndata: {\"stop_reason\":\"stop\"}\n\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await actual.streamAgentChat({
        projectId: "p1",
        messages: [],
        userMessage: "hi",
        pageContext: "",
        permissions: { edit_code: true, edit_ontology: false },
        onEvent: () => {},
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.permissions).toEqual({ edit_code: true, edit_ontology: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
