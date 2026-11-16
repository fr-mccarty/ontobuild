import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithQueryClient } from "@/__tests__/helpers/renderWithProviders";

const toastError = vi.fn();
vi.mock("@/lib/context/ToastContext", () => ({
  useToast: () => ({ error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock("@/lib/api/agentSettings", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    agentSettingsApi: {
      getStatus: vi.fn(),
      listModels: vi.fn(),
      saveSettings: vi.fn(),
      testConnection: vi.fn(),
    },
  };
});

vi.mock("@/lib/api/agentChat", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, streamAgentChat: vi.fn() };
});

import { agentSettingsApi, type AgentStatus } from "@/lib/api/agentSettings";
import { streamAgentChat } from "@/lib/api/agentChat";
import { useAgentChatStore } from "@/lib/stores/agentChatStore";
import { AgentPanel } from "@/components/editor/agent/AgentPanel";

const configuredStatus: AgentStatus = {
  configured: true,
  secrets_file: "/home/u/.ontokit/secrets.env",
  settings: { model: "anthropic/claude-opus-5.5", effort: "high", custom_instructions: "" },
};

const models = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Anthropic: Claude Opus 5.5",
    context_length: 200000,
    prompt_price_per_million: 5,
    completion_price_per_million: 25,
    supports_reasoning: true,
  },
  {
    id: "openai/gpt-x",
    name: "OpenAI: GPT X",
    context_length: 128000,
    prompt_price_per_million: 1.25,
    completion_price_per_million: 10,
    supports_reasoning: true,
  },
  {
    id: "google/gemini-z",
    name: "Google: Gemini Z",
    context_length: null,
    prompt_price_per_million: null,
    completion_price_per_million: null,
    supports_reasoning: false,
  },
];

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
  useAgentChatStore.setState({ conversations: {}, model: null, effort: null });
  vi.mocked(agentSettingsApi.getStatus).mockResolvedValue(configuredStatus);
  vi.mocked(agentSettingsApi.listModels).mockResolvedValue({ models });
});

describe("AgentPanel", () => {
  it("shows the not-configured state with the secrets file", async () => {
    vi.mocked(agentSettingsApi.getStatus).mockResolvedValue({ ...configuredStatus, configured: false });
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    await screen.findByTestId("agent-not-configured");
    expect(screen.getByText("/home/u/.ontokit/secrets.env")).toBeDefined();
    expect(screen.getByText(/OPENROUTER_API_KEY=/)).toBeDefined();
    expect(screen.getByRole("link", { name: "openrouter.ai/keys" }).getAttribute("href")).toBe("https://openrouter.ai/keys");
    expect(screen.getByRole("link", { name: "agent settings" }).getAttribute("href")).toBe("/settings#agent");
  });

  it("shows example prompts when empty", async () => {
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    expect(await screen.findByText("Explain the selected entity")).toBeDefined();
  });

  it("sends a message and renders streamed text and tool rows", async () => {
    let finish: () => void = () => {};
    vi.mocked(streamAgentChat).mockImplementation(({ onEvent, userMessage }) => {
      onEvent({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: "<page_context>\nx\n</page_context>" }, { type: "text", text: userMessage }] },
      });
      onEvent({ type: "text", text: "Adding the class now." });
      onEvent({ type: "tool_use", id: "t1", name: "add_class", input: { label: "Puppy" } });
      return new Promise<void>((resolve) => {
        finish = () => {
          onEvent({ type: "tool_result", tool_use_id: "t1", name: "add_class", is_error: false, summary: "Added Puppy", mutated: true });
          onEvent({ type: "done", stop_reason: "stop" });
          resolve();
        };
      });
    });
    const onProjectChanged = vi.fn();
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} onProjectChanged={onProjectChanged} />);
    const box = await screen.findByLabelText("Message the agent");
    fireEvent.change(box, { target: { value: "Add Puppy" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(await screen.findByText("Add Puppy")).toBeDefined();
    expect(screen.queryByText(/page_context/)).toBeNull();
    expect(screen.getByText("Adding the class now.")).toBeDefined();
    expect(screen.getByText("Add class · Puppy")).toBeDefined();
    expect(screen.getByLabelText("Running")).toBeDefined();
    expect(screen.getByLabelText("Stop")).toBeDefined();

    const call = vi.mocked(streamAgentChat).mock.calls[0][0];
    expect(call.pageContext).toContain("Project: Zoo (id: p1)");
    expect(call.pageContext).toContain("Branch: main");
    expect(call.model).toBe("anthropic/claude-opus-5.5");

    await act(async () => finish());
    expect(await screen.findByText("Added Puppy")).toBeDefined();
    expect(screen.getByLabelText("Done")).toBeDefined();
    expect(onProjectChanged).toHaveBeenCalledTimes(1);

    expect(screen.queryByText("Add class · Puppy")).toBeNull();
    fireEvent.click(screen.getByText("Added Puppy"));
    expect(screen.getByText("Add class")).toBeDefined();
    expect(screen.getByText(/"label": "Puppy"/)).toBeDefined();
  });

  it("hands ontology changes and select_entity actions to the page callbacks", async () => {
    vi.mocked(streamAgentChat).mockImplementation(async ({ onEvent }) => {
      onEvent({ type: "tool_use", id: "t1", name: "create_entity", input: { label: "Puppy" } });
      onEvent({ type: "tool_result", tool_use_id: "t1", name: "create_entity", is_error: false, summary: "Created class Puppy", mutated: true });
      onEvent({ type: "ontology_changed", tool_use_id: "t1", name: "create_entity", branch: "main", commit_hash: "c1", deleted_iris: [] });
      onEvent({ type: "tool_use", id: "t2", name: "select_entity", input: { iri: "http://ex.org#Puppy" } });
      onEvent({ type: "tool_result", tool_use_id: "t2", name: "select_entity", is_error: false, summary: "Selected class Puppy", mutated: false });
      onEvent({
        type: "ui_action",
        tool_use_id: "t2",
        action: { action: "select_entity", iri: "http://ex.org#Puppy", entity_type: "class", label: "Puppy", branch: "main" },
      });
      onEvent({ type: "done", stop_reason: "stop" });
    });
    const onProjectChanged = vi.fn();
    const onOntologyChanged = vi.fn();
    const onUiAction = vi.fn();
    renderWithQueryClient(
      <AgentPanel
        pageInfo={pageInfo}
        onProjectChanged={onProjectChanged}
        onOntologyChanged={onOntologyChanged}
        onUiAction={onUiAction}
      />,
    );
    fireEvent.click(await screen.findByText("Add a subclass under the selected class"));
    expect(await screen.findByText("Selected class Puppy")).toBeDefined();
    expect(vi.mocked(streamAgentChat).mock.calls[0][0].branch).toBe("main");
    expect(onProjectChanged).toHaveBeenCalledTimes(1);
    expect(onOntologyChanged).toHaveBeenCalledTimes(1);
    expect(onOntologyChanged.mock.calls[0][0]).toMatchObject({ branch: "main", commit_hash: "c1" });
    expect(onUiAction).toHaveBeenCalledTimes(1);
    expect(onUiAction).toHaveBeenCalledWith({
      action: "select_entity",
      iri: "http://ex.org#Puppy",
      entity_type: "class",
      label: "Puppy",
      branch: "main",
    });
  });

  it("shows an error with retry", async () => {
    vi.mocked(streamAgentChat).mockRejectedValueOnce(new Error("Network down"));
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    fireEvent.click(await screen.findByText("Explain the selected entity"));
    expect(await screen.findByText("Network down")).toBeDefined();
    vi.mocked(streamAgentChat).mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(vi.mocked(streamAgentChat)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(streamAgentChat).mock.calls[1][0].userMessage).toBe("Explain the selected entity");
  });
});

describe("AgentModelPicker", () => {
  async function openPicker() {
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    const trigger = await screen.findByRole("button", { name: /Agent model: claude-opus-5.5/ });
    fireEvent.click(trigger);
    await screen.findByText("OpenAI: GPT X");
  }

  it("lists models lazily with ids and prices", async () => {
    renderWithQueryClient(<AgentPanel pageInfo={pageInfo} />);
    await screen.findByRole("button", { name: /Agent model/ });
    expect(agentSettingsApi.listModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Agent model/ }));
    expect(await screen.findByText("OpenAI: GPT X")).toBeDefined();
    expect(screen.getByText("openai/gpt-x")).toBeDefined();
    expect(screen.getByText("$1.25 / $10 per 1M tokens")).toBeDefined();
    expect(screen.getByText("$5 / $25 per 1M tokens")).toBeDefined();
    expect(agentSettingsApi.listModels).toHaveBeenCalledTimes(1);
  });

  it("filters by name and id", async () => {
    await openPicker();
    fireEvent.change(screen.getByPlaceholderText("Search models…"), { target: { value: "gemini" } });
    await waitFor(() => expect(screen.queryByText("OpenAI: GPT X")).toBeNull());
    expect(screen.getByText("Google: Gemini Z")).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText("Search models…"), { target: { value: "openai/" } });
    await waitFor(() => expect(screen.getByText("OpenAI: GPT X")).toBeDefined());
    expect(screen.queryByText("Google: Gemini Z")).toBeNull();
  });

  it("selecting a model saves it and uses it for the next request", async () => {
    vi.mocked(agentSettingsApi.saveSettings).mockResolvedValue(configuredStatus.settings);
    vi.mocked(streamAgentChat).mockResolvedValue(undefined);
    await openPicker();
    fireEvent.click(screen.getByText("OpenAI: GPT X"));
    expect(agentSettingsApi.saveSettings).toHaveBeenCalledWith({ model: "openai/gpt-x" });
    expect(await screen.findByRole("button", { name: /Agent model: GPT X/ })).toBeDefined();

    fireEvent.click(screen.getByText("Explain the selected entity"));
    await waitFor(() => expect(streamAgentChat).toHaveBeenCalled());
    expect(vi.mocked(streamAgentChat).mock.calls[0][0].model).toBe("openai/gpt-x");
  });

  it("reverts and toasts when saving fails", async () => {
    vi.mocked(agentSettingsApi.saveSettings).mockRejectedValue(new Error("nope"));
    await openPicker();
    fireEvent.click(screen.getByText("OpenAI: GPT X"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(useAgentChatStore.getState().model).toBe("anthropic/claude-opus-5.5");
  });

  it("saves the effort", async () => {
    vi.mocked(agentSettingsApi.saveSettings).mockResolvedValue(configuredStatus.settings);
    await openPicker();
    fireEvent.click(screen.getByRole("radio", { name: "Low" }));
    expect(agentSettingsApi.saveSettings).toHaveBeenCalledWith({ effort: "low" });
    expect(useAgentChatStore.getState().effort).toBe("low");
  });
});
