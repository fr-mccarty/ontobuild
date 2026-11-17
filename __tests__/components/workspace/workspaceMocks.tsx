import React from "react";
import { vi } from "vitest";

/** Shared vi.fn()s for the workspace API (wired up by vi.mock in each test file). */
export const workspaceApiMock = {
  listFiles: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  rawUrl: (projectId: string, path: string) => `/api/v1/projects/${projectId}/files/raw?path=${encodeURIComponent(path)}`,
  listTerminals: vi.fn(),
  createTerminal: vi.fn(),
  terminalStreamUrl: (projectId: string, id: string) => `/api/v1/projects/${projectId}/terminals/${id}/stream`,
  sendInput: vi.fn(),
  resizeTerminal: vi.fn(),
  closeTerminal: vi.fn(),
  getDevServer: vi.fn(),
  configureDevServer: vi.fn(),
  startDevServer: vi.fn(),
  stopDevServer: vi.fn(),
};

/** next/dynamic stand-in: renders a placeholder that exposes the props tests care about. */
export const dynamicMock = {
  __esModule: true,
  default: () =>
    function DynamicStub(props: Record<string, unknown>) {
      return React.createElement("div", {
        "data-testid": "dynamic-component",
        "data-language": props.language as string | undefined,
        "data-value": props.value as string | undefined,
        "data-terminal-id": props.terminalId as string | undefined,
      });
    },
};

export const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
