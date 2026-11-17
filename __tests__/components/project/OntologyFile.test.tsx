import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/__tests__/helpers/renderWithProviders";
import type { OntologyFileChange, OntologyFileList, Project } from "@/lib/api/projects";

const api = vi.hoisted(() => ({
  listOntologyFiles: vi.fn(),
  switchOntologyFile: vi.fn(),
  createOntologyFile: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock("@/lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/projects")>();
  return { ...actual, projectApi: { ...actual.projectApi, ...api } };
});
vi.mock("@/lib/context/ToastContext", () => ({ useToast: () => toast }));

import { NewOntologyDialog, OntologyFileMenu, OntologyFilePanel, OntologyLoadError } from "@/components/project/OntologyFile";
import { useSelectionStore } from "@/lib/stores/selectionStore";

const FILES: OntologyFileList = {
  project_id: "p1",
  branch: "main",
  active_path: "ontology.ttl",
  active_exists: true,
  suggested_file_name: "ontology-2.ttl",
  files: [
    { path: "ontology.ttl", format: "turtle", size_bytes: 2048, declares_ontology: true, active: true, turtle_path: null, turtle_exists: false },
    { path: "src/tea.ttl", format: "turtle", size_bytes: 512, declares_ontology: true, active: false, turtle_path: null, turtle_exists: false },
    { path: "src/wine.owl", format: "rdfxml", size_bytes: 900, declares_ontology: true, active: false, turtle_path: "src/wine.ttl", turtle_exists: false },
    { path: "src/beer.jsonld", format: "jsonld", size_bytes: 300, declares_ontology: true, active: false, turtle_path: "src/beer.ttl", turtle_exists: true },
  ],
};

function change(over: Partial<OntologyFileChange> = {}): OntologyFileChange {
  return {
    project: { id: "p1", name: "Drinks" } as Project,
    branch: "main",
    path: "src/tea.ttl",
    source_path: "src/tea.ttl",
    converted: false,
    reused: false,
    replaced: false,
    previous_path: "ontology.ttl",
    commit_hash: null,
    warnings: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listOntologyFiles.mockResolvedValue(FILES);
  api.switchOntologyFile.mockResolvedValue(change());
  api.createOntologyFile.mockResolvedValue(change({ path: "ontology-2.ttl", source_path: "ontology-2.ttl", commit_hash: "abc" }));
});

function renderMenu(over: Partial<Parameters<typeof OntologyFileMenu>[0]> = {}) {
  return renderWithQueryClient(
    <OntologyFileMenu projectId="p1" branch="main" activePath="ontology.ttl" projectName="Drinks" {...over} />,
  );
}

async function openMenu() {
  fireEvent.click(screen.getByTestId("ontology-file-button"));
  const menu = screen.getByRole("menu", { name: "Ontology file" });
  await within(menu).findByText("src/tea.ttl");
  return menu;
}

describe("OntologyFileMenu (breadcrumb)", () => {
  it("shows the active file's name and lists the folder's RDF files on the branch", async () => {
    renderMenu();
    expect(screen.getByTestId("ontology-file-button").textContent).toContain("ontology.ttl");
    const menu = await openMenu();
    expect(api.listOntologyFiles).toHaveBeenCalledWith("p1", "main");
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("ontology.ttl"),
      expect.stringContaining("src/tea.ttl"),
      expect.stringContaining("src/wine.owl"),
      expect.stringContaining("src/beer.jsonld"),
    ]);
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    expect(items[1].getAttribute("aria-checked")).toBe("false");
    expect(items[2].textContent).toContain("RDF/XML");
    expect(items[2].textContent).toContain("Converts to src/wine.ttl");
    expect(items[3].textContent).toContain("Uses src/beer.ttl");
    // Tells the user that other formats are converted to Turtle.
    expect(within(menu).getByText(/converts it to a \.ttl file next to it/)).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /New ontology/ })).toBeTruthy();
  });

  it("switches to a Turtle file right away, refreshing the project and clearing the selection", async () => {
    useSelectionStore.getState().setSelection("http://example.org/x", "class");
    const onChanged = vi.fn();
    renderMenu({ onChanged });
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /src\/tea\.ttl/ }));
    await waitFor(() => expect(api.switchOntologyFile).toHaveBeenCalledWith("p1", "src/tea.ttl", "main"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(useSelectionStore.getState().iri).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      "The project now edits src/tea.ttl",
      expect.stringContaining("ontology.ttl is unchanged"),
    );
  });

  it("does nothing for the active file", async () => {
    renderMenu();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { checked: true }));
    expect(api.switchOntologyFile).not.toHaveBeenCalled();
  });

  it("asks before converting a file that isn't Turtle, and says what is committed", async () => {
    api.switchOntologyFile.mockResolvedValue(
      change({ path: "src/wine.ttl", source_path: "src/wine.owl", converted: true, commit_hash: "abc" }),
    );
    renderMenu();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /src\/wine\.owl/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/src\/wine\.owl is RDF\/XML, so it will be converted and saved as src\/wine\.ttl, committed on branch main/);
    expect(api.switchOntologyFile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert and switch" }));
    await waitFor(() => expect(api.switchOntologyFile).toHaveBeenCalledWith("p1", "src/wine.owl", "main"));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "The project now edits src/wine.ttl",
        expect.stringContaining("src/wine.owl was converted to Turtle and committed as src/wine.ttl"),
      ),
    );
  });

  it("uses an existing converted file without asking", async () => {
    renderMenu();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /src\/beer\.jsonld/ }));
    await waitFor(() => expect(api.switchOntologyFile).toHaveBeenCalledWith("p1", "src/beer.jsonld", "main"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("when the existing .ttl is out of date", () => {
    async function outOfDate() {
      const { ApiError } = await import("@/lib/api/client");
      return new ApiError(
        409,
        "Conflict",
        JSON.stringify({
          detail: "src/beer.ttl doesn't have the same triples as src/beer.jsonld, so it may be out of date. Choose…",
          code: "turtle_out_of_date",
          source_path: "src/beer.jsonld",
          turtle_path: "src/beer.ttl",
          reason: "src/beer.ttl doesn't have the same triples as src/beer.jsonld",
        }),
      );
    }

    async function chooseBeer() {
      renderMenu();
      const menu = await openMenu();
      fireEvent.click(within(menu).getByRole("menuitemradio", { name: /src\/beer\.jsonld/ }));
      const dialog = await screen.findByTestId("out-of-date-turtle-dialog");
      expect(api.switchOntologyFile).toHaveBeenCalledWith("p1", "src/beer.jsonld", "main");
      return dialog;
    }

    it("asks whether to use the existing file or convert again", async () => {
      api.switchOntologyFile.mockRejectedValueOnce(await outOfDate());
      const dialog = await chooseBeer();
      expect(dialog.textContent).toMatch(/beer\.ttl may be out of date/);
      expect(dialog.textContent).toMatch(/doesn't have the same triples as src\/beer\.jsonld/);
      expect(within(dialog).getByRole("button", { name: "Use the existing file" })).toBeTruthy();
      expect(
        within(dialog).getByRole("button", { name: "Convert again (overwrites beer.ttl with a new commit on main)" }),
      ).toBeTruthy();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("uses the existing file when asked to", async () => {
      api.switchOntologyFile
        .mockRejectedValueOnce(await outOfDate())
        .mockResolvedValueOnce(change({ path: "src/beer.ttl", source_path: "src/beer.jsonld", reused: true }));
      const dialog = await chooseBeer();
      fireEvent.click(within(dialog).getByRole("button", { name: "Use the existing file" }));
      await waitFor(() =>
        expect(api.switchOntologyFile).toHaveBeenLastCalledWith("p1", "src/beer.jsonld", "main", { reconvert: false }),
      );
      await waitFor(() => expect(screen.queryByTestId("out-of-date-turtle-dialog")).toBeNull());
      expect(toast.success).toHaveBeenCalledWith("The project now edits src/beer.ttl", expect.anything());
    });

    it("converts again when asked to, and says the file was replaced", async () => {
      api.switchOntologyFile
        .mockRejectedValueOnce(await outOfDate())
        .mockResolvedValueOnce(
          change({ path: "src/beer.ttl", source_path: "src/beer.jsonld", converted: true, replaced: true, commit_hash: "abc" }),
        );
      const dialog = await chooseBeer();
      fireEvent.click(within(dialog).getByRole("button", { name: /Convert again/ }));
      await waitFor(() =>
        expect(api.switchOntologyFile).toHaveBeenLastCalledWith("p1", "src/beer.jsonld", "main", { reconvert: true }),
      );
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          "The project now edits src/beer.ttl",
          expect.stringContaining("committed as src/beer.ttl on branch main (not pushed), replacing the earlier beer.ttl"),
        ),
      );
    });
  });

  it("shows an error when the switch fails", async () => {
    const { ApiError } = await import("@/lib/api/client");
    api.switchOntologyFile.mockRejectedValue(new ApiError(422, "Unprocessable", JSON.stringify({ detail: "Failed to parse src/tea.ttl" })));
    renderMenu();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /src\/tea\.ttl/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't switch to src/tea.ttl", "Failed to parse src/tea.ttl"));
  });

  it("warns when the active file is missing on this branch", async () => {
    api.listOntologyFiles.mockResolvedValue({ ...FILES, branch: "feature", active_exists: false });
    renderMenu({ branch: "feature" });
    await waitFor(() => expect(screen.getByTestId("ontology-file-button").className).toContain("amber"));
    const menu = await openMenu();
    expect(within(menu).getByTestId("ontology-file-missing").textContent).toMatch(/ontology\.ttl isn't on branch feature/);
  });

  it("opens the New ontology dialog with the replace warning, since an ontology exists", async () => {
    renderMenu();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /New ontology/ }));
    const dialog = await screen.findByTestId("new-ontology-dialog");
    expect(within(dialog).getByTestId("new-ontology-replace-warning").textContent).toMatch(
      /already has an ontology: ontology\.ttl.*one ontology at a time.*switch back/,
    );
    expect((within(dialog).getByLabelText("File name") as HTMLInputElement).value).toBe("ontology-2.ttl");
    expect(within(dialog).getByRole("button", { name: "Create and switch" })).toBeTruthy();
  });
});

describe("NewOntologyDialog", () => {
  function renderDialog(over: Partial<Parameters<typeof NewOntologyDialog>[0]> = {}) {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    renderWithQueryClient(
      <NewOntologyDialog
        open
        onOpenChange={onOpenChange}
        activePath={null}
        branch="main"
        projectName="Wine Cellar"
        suggestedFileName="ontology.ttl"
        existingPaths={["data.ttl"]}
        onCreate={onCreate}
        {...over}
      />,
    );
    return { onCreate, onOpenChange, dialog: screen.getByTestId("new-ontology-dialog") };
  }

  it("needs no warning when the project has no ontology, and suggests a name, title and IRI", async () => {
    const { onCreate, onOpenChange, dialog } = renderDialog();
    expect(within(dialog).queryByTestId("new-ontology-replace-warning")).toBeNull();
    expect((within(dialog).getByLabelText("Title") as HTMLInputElement).value).toBe("Wine Cellar");
    expect((within(dialog).getByLabelText("Ontology IRI") as HTMLInputElement).value).toBe(
      "http://example.org/ontologies/wine-cellar",
    );
    expect(dialog.textContent).toContain("commits it on branch main");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create ontology" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        file_name: "ontology.ttl",
        ontology_iri: "http://example.org/ontologies/wine-cellar",
        title: "Wine Cellar",
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("warns that the new file replaces the active ontology when there is one", () => {
    const { dialog } = renderDialog({ activePath: "src/old.ttl" });
    expect(within(dialog).getByTestId("new-ontology-replace-warning").textContent).toMatch(
      /src\/old\.ttl.*becomes the active ontology.*old\.ttl stays in the project folder unchanged/,
    );
  });

  it("follows the title in the IRI until the IRI is edited", () => {
    const { dialog } = renderDialog();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Red Wines" } });
    const iri = within(dialog).getByLabelText("Ontology IRI") as HTMLInputElement;
    expect(iri.value).toBe("http://example.org/ontologies/red-wines");
    fireEvent.change(iri, { target: { value: "https://w3id.org/wine" } });
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "White Wines" } });
    expect(iri.value).toBe("https://w3id.org/wine");
  });

  it("validates the file name, IRI and title before creating", () => {
    const { dialog, onCreate } = renderDialog();
    const submit = within(dialog).getByRole("button", { name: "Create ontology" }) as HTMLButtonElement;
    const name = within(dialog).getByLabelText("File name");
    for (const [value, message] of [
      ["wine.owl", /must end in \.ttl/],
      ["../wine.ttl", /inside the project folder/],
      ["data.ttl", /data\.ttl already exists/],
      ["", /Enter a file name/],
    ] as const) {
      fireEvent.change(name, { target: { value } });
      expect(dialog.textContent).toMatch(message);
      expect(submit.disabled).toBe(true);
    }
    fireEvent.change(name, { target: { value: "src/wine.ttl" } });
    expect(submit.disabled).toBe(false);
    fireEvent.change(within(dialog).getByLabelText("Ontology IRI"), { target: { value: "not an iri" } });
    expect(dialog.textContent).toMatch(/absolute IRI/);
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Ontology IRI"), { target: { value: "http://example.org/w" } });
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: " " } });
    expect(submit.disabled).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows the server's error and stays open", async () => {
    const { ApiError } = await import("@/lib/api/client");
    const onCreate = vi.fn().mockRejectedValue(new ApiError(409, "Conflict", JSON.stringify({ detail: "ontology.ttl already exists on branch 'main'." })));
    const { dialog, onOpenChange } = renderDialog({ onCreate });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create ontology" }));
    expect(await within(dialog).findByText("ontology.ttl already exists on branch 'main'.")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("OntologyFilePanel", () => {
  it("lists the files with Use buttons and creates a new ontology", async () => {
    renderWithQueryClient(<OntologyFilePanel projectId="p1" branch="main" projectName="Drinks" />);
    const list = await screen.findByRole("list", { name: "RDF files in the project folder on branch main" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("Active")).toBeTruthy();
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Use src/tea.ttl" }));
    await waitFor(() => expect(api.switchOntologyFile).toHaveBeenCalledWith("p1", "src/tea.ttl", "main"));

    fireEvent.click(screen.getByRole("button", { name: /New ontology/ }));
    const dialog = await screen.findByTestId("new-ontology-dialog");
    expect(within(dialog).getByTestId("new-ontology-replace-warning")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and switch" }));
    await waitFor(() =>
      expect(api.createOntologyFile).toHaveBeenCalledWith("p1", {
        file_name: "ontology-2.ttl",
        ontology_iri: "http://example.org/ontologies/drinks",
        title: "Drinks",
        branch: "main",
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Created ontology-2.ttl", expect.stringContaining("Committed on branch main")));
  });

  it("offers only New ontology, without a warning, when the folder has no RDF files", async () => {
    api.listOntologyFiles.mockResolvedValue({ ...FILES, active_path: null, active_exists: false, files: [], suggested_file_name: "ontology.ttl" });
    renderWithQueryClient(<OntologyFilePanel projectId="p1" projectName="Drinks" />);
    expect(await screen.findByText(/No RDF files .* are committed in the project folder on branch main/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /New ontology/ }));
    const dialog = await screen.findByTestId("new-ontology-dialog");
    expect(within(dialog).queryByTestId("new-ontology-replace-warning")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Create ontology" })).toBeTruthy();
  });
});

describe("OntologyLoadError (entity tree)", () => {
  const MISSING: OntologyFileList = { ...FILES, branch: "feature", active_exists: false };

  function renderError(message = "Ontology file not found in repository: ontology.ttl doesn't exist on branch 'feature'.") {
    return renderWithQueryClient(
      <OntologyLoadError message={message} projectId="p1" branch="feature" projectName="Drinks" />,
    );
  }

  it("explains a file that isn't on the branch, with the file name, branch and ways out", async () => {
    api.listOntologyFiles.mockResolvedValue(MISSING);
    renderError();
    const notice = await screen.findByTestId("ontology-file-missing-notice");
    expect(api.listOntologyFiles).toHaveBeenCalledWith("p1", "feature");
    expect(notice.textContent).toMatch(/ontology\.ttl isn't on branch feature/);
    expect(notice.textContent).toMatch(/switch to a branch that has ontology\.ttl from the Repository menu/);
    // No raw JSON or server wording.
    expect(notice.textContent).not.toMatch(/detail|\{/);
    expect(within(notice).getByRole("button", { name: /New ontology/ })).toBeTruthy();

    // "Choose another file" lists the files on the branch; choosing one switches.
    fireEvent.click(within(notice).getByRole("button", { name: /Choose another file/ }));
    const list = within(notice).getByRole("list", { name: "RDF files on branch feature" });
    fireEvent.click(within(list).getByRole("button", { name: "Use src/tea.ttl" }));
    await waitFor(() => expect(api.switchOntologyFile).toHaveBeenCalledWith("p1", "src/tea.ttl", "feature"));
  });

  it("opens the New ontology dialog", async () => {
    api.listOntologyFiles.mockResolvedValue(MISSING);
    renderError();
    const notice = await screen.findByTestId("ontology-file-missing-notice");
    fireEvent.click(within(notice).getByRole("button", { name: /New ontology/ }));
    const dialog = await screen.findByTestId("new-ontology-dialog");
    expect(dialog.textContent).toContain("on branch feature");
  });

  it("shows any other error's message", async () => {
    renderError("Failed to parse ontology: bad token");
    const box = await screen.findByTestId("ontology-load-error");
    expect(box.textContent).toBe("Failed to parse ontology: bad token");
    await waitFor(() => expect(api.listOntologyFiles).toHaveBeenCalled());
    expect(screen.queryByTestId("ontology-file-missing-notice")).toBeNull();
  });
});
