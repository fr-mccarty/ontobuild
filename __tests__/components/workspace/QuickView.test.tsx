import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/__tests__/helpers/renderWithProviders";
import { ApiError } from "@/lib/api/client";
import { workspaceApiMock } from "./workspaceMocks";

vi.mock("@/lib/api/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/workspace")>()),
  workspaceApi: (await import("./workspaceMocks")).workspaceApiMock,
}));
vi.mock("next/dynamic", async () => (await import("./workspaceMocks")).dynamicMock);

import { FilePreview, QuickView, languageForPath, parseDelimited, previewKind } from "@/components/workspace/QuickView";

const file = (path: string, size = 100) => ({ path, type: "file" as const, size });

describe("previewKind / languageForPath", () => {
  it("maps extensions to renderers", () => {
    expect(previewKind("img/logo.PNG")).toBe("image");
    expect(previewKind("paper.pdf")).toBe("pdf");
    expect(previewKind("a.mp3")).toBe("audio");
    expect(previewKind("a.mp4")).toBe("video");
    expect(previewKind("data.tsv")).toBe("csv");
    expect(previewKind("report.docx")).toBe("docx");
    expect(previewKind("README.md")).toBe("markdown");
    expect(previewKind("code/app.py")).toBe("text");
    expect(previewKind("Makefile")).toBe("text");
    expect(previewKind("bundle.zip")).toBe("binary");
    expect(languageForPath("x.ts")).toBe("typescript");
    expect(languageForPath("x.unknownext")).toBe("plaintext");
  });
});

describe("parseDelimited", () => {
  it("handles quotes, escaped quotes, embedded delimiters and newlines", () => {
    const { rows } = parseDelimited('a,b,c\r\n1,"x, y","say ""hi"""\n2,"multi\nline",3\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "multi\nline", "3"],
    ]);
  });

  it("caps rows", () => {
    const { rows, truncated } = parseDelimited("a\n1\n2\n3\n", ",", 2);
    expect(rows).toEqual([["a"], ["1"]]);
    expect(truncated).toBe(true);
  });
});

describe("FilePreview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders images with the raw URL", () => {
    renderWithQueryClient(<FilePreview projectId="p1" entry={file("img/logo.png")} />);
    const img = screen.getByRole("img", { name: "logo.png" });
    expect(img.getAttribute("src")).toBe("/api/v1/projects/p1/files/raw?path=img%2Flogo.png");
  });

  it("renders PDFs in an iframe", () => {
    renderWithQueryClient(<FilePreview projectId="p1" entry={file("paper.pdf")} />);
    expect(screen.getByTestId("quickview-pdf").getAttribute("src")).toContain("files/raw?path=paper.pdf");
  });

  it("renders audio and video players", () => {
    const { unmount } = renderWithQueryClient(<FilePreview projectId="p1" entry={file("a.mp3")} />);
    expect(screen.getByTestId("quickview-audio")).toBeTruthy();
    unmount();
    renderWithQueryClient(<FilePreview projectId="p1" entry={file("a.webm")} />);
    expect(screen.getByTestId("quickview-video")).toBeTruthy();
  });

  it("renders CSV as a table", async () => {
    workspaceApiMock.readFile.mockResolvedValue({ path: "d.csv", content: 'name,note\nAda,"likes, commas"\n', size: 30 });
    renderWithQueryClient(<FilePreview projectId="p1" entry={file("d.csv")} />);
    const table = await screen.findByTestId("quickview-table");
    expect(table.querySelectorAll("th")).toHaveLength(2);
    expect(screen.getByText("likes, commas")).toBeTruthy();
  });

  it("renders code in a read-only editor with the language from the extension", async () => {
    workspaceApiMock.readFile.mockResolvedValue({ path: "app.ts", content: "const x = 1;", size: 12 });
    renderWithQueryClient(<FilePreview projectId="p1" entry={file("app.ts")} />);
    const editor = await screen.findByTestId("dynamic-component");
    expect(editor.getAttribute("data-language")).toBe("typescript");
    expect(editor.getAttribute("data-value")).toBe("const x = 1;");
  });

  it("renders markdown", async () => {
    workspaceApiMock.readFile.mockResolvedValue({ path: "r.md", content: "# Title\n\nSome **bold** text", size: 20 });
    renderWithQueryClient(<FilePreview projectId="p1" entry={file("r.md")} />);
    expect(await screen.findByRole("heading", { name: "Title" })).toBeTruthy();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("says when a file is too large", async () => {
    workspaceApiMock.readFile.mockRejectedValue(new ApiError(413, "Payload Too Large", "too large"));
    renderWithQueryClient(<FilePreview projectId="p1" entry={file("big.log", 50_000_000)} />);
    expect(await screen.findByText("Too large to preview")).toBeTruthy();
  });

  it("offers the raw file for binaries", async () => {
    workspaceApiMock.readFile.mockRejectedValue(new ApiError(415, "Unsupported Media Type", "binary"));
    renderWithQueryClient(<FilePreview projectId="p1" entry={file("blob.dat", 2048)} />);
    expect(await screen.findByText("No preview available")).toBeTruthy();
    expect(screen.getByText("Open raw").closest("a")?.getAttribute("href")).toContain("files/raw?path=blob.dat");
  });

  it("renders docx through mammoth into a sandboxed iframe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }));
    vi.doMock("mammoth", () => ({
      convertToHtml: vi.fn().mockResolvedValue({ value: "<p>Hello doc</p><script>alert(1)</script>", messages: [] }),
    }));
    renderWithQueryClient(<FilePreview projectId="p1" entry={file("r.docx")} />);
    const frame = await screen.findByTestId("quickview-docx");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("Hello doc");
    vi.unstubAllGlobals();
  });
});

describe("QuickView", () => {
  it("steps to the next file with the arrow keys and closes with Escape", async () => {
    workspaceApiMock.readFile.mockResolvedValue({ path: "a.txt", content: "a", size: 1 });
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const siblings = [file("a.txt"), file("b.png")];
    renderWithQueryClient(
      <QuickView projectId="p1" entry={siblings[0]} siblings={siblings} onNavigate={onNavigate} onClose={onClose} />,
    );
    const dialog = await screen.findByTestId("quickview");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith(siblings[1]);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
