import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  GitImportForm,
  gitUrlProblem,
  needsReview,
  repoNameFromUrl,
} from "@/components/projects/git-import-form";
import type { GitImportResponse, GitImportSummary } from "@/lib/api/projects";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));

function response(summary: Partial<GitImportSummary> = {}): GitImportResponse {
  return {
    id: "p1",
    name: "pizza",
    is_public: false,
    created_at: "2026-01-01T00:00:00Z",
    git_import: {
      remote_url: "https://github.com/acme/pizza.git",
      web_url: "https://github.com/acme/pizza",
      branch: "main",
      ontology_path: "ontology.ttl",
      source_path: "ontology.ttl",
      converted: false,
      selection: "automatic",
      candidates: [{ path: "ontology.ttl", format: "turtle", size_bytes: 10, declares_ontology: true }],
      warnings: [],
      ...summary,
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, statusText: status === 201 ? "Created" : "Error" });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderForm(onImported = vi.fn(), onCancel = vi.fn()) {
  render(
    <TooltipPrimitive.Provider>
      <GitImportForm onImported={onImported} onCancel={onCancel} />
    </TooltipPrimitive.Provider>,
  );
  return { onImported, onCancel };
}

describe("git URL helpers", () => {
  it("derives the repository name", () => {
    expect(repoNameFromUrl("https://github.com/acme/pizza-ontology.git")).toBe("pizza-ontology");
    expect(repoNameFromUrl("git@github.com:acme/pizza.git")).toBe("pizza");
    expect(repoNameFromUrl("")).toBe("");
  });

  it("accepts https, ssh and scp-style URLs and rejects the rest", () => {
    expect(gitUrlProblem("https://github.com/acme/pizza.git")).toBeNull();
    expect(gitUrlProblem("ssh://git@example.org/acme/pizza.git")).toBeNull();
    expect(gitUrlProblem("git@github.com:acme/pizza.git")).toBeNull();
    expect(gitUrlProblem("")).toMatch(/Enter/);
    expect(gitUrlProblem("/Users/me/repo")).toMatch(/https:\/\//);
    expect(gitUrlProblem("file:///tmp/repo")).toMatch(/https:\/\//);
    expect(gitUrlProblem("ext::sh -c x")).toMatch(/spaces/);
    expect(gitUrlProblem("https://me:token@github.com/a/b")).toMatch(/token/);
  });

  it("asks for a review only when there is something to report", () => {
    expect(needsReview(response())).toBe(false);
    expect(needsReview(response({ converted: true }))).toBe(true);
    expect(needsReview(response({ selection: "none", ontology_path: null }))).toBe(true);
    expect(needsReview(response({ warnings: ["x"] }))).toBe(true);
  });
});

describe("GitImportForm", () => {
  it("shows the default project name from the URL", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByRole("button", { name: "Import Repository" })).toHaveProperty("disabled", true);
    await user.type(screen.getByLabelText(/Repository URL/), "https://github.com/acme/pizza.git");
    expect(screen.getByLabelText("Project Name").getAttribute("placeholder")).toMatch(/pizza/);
    expect(screen.getByRole("button", { name: "Import Repository" })).toHaveProperty("disabled", false);
  });

  it("rejects a local path without calling the server", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/Repository URL/), "/Users/me/repo");
    await user.click(screen.getByRole("button", { name: "Import Repository" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Invalid repository URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the fields and opens the project when there is nothing to review", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(201, response()));
    const { onImported } = renderForm();
    await user.type(screen.getByLabelText(/Repository URL/), " https://github.com/acme/pizza.git ");
    await user.type(screen.getByLabelText("Branch"), "develop");
    await user.type(screen.getByLabelText("Ontology file"), "src/pizza.ttl");
    await user.click(screen.getByRole("button", { name: "Import Repository" }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/clone");
    expect(JSON.parse(init.body as string)).toEqual({
      url: "https://github.com/acme/pizza.git",
      branch: "develop",
      ontology_path: "src/pizza.ttl",
    });
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });

  it("reports a conversion and the other candidates before opening", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(
        201,
        response({
          converted: true,
          source_path: "src/pizza.owl",
          candidates: [
            { path: "src/pizza.owl", format: "rdfxml", size_bytes: 10, declares_ontology: true },
            { path: "tests/fixture.ttl", format: "turtle", size_bytes: 10, declares_ontology: true },
          ],
        }),
      ),
    );
    const { onImported } = renderForm();
    await user.type(screen.getByLabelText(/Repository URL/), "git@github.com:acme/pizza.git");
    await user.click(screen.getByRole("button", { name: "Import Repository" }));

    const summary = await screen.findByTestId("git-import-summary");
    expect(summary.textContent).toMatch(/Converted from src\/pizza\.owl to Turtle/);
    expect(summary.textContent).toMatch(/tests\/fixture\.ttl/);
    expect(onImported).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Open Project" }));
    expect(onImported).toHaveBeenCalledOnce();
  });

  it("says when the repository has no ontology", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(201, response({ ontology_path: null, source_path: null, selection: "none", candidates: [], warnings: ["The repository has no RDF files"] })),
    );
    renderForm();
    await user.type(screen.getByLabelText(/Repository URL/), "https://github.com/acme/code.git");
    await user.click(screen.getByRole("button", { name: "Import Repository" }));
    expect((await screen.findByTestId("git-import-summary")).textContent).toMatch(/No ontology file/);
  });

  it.each([
    [404, "Repository not found. Check the URL.", "Not found"],
    [403, "Couldn't clone: git could not sign in.", "Sign-in failed"],
    [502, "Couldn't reach github.com.", "Couldn't reach the host"],
    [504, "Cloning took longer than 5 minutes and was stopped.", "Clone timed out"],
    [400, "Only https:// and SSH remote URLs are supported", "Invalid repository URL"],
  ])("shows a %i error from the server", async (status, detail, title) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(status, { detail }));
    const { onImported } = renderForm();
    await user.type(screen.getByLabelText(/Repository URL/), "https://github.com/acme/missing.git");
    await user.click(screen.getByRole("button", { name: "Import Repository" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(title);
    expect(alert.textContent).toContain(detail);
    expect(fetchMock).toHaveBeenCalledOnce(); // no automatic retry of a clone
    expect(onImported).not.toHaveBeenCalled();
  });
});

describe("New project page", () => {
  it("has an Import from Git tab that opens the imported project", async () => {
    const { default: NewProjectPage } = await import("@/app/projects/new/page");
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(201, response()));
    render(
      <TooltipPrimitive.Provider>
        <NewProjectPage />
      </TooltipPrimitive.Provider>,
    );
    expect(screen.queryByLabelText(/Repository URL/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Import from Git/ }));
    await user.type(screen.getByLabelText(/Repository URL/), "https://github.com/acme/pizza.git");
    await user.click(screen.getByRole("button", { name: "Import Repository" }));
    expect(push).toHaveBeenCalledWith("/projects/p1");
  });
});
