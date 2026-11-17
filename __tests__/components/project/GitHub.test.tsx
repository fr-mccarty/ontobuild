import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GitHubRemote } from "@/lib/api/github";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  fetch: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/lib/api/github", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/github")>();
  return { ...actual, githubApi: api };
});

import { GitHubPanel } from "@/components/project/GitHub";
import { ApiError } from "@/lib/api/client";

const base: GitHubRemote = {
  remote_url: null,
  web_url: null,
  host: null,
  is_github: false,
  branch: "main",
  upstream: null,
  ahead: null,
  behind: null,
  last_fetched_at: null,
  gh_available: false,
  gh_authenticated: false,
};
const linked: GitHubRemote = {
  ...base,
  remote_url: "git@github.com:acme/pizza.git",
  web_url: "https://github.com/acme/pizza",
  host: "github.com",
  is_github: true,
  upstream: "origin/main",
  ahead: 2,
  behind: 1,
};

function renderPanel(mode: "sync" | "settings") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipPrimitive.Provider>
        <GitHubPanel projectId="p1" mode={mode} />
      </TooltipPrimitive.Provider>
    </QueryClientProvider>,
  );
}

describe("GitHubPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Object.values(api).forEach((f) => f.mockReset());
  });

  it("settings: links an unlinked project, and offers create with gh when signed in", async () => {
    api.get.mockResolvedValue({ ...base, gh_available: true, gh_authenticated: true });
    api.link.mockResolvedValue(linked);
    renderPanel("settings");
    expect(await screen.findByRole("button", { name: "Create on GitHub" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Link an existing repository"), {
      target: { value: "git@github.com:acme/pizza.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() => expect(api.link).toHaveBeenCalledWith("p1", "git@github.com:acme/pizza.git"));
    expect((await screen.findByRole("link", { name: /github.com\/acme\/pizza/ })).getAttribute("href")).toBe(
      "https://github.com/acme/pizza",
    );
  });

  it("settings: explains gh auth login when gh isn't signed in", async () => {
    api.get.mockResolvedValue(base);
    renderPanel("settings");
    expect(await screen.findByText("gh auth login")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create on GitHub" })).toBeNull();
  });

  it("settings: unlinks a linked project but leaves syncing to the Repository button", async () => {
    api.get.mockResolvedValue(linked);
    api.unlink.mockResolvedValue(base);
    renderPanel("settings");
    expect((await screen.findByTestId("github-status")).textContent).toContain("2 ahead, 1 behind");
    expect(screen.queryByRole("button", { name: /Push/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Unlink repository/ }));
    await waitFor(() => expect(api.unlink).toHaveBeenCalledWith("p1"));
  });

  it("sync: points an unlinked project to settings", async () => {
    api.get.mockResolvedValue({ ...base, gh_available: true, gh_authenticated: true });
    renderPanel("sync");
    expect((await screen.findByRole("link", { name: "Link one in project settings" })).getAttribute("href")).toBe(
      "/projects/p1/settings#github",
    );
    expect(screen.queryByLabelText("Link an existing repository")).toBeNull();
  });

  it("sync: runs pull and push on a linked project, showing errors, with no unlink", async () => {
    api.get.mockResolvedValue(linked);
    api.pull.mockRejectedValue(new ApiError(409, "Conflict", JSON.stringify({ detail: "Can't fast-forward 'main'" })));
    api.push.mockResolvedValue({ ...linked, ahead: 0, behind: 0, output: "To github.com:acme/pizza.git" });
    renderPanel("sync");
    expect((await screen.findByTestId("github-status")).textContent).toContain("2 ahead, 1 behind");

    fireEvent.click(screen.getByRole("button", { name: /Pull/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Can't fast-forward 'main'");

    fireEvent.click(screen.getByRole("button", { name: /Push/ }));
    await waitFor(() => expect(api.push).toHaveBeenCalledWith("p1", { all: false }));
    expect(await screen.findByText("To github.com:acme/pizza.git")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Unlink/ })).toBeNull();
  });
});
