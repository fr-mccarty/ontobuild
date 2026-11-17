import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/__tests__/helpers/renderWithProviders";
import type { ImportsResponse } from "@/lib/api/imports";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  candidates: vi.fn(),
}));

vi.mock("@/lib/api/imports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/imports")>()),
  importsApi: api,
}));

import { ImportsManager } from "@/components/project/ImportsManager";
import { IMPORTS_CHANGED_EVENT } from "@/lib/hooks/useOntologyTree";

const B = "http://example.org/onto/b";
const C = "http://example.org/onto/c";
const R = "https://remote.example/onto";

const initial: ImportsResponse = {
  direct: [B],
  closure: [
    { iri: B, source: "project", project_id: "pb", project_name: "Beta", status: "ok", class_count: 3, direct: true, imported_by: ["http://example.org/onto/a"], label: "Beta" },
    { iri: C, source: "project", project_id: "pc", project_name: "Gamma", status: "ok", class_count: 2, direct: false, imported_by: [B], label: "Gamma" },
  ],
};

async function open() {
  const { container } = renderWithQueryClient(<ImportsManager projectId="pa" branch="main" />);
  return container as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue(initial);
  api.candidates.mockResolvedValue([
    { project_id: "pc", name: "Gamma", ontology_iri: C, description: null },
    { project_id: "pd", name: "Delta", ontology_iri: "http://example.org/onto/d", description: "D" },
  ]);
});

describe("ImportsManager", () => {
  it("loads the imports for the given branch", async () => {
    renderWithQueryClient(<ImportsManager projectId="pa" branch="main" />);
    expect(await screen.findAllByTestId("import-row")).toHaveLength(2);
    expect(api.list).toHaveBeenCalledWith("pa", "main");
  });

  it("lists direct imports and the transitive closure", async () => {
    const dialog = await open();
    const rows = await within(dialog).findAllByTestId("import-row");
    expect(rows.map((r) => r.getAttribute("data-iri"))).toEqual([B, C]);
    expect(within(rows[0]).getByText("Beta")).toBeTruthy();
    expect(within(rows[0]).getByText("3 classes")).toBeTruthy();
    expect(within(rows[0]).getByRole("button", { name: `Remove import ${B}` })).toBeTruthy();
    // Indirect imports cannot be removed here and say what imports them.
    expect(within(rows[1]).queryByRole("button", { name: /remove import/i })).toBeNull();
    expect(within(rows[1]).getByText(`Imported by ${B}`)).toBeTruthy();
  });

  it("adds a project found by search", async () => {
    const after: ImportsResponse = { ...initial, direct: [B, "http://example.org/onto/d"] };
    api.add.mockResolvedValue(after);
    const changed = vi.fn();
    window.addEventListener(IMPORTS_CHANGED_EVENT, changed);
    const dialog = await open();
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search OntoBuilder projects" }), { target: { value: "del" } });
    const pick = await within(dialog).findByRole("button", { name: "Import Delta" });
    fireEvent.click(pick);
    await waitFor(() => expect(api.add).toHaveBeenCalledWith("pa", "http://example.org/onto/d", "main"));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    window.removeEventListener(IMPORTS_CHANGED_EVENT, changed);
  });

  it("adds an IRI and shows server errors", async () => {
    api.add.mockRejectedValueOnce(new Error(JSON.stringify({ detail: "An ontology cannot import itself" })));
    api.add.mockResolvedValueOnce({ ...initial, direct: [B, R] });
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("tab", { name: /paste iri/i }));
    const input = within(dialog).getByRole("textbox", { name: "Ontology IRI" });
    fireEvent.change(input, { target: { value: R } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain("An ontology cannot import itself");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.add).toHaveBeenLastCalledWith("pa", R, "main"));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("removes a direct import", async () => {
    api.remove.mockResolvedValue({ direct: [], closure: [] });
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole("button", { name: `Remove import ${B}` }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("pa", B, "main"));
    expect(await within(dialog).findByText(/does not import any other ontology/)).toBeTruthy();
  });
});
