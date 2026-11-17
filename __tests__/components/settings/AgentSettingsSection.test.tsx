import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";
import {
  AgentSettingsSection,
  AGENT_INSTRUCTIONS_DEBOUNCE_MS,
} from "@/components/settings/AgentSettingsSection";
import { AGENT_CUSTOM_INSTRUCTIONS_LIMIT, type AgentStatus } from "@/lib/api/agentSettings";
import { ApiError } from "@/lib/api/client";

const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/context/ToastContext", () => ({
  useToast: () => toastMock,
}));

const apiMock = vi.hoisted(() => ({
  getStatus: vi.fn(),
  testConnection: vi.fn(),
  listModels: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("@/lib/api/agentSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/agentSettings")>();
  return { ...actual, agentSettingsApi: apiMock };
});

const renderSection = (ui: ReactElement = <AgentSettingsSection />) =>
  render(<TooltipPrimitive.Provider>{ui}</TooltipPrimitive.Provider>);

function makeStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    configured: true,
    secrets_file: "/home/me/.ontobuilder/secrets.env",
    settings: {
      model: "anthropic/claude-sonnet-5.5",
      effort: "medium",
      custom_instructions: "Prefer British English.",
    },
    ...overrides,
  };
}

describe("AgentSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.saveSettings.mockResolvedValue({ settings: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the configured status, secrets path and loaded settings", async () => {
    apiMock.getStatus.mockResolvedValue(makeStatus());
    const { container } = renderSection();

    expect(await screen.findByText("Configured")).toBeDefined();
    expect(container.querySelector("#agent")).not.toBeNull();
    expect(screen.getByText("/home/me/.ontobuilder/secrets.env")).toBeDefined();
    expect(screen.getByText("OPENROUTER_API_KEY=sk-or-...")).toBeDefined();
    expect(screen.getByRole("link", { name: /Create an OpenRouter key/ }).getAttribute("href")).toBe(
      "https://openrouter.ai/keys",
    );
    expect(screen.getByTestId("agent-current-model").textContent).toBe("anthropic/claude-sonnet-5.5");
    expect(screen.getByText(/Change the model from the Agent panel/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Medium" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Prefer British English.");
  });

  it("renders the not configured status", async () => {
    apiMock.getStatus.mockResolvedValue(makeStatus({ configured: false }));
    renderSection();
    expect(await screen.findByText("Not configured")).toBeDefined();
    expect(screen.queryByText("Configured")).toBeNull();
  });

  it("falls back to defaults when status fails to load", async () => {
    apiMock.getStatus.mockRejectedValue(new Error("Server unreachable"));
    renderSection();
    expect(await screen.findByText("Status unavailable")).toBeDefined();
    expect(screen.getByText("Server unreachable")).toBeDefined();
    expect(screen.getByTestId("agent-current-model").textContent).toBe("anthropic/claude-opus-5.5");
    expect(screen.getByRole("button", { name: "High" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("copies the secrets file path", async () => {
    apiMock.getStatus.mockResolvedValue(makeStatus());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Copy secrets file path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/home/me/.ontobuilder/secrets.env"));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("shows success after a passing connection test", async () => {
    apiMock.getStatus.mockResolvedValue(makeStatus({ configured: false }));
    apiMock.testConnection.mockResolvedValue({ ok: true, model: "anthropic/claude-sonnet-5.5" });
    renderSection();
    await screen.findByText("Not configured");

    fireEvent.click(screen.getByRole("button", { name: /Test connection/ }));

    expect(await screen.findByText("Connected to OpenRouter")).toBeDefined();
    expect(screen.getByText("Configured")).toBeDefined();
  });

  it("shows the server error detail when the connection test fails", async () => {
    apiMock.getStatus.mockResolvedValue(makeStatus({ configured: false }));
    apiMock.testConnection.mockRejectedValue(
      new ApiError(400, "Bad Request", "OPENROUTER_API_KEY is not set"),
    );
    renderSection();
    await screen.findByText("Not configured");

    fireEvent.click(screen.getByRole("button", { name: /Test connection/ }));

    expect(await screen.findByText("OPENROUTER_API_KEY is not set")).toBeDefined();
    expect(screen.queryByText("Connected to OpenRouter")).toBeNull();
  });

  it("saves only the effort field when choosing an effort", async () => {
    apiMock.getStatus.mockResolvedValue(makeStatus());
    renderSection();
    await screen.findByText("Configured");

    fireEvent.click(screen.getByRole("button", { name: "Low" }));

    expect(apiMock.saveSettings).toHaveBeenCalledTimes(1);
    expect(apiMock.saveSettings).toHaveBeenCalledWith({ effort: "low" });
    expect(screen.getByRole("button", { name: "Low" }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("Saved")).toBeDefined();
  });

  it("does not save when the current effort is chosen again", async () => {
    apiMock.getStatus.mockResolvedValue(makeStatus());
    renderSection();
    await screen.findByText("Configured");
    fireEvent.click(screen.getByRole("button", { name: "Medium" }));
    expect(apiMock.saveSettings).not.toHaveBeenCalled();
  });

  it("shows a toast when saving fails", async () => {
    apiMock.getStatus.mockResolvedValue(makeStatus());
    apiMock.saveSettings.mockRejectedValue(new Error("Disk full"));
    renderSection();
    await screen.findByText("Configured");
    fireEvent.click(screen.getByRole("button", { name: "High" }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Failed to save agent settings", "Disk full"),
    );
    expect(screen.getByText("Not saved")).toBeDefined();
  });

  it("debounces custom instruction saves and sends only that field", async () => {
    apiMock.getStatus.mockResolvedValue(makeStatus());
    renderSection();
    await screen.findByText("Configured");
    vi.useFakeTimers();

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "A" } });
    fireEvent.change(textarea, { target: { value: "AB" } });
    expect(apiMock.saveSettings).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(AGENT_INSTRUCTIONS_DEBOUNCE_MS);
    });

    expect(apiMock.saveSettings).toHaveBeenCalledTimes(1);
    expect(apiMock.saveSettings).toHaveBeenCalledWith({ custom_instructions: "AB" });
  });

  it("limits custom instructions to 4000 characters and shows the count", async () => {
    apiMock.getStatus.mockResolvedValue(makeStatus({ settings: { ...makeStatus().settings, custom_instructions: "" } }));
    renderSection();
    await screen.findByText("Configured");

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(AGENT_CUSTOM_INSTRUCTIONS_LIMIT);
    expect(screen.getByTestId("agent-instructions-count").textContent).toBe("0 / 4,000");

    fireEvent.change(textarea, { target: { value: "x".repeat(AGENT_CUSTOM_INSTRUCTIONS_LIMIT + 50) } });

    expect(textarea.value.length).toBe(AGENT_CUSTOM_INSTRUCTIONS_LIMIT);
    expect(screen.getByTestId("agent-instructions-count").textContent).toBe("4,000 / 4,000");
  });
});
