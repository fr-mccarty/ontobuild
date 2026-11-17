import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OntologyLocalChanges } from "@/lib/api/projects";
import { OntologyLocalChangesNotice } from "@/components/project/OntologyLocalChangesNotice";

const api = vi.hoisted(() => ({
  getOntologyLocalChanges: vi.fn(),
  commitOntologyLocalChanges: vi.fn(),
}));
vi.mock("@/lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/projects")>();
  return { ...actual, projectApi: { ...actual.projectApi, ...api } };
});

const CHANGED: OntologyLocalChanges = { branch: "main", path: "ontology.ttl", changed: true, problem: null };

function renderNotice(activeBranch = "main", onCommitted = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OntologyLocalChangesNotice projectId="p1" activeBranch={activeBranch} onCommitted={onCommitted} />
    </QueryClientProvider>,
  );
  return onCommitted;
}

beforeEach(() => {
  api.getOntologyLocalChanges.mockReset();
  api.commitOntologyLocalChanges.mockReset();
});

describe("OntologyLocalChangesNotice", () => {
  it("shows nothing when the folder matches the last commit", async () => {
    api.getOntologyLocalChanges.mockResolvedValue({ ...CHANGED, changed: false });
    renderNotice();
    await waitFor(() => expect(api.getOntologyLocalChanges).toHaveBeenCalled());
    expect(screen.queryByTestId("ontology-local-changes")).toBeNull();
  });

  it("shows nothing when the editor is on another branch than the folder", async () => {
    api.getOntologyLocalChanges.mockResolvedValue(CHANGED);
    renderNotice("feature");
    await waitFor(() => expect(api.getOntologyLocalChanges).toHaveBeenCalled());
    expect(screen.queryByTestId("ontology-local-changes")).toBeNull();
  });

  it("says the editor isn't showing the changes, and commits and reloads", async () => {
    api.getOntologyLocalChanges.mockResolvedValue(CHANGED);
    api.commitOntologyLocalChanges.mockResolvedValue({ branch: "main", path: "ontology.ttl", commit_hash: "abc" });
    const onCommitted = renderNotice();
    const notice = await screen.findByTestId("ontology-local-changes");
    expect(notice.textContent).toContain("ontology.ttl has changes in the project folder that aren't committed");
    api.getOntologyLocalChanges.mockResolvedValue({ ...CHANGED, changed: false });
    fireEvent.click(screen.getByRole("button", { name: "Commit and reload" }));
    await waitFor(() => expect(onCommitted).toHaveBeenCalled());
    expect(api.commitOntologyLocalChanges).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(screen.queryByTestId("ontology-local-changes")).toBeNull());
  });

  it("explains a file that can't be committed and disables the button", async () => {
    api.getOntologyLocalChanges.mockResolvedValue({ ...CHANGED, problem: "The file doesn't parse as Turtle: bad token" });
    renderNotice();
    expect((await screen.findByTestId("ontology-local-changes")).textContent).toContain("bad token");
    expect((screen.getByRole("button", { name: "Commit and reload" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows why a commit failed", async () => {
    api.getOntologyLocalChanges.mockResolvedValue(CHANGED);
    api.commitOntologyLocalChanges.mockRejectedValue(new Error("The ontology file has no uncommitted changes"));
    const onCommitted = renderNotice();
    fireEvent.click(await screen.findByRole("button", { name: "Commit and reload" }));
    expect(await screen.findByText("The ontology file has no uncommitted changes")).toBeDefined();
    expect(onCommitted).not.toHaveBeenCalled();
  });
});
