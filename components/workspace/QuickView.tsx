"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { fileExtension, workspaceApi, type WorkspaceEntry } from "@/lib/api/workspace";
import { useWorkspaceFileContent } from "@/lib/hooks/useWorkspace";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { registerTurtleLanguage } from "@/lib/editor/languages/turtle";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
    </div>
  ),
});

export type PreviewKind = "image" | "pdf" | "audio" | "video" | "csv" | "docx" | "markdown" | "text" | "binary";

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];
const AUDIO_EXT = ["mp3", "wav", "ogg", "oga", "m4a", "flac", "aac", "opus"];
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "ogv"];
const BINARY_EXT = [
  "zip", "gz", "tgz", "tar", "bz2", "xz", "7z", "rar", "exe", "dll", "so", "dylib", "bin", "o", "a",
  "class", "jar", "pyc", "wasm", "doc", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "sqlite", "db",
  "woff", "woff2", "ttf", "otf", "eot", "psd", "heic",
];

/** Which renderer Quick View uses for a file, from its extension. Unknown types try the text view. */
export function previewKind(path: string): PreviewKind {
  const ext = fileExtension(path);
  if (IMAGE_EXT.includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "docx") return "docx";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (BINARY_EXT.includes(ext)) return "binary";
  return "text";
}

const LANGUAGES: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", php: "php", r: "r",
  sh: "shell", bash: "shell", zsh: "shell", ps1: "powershell",
  json: "json", jsonld: "json", yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini", cfg: "ini",
  xml: "xml", rdf: "xml", owl: "xml", svg: "xml", html: "html", htm: "html", css: "css", scss: "scss",
  less: "less", sql: "sql", md: "markdown", markdown: "markdown", graphql: "graphql",
  ttl: "turtle", sparql: "sparql", rq: "sparql", dockerfile: "dockerfile", lua: "lua",
};

/** Monaco language id for a path ("plaintext" when unknown). */
export function languageForPath(path: string): string {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "plaintext";
  return LANGUAGES[fileExtension(path)] ?? "plaintext";
}

/** Parses CSV/TSV text, honouring quoted fields (embedded delimiters, newlines and "" escapes). */
export function parseDelimited(text: string, delimiter = ",", maxRows = Infinity): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };
  for (; i < n; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      if (rows.length >= maxRows) return { rows, truncated: i + 1 < n };
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return { rows, truncated: false };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** Tracks the `dark` class on <html> (set by the theme preference). */
export function useIsDarkMode(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const el = document.documentElement;
    const check = () => setDark(el.classList.contains("dark"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

const MAX_CSV_ROWS = 1000;

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
      {children}
    </div>
  );
}

function NoPreview({ rawUrl, size, reason }: { rawUrl: string; size: number; reason?: string }) {
  return (
    <Centered>
      <p className="font-medium text-slate-700 dark:text-slate-200">{reason ?? "No preview available"}</p>
      <p>{formatSize(size)}</p>
      <a
        href={rawUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex items-center gap-1 text-primary-600 hover:underline dark:text-primary-400"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Open raw
      </a>
    </Centered>
  );
}

function renderInline(text: string): ReactNode[] {
  // `code` and **bold**, nothing else; everything stays text (no HTML injection).
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`") && p.length > 1) {
      return (
        <code key={i} className="rounded bg-slate-100 px-1 font-mono text-[0.9em] dark:bg-slate-800">
          {p.slice(1, -1)}
        </code>
      );
    }
    if (p.startsWith("**") && p.endsWith("**") && p.length > 3) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return p;
  });
}

/** A deliberately small Markdown renderer: headings, fenced code, lists, quotes and paragraphs. */
function MarkdownView({ content }: { content: string }) {
  const blocks = useMemo(() => {
    const out: ReactNode[] = [];
    const lines = content.split(/\r?\n/);
    let i = 0;
    let key = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("```")) {
        const code: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
        i++;
        out.push(
          <pre key={key++} className="overflow-x-auto rounded-md bg-slate-100 p-3 font-mono text-xs dark:bg-slate-800">
            {code.join("\n")}
          </pre>,
        );
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        const size = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"][level - 1];
        out.push(
          <p key={key++} role="heading" aria-level={level} className={cn("font-semibold text-slate-900 dark:text-white", size)}>
            {renderInline(heading[2])}
          </p>,
        );
        i++;
        continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const items: string[] = [];
        const ordered = /^\s*\d+\./.test(line);
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
          i++;
        }
        const List = ordered ? "ol" : "ul";
        out.push(
          <List key={key++} className={cn("ml-5 space-y-1", ordered ? "list-decimal" : "list-disc")}>
            {items.map((it, j) => (
              <li key={j}>{renderInline(it)}</li>
            ))}
          </List>,
        );
        continue;
      }
      if (line.startsWith(">")) {
        const quote: string[] = [];
        while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
        out.push(
          <blockquote key={key++} className="border-l-4 border-slate-300 pl-3 text-slate-600 dark:border-slate-600 dark:text-slate-400">
            {renderInline(quote.join(" "))}
          </blockquote>,
        );
        continue;
      }
      if (line.trim() === "") {
        i++;
        continue;
      }
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
        para.push(lines[i++]);
      }
      out.push(<p key={key++}>{renderInline(para.join(" "))}</p>);
    }
    return out;
  }, [content]);
  return (
    <div data-testid="quickview-markdown" className="h-full overflow-auto px-8 py-6 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
      <div className="mx-auto max-w-3xl space-y-3">{blocks}</div>
    </div>
  );
}

function CsvView({ content, tsv }: { content: string; tsv: boolean }) {
  const { rows, truncated } = useMemo(() => parseDelimited(content, tsv ? "\t" : ",", MAX_CSV_ROWS + 1), [content, tsv]);
  const [header, ...body] = rows;
  const shown = body.slice(0, MAX_CSV_ROWS);
  const more = truncated || body.length > MAX_CSV_ROWS;
  if (!header) return <Centered>Empty file</Centered>;
  return (
    <div className="h-full overflow-auto">
      <table data-testid="quickview-table" className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
          <tr>
            {header.map((h, i) => (
              <th key={i} className="border-b border-slate-200 px-2 py-1.5 text-left font-semibold whitespace-nowrap text-slate-700 dark:border-slate-700 dark:text-slate-200">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="odd:bg-white even:bg-slate-50 dark:odd:bg-slate-900 dark:even:bg-slate-800/50">
              {r.map((c, j) => (
                <td key={j} className="max-w-xs truncate border-b border-slate-100 px-2 py-1 text-slate-700 dark:border-slate-800 dark:text-slate-300">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more && (
        <p className="p-2 text-center text-xs text-slate-500 dark:text-slate-400">
          Showing the first {MAX_CSV_ROWS.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}

const DOCX_STYLE = `<style>body{font:14px/1.6 system-ui,sans-serif;max-width:48rem;margin:1.5rem auto;padding:0 1.5rem;color:#1e293b;background:#fff}
img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px}</style>`;

function DocxView({ rawUrl, size }: { rawUrl: string; size: number }) {
  const [state, setState] = useState<{ url: string; html?: string; error?: boolean }>({ url: "" });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(rawUrl);
        if (!res.ok) throw new Error(String(res.status));
        const arrayBuffer = await res.arrayBuffer();
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) setState({ url: rawUrl, html: result.value });
      } catch {
        if (!cancelled) setState({ url: rawUrl, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawUrl]);
  if (state.url !== rawUrl) {
    return (
      <Centered>
        <Loader2 className="h-5 w-5 animate-spin" />
      </Centered>
    );
  }
  if (state.error) return <NoPreview rawUrl={rawUrl} size={size} reason="Couldn't read this Word document" />;
  // sandbox="" : no scripts, no same-origin access, no forms; mammoth output is shown inert.
  return (
    <iframe
      data-testid="quickview-docx"
      aria-label="Document preview"
      sandbox=""
      srcDoc={`<!doctype html><html><head><meta charset="utf-8">${DOCX_STYLE}</head><body>${state.html ?? ""}</body></html>`}
      className="h-full w-full bg-white"
    />
  );
}

function TextPreview({ projectId, entry, kind }: { projectId: string; entry: WorkspaceEntry; kind: "text" | "markdown" | "csv" }) {
  const dark = useIsDarkMode();
  const { data, error, isLoading } = useWorkspaceFileContent(projectId, entry.path);
  const rawUrl = workspaceApi.rawUrl(projectId, entry.path);
  if (isLoading) {
    return (
      <Centered>
        <Loader2 className="h-5 w-5 animate-spin" />
      </Centered>
    );
  }
  if (error) {
    if (error instanceof ApiError && error.status === 413) {
      return <NoPreview rawUrl={rawUrl} size={entry.size} reason="Too large to preview" />;
    }
    if (error instanceof ApiError && error.status === 415) return <NoPreview rawUrl={rawUrl} size={entry.size} />;
    return <NoPreview rawUrl={rawUrl} size={entry.size} reason="Couldn't load this file" />;
  }
  const content = data?.content ?? "";
  if (kind === "markdown") return <MarkdownView content={content} />;
  if (kind === "csv") return <CsvView content={content} tsv={fileExtension(entry.path) === "tsv"} />;
  return (
    <div data-testid="quickview-code" className="h-full">
      <MonacoEditor
        height="100%"
        language={languageForPath(entry.path)}
        value={content}
        theme={dark ? "vs-dark" : "light"}
        beforeMount={(monaco) => {
          if (languageForPath(entry.path) === "turtle") registerTurtleLanguage(monaco);
        }}
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          wordWrap: "on",
          renderLineHighlight: "none",
        }}
      />
    </div>
  );
}

/** The preview area for one file, picking the renderer by type. */
export function FilePreview({ projectId, entry }: { projectId: string; entry: WorkspaceEntry }) {
  const kind = previewKind(entry.path);
  const rawUrl = workspaceApi.rawUrl(projectId, entry.path);
  const name = entry.path.split("/").pop() ?? entry.path;
  switch (kind) {
    case "image":
      return (
        <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(#e2e8f0_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4 dark:bg-[repeating-conic-gradient(#1e293b_0%_25%,transparent_0%_50%)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary local file, not an optimisable asset */}
          <img src={rawUrl} alt={name} className="max-h-full max-w-full object-contain" />
        </div>
      );
    case "pdf":
      return <iframe data-testid="quickview-pdf" aria-label={name} src={rawUrl} className="h-full w-full bg-white" />;
    case "audio":
      return (
        <Centered>
          <audio data-testid="quickview-audio" controls src={rawUrl} className="w-full max-w-md" />
        </Centered>
      );
    case "video":
      return (
        <div className="flex h-full items-center justify-center bg-black">
          <video data-testid="quickview-video" controls src={rawUrl} className="max-h-full max-w-full" />
        </div>
      );
    case "docx":
      return <DocxView rawUrl={rawUrl} size={entry.size} />;
    case "binary":
      return <NoPreview rawUrl={rawUrl} size={entry.size} />;
    default:
      return <TextPreview projectId={projectId} entry={entry} kind={kind} />;
  }
}

interface QuickViewProps {
  projectId: string;
  /** The file shown; null closes the view. */
  entry: WorkspaceEntry | null;
  onClose: () => void;
  /** Files in the panel's visible order, for previous/next navigation. */
  siblings?: WorkspaceEntry[];
  onNavigate?: (entry: WorkspaceEntry) => void;
}

/** macOS Quick Look style preview: a centered modal; Space or Esc closes it, arrows step through files. */
export function QuickView({ projectId, entry, onClose, siblings = [], onNavigate }: QuickViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const index = entry ? siblings.findIndex((s) => s.path === entry.path) : -1;
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const name = entry ? (entry.path.split("/").pop() ?? entry.path) : "";
  const dir = entry && entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";

  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "SELECT";
    if (e.key === " " && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (!onNavigate || typing) return;
    // Media elements and the code view use arrows themselves only when focused inside them.
    const inWidget = target.closest(".monaco-editor") || target.tagName === "VIDEO" || target.tagName === "AUDIO";
    if (inWidget) return;
    if ((e.key === "ArrowLeft" || e.key === "ArrowUp") && prev) {
      e.preventDefault();
      onNavigate(prev);
    } else if ((e.key === "ArrowRight" || e.key === "ArrowDown") && next) {
      e.preventDefault();
      onNavigate(next);
    }
  };

  const navButton = "rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white";

  return (
    <DialogPrimitive.Root open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          ref={contentRef}
          data-testid="quickview"
          onKeyDownCapture={onKeyDownCapture}
          onOpenAutoFocus={(e) => {
            // Focus the dialog itself (not the first button) so arrows and Space work immediately.
            e.preventDefault();
            contentRef.current?.focus();
          }}
          tabIndex={-1}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 outline-none flex h-[min(80vh,900px)] w-[min(92vw,1100px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
            {onNavigate && (
              <div className="flex items-center">
                <Tooltip side="bottom" content="Previous file (Left arrow)">
                  <button type="button" aria-label="Previous file" className={navButton} disabled={!prev} onClick={() => prev && onNavigate(prev)}>
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </Tooltip>
                <Tooltip side="bottom" content="Next file (Right arrow)">
                  <button type="button" aria-label="Next file" className={navButton} disabled={!next} onClick={() => next && onNavigate(next)}>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </Tooltip>
              </div>
            )}
            <div className="min-w-0 flex-1 text-center">
              <DialogPrimitive.Title className="truncate text-sm font-semibold text-slate-900 dark:text-white">{name}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="truncate text-xs text-slate-500 dark:text-slate-400">
                {dir ? `${dir} · ` : ""}
                {entry ? formatSize(entry.size) : ""}
              </DialogPrimitive.Description>
            </div>
            {entry && (
              <Tooltip side="bottom" content="Open the raw file in a new tab">
                <a
                  href={workspaceApi.rawUrl(projectId, entry.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open raw"
                  className={navButton}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Tooltip>
            )}
            <Tooltip side="bottom" content="Close (Space or Esc)">
              <DialogPrimitive.Close aria-label="Close Quick View" className={navButton}>
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </Tooltip>
          </div>
          <div className="min-h-0 flex-1">{entry && <FilePreview key={entry.path} projectId={projectId} entry={entry} />}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
