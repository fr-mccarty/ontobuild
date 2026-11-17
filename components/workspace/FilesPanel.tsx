"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Loader2,
  Play,
  RefreshCw,
  Search,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { fileExtension, isRunnable, type WorkspaceEntry } from "@/lib/api/workspace";
import { useCreateTerminal, useDeleteWorkspaceFile, useWorkspaceFiles } from "@/lib/hooks/useWorkspace";
import { useToast } from "@/lib/context/ToastContext";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { QuickView, formatSize, previewKind } from "./QuickView";
import { apiErrorMessage } from "@/lib/api/errors";

/** Directories expanded when the panel first shows. */
const DEFAULT_EXPANDED = ["code"];
const MAX_SEARCH_RESULTS = 300;

interface Row {
  entry: WorkspaceEntry;
  name: string;
  depth: number;
  /** Path of the parent directory ("" for top level). */
  parent: string;
  /** For search results: the directory part shown after the name. */
  hint?: string;
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirName = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Groups entries by parent directory (adding any directory only implied by a file path), dirs first. */
export function buildChildren(entries: WorkspaceEntry[]): Map<string, WorkspaceEntry[]> {
  const byPath = new Map<string, WorkspaceEntry>();
  for (const e of entries) byPath.set(e.path, e);
  for (const e of entries) {
    let d = dirName(e.path);
    while (d && !byPath.has(d)) {
      byPath.set(d, { path: d, type: "dir", size: 0 });
      d = dirName(d);
    }
  }
  const children = new Map<string, WorkspaceEntry[]>();
  for (const e of byPath.values()) {
    const parent = dirName(e.path);
    const list = children.get(parent);
    if (list) list.push(e);
    else children.set(parent, [e]);
  }
  for (const list of children.values()) {
    list.sort((a, b) =>
      a.type !== b.type
        ? a.type === "dir" ? -1 : 1
        : baseName(a.path).localeCompare(baseName(b.path), undefined, { sensitivity: "base", numeric: true }),
    );
  }
  return children;
}

/**
 * Scores a path against a query: substring matches (best in the file name) beat
 * in-order character (fuzzy) matches; null when it doesn't match.
 */
export function matchScore(path: string, query: string): number | null {
  const p = path.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const name = baseName(p);
  const inName = name.indexOf(q);
  if (inName >= 0) return 1000 - inName * 2 - name.length * 0.1 + (inName === 0 ? 50 : 0);
  const inPath = p.indexOf(q);
  if (inPath >= 0) return 600 - inPath - p.length * 0.1;
  // Fuzzy: every query character in order (spaces ignored); tighter spans score higher.
  const chars = q.replace(/\s+/g, "");
  let pos = -1;
  let first = -1;
  for (const ch of chars) {
    pos = p.indexOf(ch, pos + 1);
    if (pos < 0) return null;
    if (first < 0) first = pos;
  }
  return 300 - (pos - first) - p.length * 0.1;
}

function iconFor(entry: WorkspaceEntry, expanded: boolean) {
  const cls = "h-4 w-4 flex-shrink-0";
  if (entry.type === "dir") {
    return expanded ? (
      <FolderOpen className={cn(cls, "text-amber-500")} />
    ) : (
      <Folder className={cn(cls, "text-amber-500")} />
    );
  }
  const ext = fileExtension(entry.path);
  if (ext === "json" || ext === "jsonld") return <FileJson className={cn(cls, "text-yellow-600 dark:text-yellow-400")} />;
  if (["zip", "gz", "tgz", "tar", "bz2", "xz", "7z", "rar"].includes(ext)) return <FileArchive className={cn(cls, "text-slate-500")} />;
  if (["ttl", "owl", "rdf", "nt", "nq", "trig", "jsonld", "n3"].includes(ext)) return <FileCode className={cn(cls, "text-primary-600 dark:text-primary-400")} />;
  switch (previewKind(entry.path)) {
    case "image":
      return <FileImage className={cn(cls, "text-pink-500")} />;
    case "audio":
      return <FileAudio className={cn(cls, "text-purple-500")} />;
    case "video":
      return <FileVideo className={cn(cls, "text-purple-500")} />;
    case "csv":
      return <FileSpreadsheet className={cn(cls, "text-green-600 dark:text-green-400")} />;
    case "pdf":
    case "docx":
      return <FileText className={cn(cls, "text-red-500")} />;
    case "markdown":
      return <FileText className={cn(cls, "text-sky-500")} />;
    case "text":
      return ["txt", "log", ""].includes(ext) ? (
        <FileText className={cn(cls, "text-slate-500")} />
      ) : (
        <FileCode className={cn(cls, "text-blue-500")} />
      );
    default:
      return <File className={cn(cls, "text-slate-500")} />;
  }
}

function RowAction({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <Tooltip side="left" content={label}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white",
          danger && "hover:text-red-600 dark:hover:text-red-400",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const ROW_ID_PREFIX = "workspace-file-row-";

export function FilesPanel({ projectId, isActive }: { projectId: string; isActive: boolean }) {
  const toast = useToast();
  const { data, isLoading, isFetching, error, refetch } = useWorkspaceFiles(projectId, isActive);
  const createTerminal = useCreateTerminal(projectId);
  const deleteFile = useDeleteWorkspaceFile(projectId);

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(DEFAULT_EXPANDED));
  const [selected, setSelected] = useState<string | null>(null);
  const [quickViewPath, setQuickViewPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceEntry | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const children = useMemo(() => buildChildren(entries), [entries]);
  const byPath = useMemo(() => {
    const m = new Map<string, WorkspaceEntry>();
    for (const list of children.values()) for (const e of list) m.set(e.path, e);
    return m;
  }, [children]);

  const searching = query.trim().length > 0;

  const rows: Row[] = useMemo(() => {
    if (searching) {
      const scored: { e: WorkspaceEntry; s: number }[] = [];
      for (const e of byPath.values()) {
        const s = matchScore(e.path, query);
        if (s !== null) scored.push({ e, s });
      }
      scored.sort((a, b) => b.s - a.s || a.e.path.localeCompare(b.e.path));
      return scored.slice(0, MAX_SEARCH_RESULTS).map(({ e }) => ({
        entry: e,
        name: baseName(e.path),
        depth: 0,
        parent: dirName(e.path),
        hint: dirName(e.path),
      }));
    }
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const e of children.get(dir) ?? []) {
        out.push({ entry: e, name: baseName(e.path), depth, parent: dir });
        if (e.type === "dir" && expanded.has(e.path)) walk(e.path, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }, [searching, query, byPath, children, expanded]);

  const visibleFiles = useMemo(() => rows.filter((r) => r.entry.type === "file").map((r) => r.entry), [rows]);
  // The selection falls back to the first result while searching (and to nothing in the tree).
  const foundIndex = rows.findIndex((r) => r.entry.path === selected);
  const selectedIndex = foundIndex >= 0 ? foundIndex : searching && rows.length > 0 ? 0 : -1;
  const quickViewEntry = quickViewPath ? (byPath.get(quickViewPath) ?? null) : null;

  useEffect(() => {
    if (selectedIndex < 0) return;
    const el = document.getElementById(`${ROW_ID_PREFIX}${selectedIndex}`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const toggleDir = useCallback((path: string, open?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const willOpen = open ?? !next.has(path);
      if (willOpen) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const runFile = useCallback(
    (path: string) => {
      createTerminal.mutate(
        { kind: "run", run: path },
        { onError: (e) => toast.error(`Couldn't run ${baseName(path)}`, apiErrorMessage(e)) },
      );
    },
    [createTerminal, toast],
  );

  const terminalHere = useCallback(
    (dir?: string) => {
      createTerminal.mutate(
        { kind: "shell", cwd: dir || undefined },
        { onError: (e) => toast.error("Couldn't open a terminal", apiErrorMessage(e)) },
      );
    },
    [createTerminal, toast],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const path = deleteTarget.path;
    try {
      await deleteFile.mutateAsync(path);
      toast.success(`Deleted ${baseName(path)}`);
      if (quickViewPath === path) setQuickViewPath(null);
    } catch (e) {
      toast.error(`Couldn't delete ${baseName(path)}`, apiErrorMessage(e));
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteFile, toast, quickViewPath]);

  const select = (index: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (r) setSelected(r.entry.path);
  };

  const activate = (row: Row) => {
    if (row.entry.type === "dir") {
      if (searching) {
        setQuery("");
        setExpanded((prev) => {
          const next = new Set(prev);
          for (let d = row.entry.path; d; d = dirName(d)) next.add(d);
          return next;
        });
        setSelected(row.entry.path);
      } else {
        toggleDir(row.entry.path);
      }
    } else {
      setSelected(row.entry.path);
      setQuickViewPath(row.entry.path);
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const row = selectedIndex >= 0 ? rows[selectedIndex] : null;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        select(selectedIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (selectedIndex <= 0 && searching) searchRef.current?.focus();
        else select(selectedIndex - 1);
        break;
      case "Home":
        e.preventDefault();
        select(0);
        break;
      case "End":
        e.preventDefault();
        select(rows.length - 1);
        break;
      case "ArrowRight":
        if (!row || searching) break;
        e.preventDefault();
        if (row.entry.type === "dir") {
          if (!expanded.has(row.entry.path)) toggleDir(row.entry.path, true);
          else if (rows[selectedIndex + 1]?.parent === row.entry.path) select(selectedIndex + 1);
        }
        break;
      case "ArrowLeft":
        if (!row || searching) break;
        e.preventDefault();
        if (row.entry.type === "dir" && expanded.has(row.entry.path)) toggleDir(row.entry.path, false);
        else if (row.parent) setSelected(row.parent);
        break;
      case "Enter":
        if (!row) break;
        e.preventDefault();
        activate(row);
        break;
      case " ":
        e.preventDefault();
        if (!row) break;
        if (row.entry.type === "file") setQuickViewPath((cur) => (cur === row.entry.path ? null : row.entry.path));
        else if (!searching) toggleDir(row.entry.path);
        break;
      default:
        // Typing a character starts a search.
        if (e.key.length === 1 && /\S/.test(e.key)) {
          searchRef.current?.focus();
        }
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length === 0) return;
      if (selectedIndex < 0) setSelected(rows[0].entry.path);
      listRef.current?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = selectedIndex >= 0 ? rows[selectedIndex] : rows[0];
      if (row) activate(row);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
    }
  };

  const headerButton =
    "rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-white dark:bg-slate-900" data-testid="files-panel">
      <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search files"
            aria-label="Search files"
            className={cn(
              "h-7 w-full rounded-md border border-slate-200 bg-white pr-7 pl-7 text-sm text-slate-900 placeholder:text-slate-400",
              "focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none",
              "dark:border-slate-700 dark:bg-slate-800 dark:text-white",
              "[&::-webkit-search-cancel-button]:hidden",
            )}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Tooltip side="bottom" content="New terminal in the project folder">
          <button type="button" aria-label="New terminal" className={headerButton} onClick={() => terminalHere()}>
            <SquareTerminal className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="Refresh the file list">
          <button
            type="button"
            aria-label="Refresh files"
            className={headerButton}
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </button>
        </Tooltip>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : error ? (
        <div className="p-4 text-sm text-red-600 dark:text-red-400">
          Couldn&apos;t load the project files. {error instanceof Error ? error.message : ""}
        </div>
      ) : (
        <div
          ref={listRef}
          role={searching ? "listbox" : "tree"}
          aria-label={searching ? "Search results" : "Project files"}
          tabIndex={0}
          aria-activedescendant={selectedIndex >= 0 ? `${ROW_ID_PREFIX}${selectedIndex}` : undefined}
          onKeyDown={onListKeyDown}
          onFocus={() => {
            if (selectedIndex < 0 && rows.length > 0) setSelected(rows[0].entry.path);
          }}
          className="min-h-0 flex-1 overflow-y-auto py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary-500 focus-visible:ring-inset"
        >
          {rows.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {searching ? "No matching files" : "This project folder is empty"}
            </p>
          )}
          {rows.map((row, i) => {
            const { entry } = row;
            const isDir = entry.type === "dir";
            const isOpen = isDir && expanded.has(entry.path);
            const isSelected = i === selectedIndex;
            return (
              <div
                key={entry.path}
                id={`${ROW_ID_PREFIX}${i}`}
                role={searching ? "option" : "treeitem"}
                aria-selected={isSelected}
                aria-expanded={isDir && !searching ? isOpen : undefined}
                aria-level={searching ? undefined : row.depth + 1}
                data-path={entry.path}
                onClick={() => {
                  setSelected(entry.path);
                  if (isDir && !searching) toggleDir(entry.path);
                  listRef.current?.focus();
                }}
                onDoubleClick={() => !isDir && setQuickViewPath(entry.path)}
                className={cn(
                  "group flex cursor-default items-center gap-1 py-0.5 pr-2 select-none",
                  isSelected
                    ? "bg-primary-50 text-slate-900 dark:bg-primary-900/30 dark:text-white"
                    : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800",
                )}
                style={{ paddingLeft: 6 + row.depth * 14 }}
              >
                <span className="flex w-4 flex-shrink-0 justify-center text-slate-400">
                  {isDir && !searching ? (
                    isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                  ) : null}
                </span>
                {iconFor(entry, isOpen)}
                <span className="min-w-0 flex-1 truncate">
                  {row.name}
                  {row.hint && <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">{row.hint}</span>}
                </span>
                <span
                  className={cn(
                    "flex flex-shrink-0 items-center gap-0.5",
                    isSelected ? "flex" : "hidden group-hover:flex",
                  )}
                >
                  {isDir ? (
                    <RowAction label="New terminal here" onClick={() => terminalHere(entry.path)}>
                      <SquareTerminal className="h-3.5 w-3.5" />
                    </RowAction>
                  ) : (
                    <>
                      <RowAction label="Quick View (Space)" onClick={() => { setSelected(entry.path); setQuickViewPath(entry.path); }}>
                        <Eye className="h-3.5 w-3.5" />
                      </RowAction>
                      {isRunnable(entry.path) && (
                        <RowAction label={`Run ${row.name} in a new terminal`} onClick={() => runFile(entry.path)}>
                          <Play className="h-3.5 w-3.5" />
                        </RowAction>
                      )}
                      <RowAction label={`Delete ${row.name}`} danger onClick={() => setDeleteTarget(entry)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </RowAction>
                    </>
                  )}
                </span>
                {!isDir && !isSelected && (
                  <span className="flex-shrink-0 text-xs text-slate-400 group-hover:hidden dark:text-slate-500">
                    {formatSize(entry.size)}
                  </span>
                )}
              </div>
            );
          })}
          {data?.truncated && (
            <p className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
              The folder has more files than can be listed; only the first ones are shown.
            </p>
          )}
        </div>
      )}

      <div className="border-t border-slate-200 px-3 py-1.5 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
        Space: Quick View · Enter: open · arrows: navigate
      </div>

      <QuickView
        projectId={projectId}
        entry={quickViewEntry}
        onClose={() => {
          setQuickViewPath(null);
          listRef.current?.focus();
        }}
        siblings={visibleFiles}
        onNavigate={(e) => {
          setSelected(e.path);
          setQuickViewPath(e.path);
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete file"
        description={deleteTarget ? `Delete ${deleteTarget.path}? This can't be undone from here.` : ""}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
