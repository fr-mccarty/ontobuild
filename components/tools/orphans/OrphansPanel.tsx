"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Component,
  FileX,
  FlaskConical,
  Loader2,
  RefreshCw,
  Search,
  SquareFunction,
  Terminal,
  Type,
  Variable,
  X,
  type LucideIcon,
} from "lucide-react";
import type { OrphanCategory, OrphanItem } from "@/lib/api/tools";
import type { WorkspaceEntry } from "@/lib/api/workspace";
import { useOrphans } from "@/lib/hooks/useTools";
import { useWorkspaceFiles } from "@/lib/hooks/useWorkspace";
import { Tooltip } from "@/components/ui/tooltip";
import { QuickView } from "@/components/workspace/QuickView";
import { cn } from "@/lib/utils";

export const CATEGORIES: { id: OrphanCategory; label: string; icon: LucideIcon; color: string }[] = [
  { id: "file", label: "Files", icon: FileX, color: "text-red-500" },
  { id: "component", label: "Components", icon: Component, color: "text-primary-600 dark:text-primary-400" },
  { id: "class", label: "Classes", icon: Box, color: "text-amber-600 dark:text-amber-400" },
  { id: "function", label: "Functions", icon: SquareFunction, color: "text-purple-500" },
  { id: "variable", label: "Variables", icon: Variable, color: "text-sky-500" },
  { id: "type", label: "Types", icon: Type, color: "text-teal-600 dark:text-teal-400" },
  { id: "test", label: "Tests", icon: FlaskConical, color: "text-green-600 dark:text-green-400" },
  { id: "script", label: "Scripts", icon: Terminal, color: "text-slate-500" },
];
const CATEGORY = new Map(CATEGORIES.map((c) => [c.id, c]));

const ROW_ID_PREFIX = "orphan-row-";
const shortPath = (file: string) => file.replace(/^code\//, "");

/** Items in the chosen category ("all" for every one) whose name, file or reason matches the query. */
export function filterOrphans(items: OrphanItem[], category: OrphanCategory | "all", query: string): OrphanItem[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (i) =>
      (category === "all" || i.category === category) &&
      (!q || i.name.toLowerCase().includes(q) || i.file.toLowerCase().includes(q) || i.reason.toLowerCase().includes(q)),
  );
}

export function OrphansPanel({ projectId, isActive }: { projectId: string; isActive: boolean }) {
  const { data, isLoading, isFetching, error, refetch } = useOrphans(projectId, isActive);
  const [category, setCategory] = useState<OrphanCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [showEntries, setShowEntries] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: fileList } = useWorkspaceFiles(projectId, !!openFile);

  const items = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(() => {
    const m = new Map<OrphanCategory, number>();
    for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1);
    return m;
  }, [items]);
  const rows = useMemo(() => filterOrphans(items, category, query), [items, category, query]);
  const foundIndex = rows.findIndex((r) => r.id === selectedId);
  const selectedIndex = foundIndex >= 0 ? foundIndex : -1;

  useEffect(() => {
    if (selectedIndex < 0) return;
    document.getElementById(`${ROW_ID_PREFIX}${selectedIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const select = (index: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (r) setSelectedId(r.id);
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
        if (selectedIndex <= 0) searchRef.current?.focus();
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
      case "Enter":
      case " ":
        if (!row) break;
        e.preventDefault();
        setOpenFile(row.file);
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) searchRef.current?.focus();
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length === 0) return;
      if (selectedIndex < 0) setSelectedId(rows[0].id);
      listRef.current?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = selectedIndex >= 0 ? rows[selectedIndex] : rows[0];
      if (row) setOpenFile(row.file);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
    }
  };

  const quickViewEntry: WorkspaceEntry | null = openFile
    ? { path: openFile, type: "file", size: fileList?.entries.find((f) => f.path === openFile)?.size ?? 0 }
    : null;

  const headerButton =
    "rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white";
  const chip = (active: boolean, empty: boolean) =>
    cn(
      "rounded-full border px-2 py-0.5 text-xs transition-colors",
      active
        ? "border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-900/30 dark:text-primary-300"
        : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
      empty && !active && "opacity-50",
    );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="orphans-panel">
      <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Filter by name, file or reason"
            aria-label="Filter orphans"
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
              aria-label="Clear filter"
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
        <Tooltip side="bottom" content="Scan code/ again">
          <button type="button" aria-label="Refresh orphans" className={headerButton} onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </button>
        </Tooltip>
      </div>

      <div role="group" aria-label="Kind of orphan" className="flex flex-wrap gap-1 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
        <button type="button" aria-pressed={category === "all"} className={chip(category === "all", items.length === 0)} onClick={() => setCategory("all")}>
          All {items.length}
        </button>
        {CATEGORIES.map((c) => {
          const n = counts.get(c.id) ?? 0;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={category === c.id}
              className={chip(category === c.id, n === 0)}
              onClick={() => setCategory(c.id)}
            >
              {c.label} {n}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : error ? (
        <div className="p-4 text-sm text-red-600 dark:text-red-400">
          Couldn&apos;t scan the code. {error instanceof Error ? error.message : ""}
        </div>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Orphans"
          tabIndex={0}
          aria-activedescendant={selectedIndex >= 0 ? `${ROW_ID_PREFIX}${selectedIndex}` : undefined}
          onKeyDown={onListKeyDown}
          onFocus={() => {
            if (selectedIndex < 0 && rows.length > 0) setSelectedId(rows[0].id);
          }}
          className="min-h-0 flex-1 overflow-y-auto py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary-500 focus-visible:ring-inset"
        >
          {rows.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {!data || data.files_scanned === 0
                ? "No JavaScript or TypeScript files in code/"
                : items.length === 0
                  ? "No orphans found"
                  : "Nothing matches"}
            </p>
          )}
          {rows.map((item, i) => {
            const meta = CATEGORY.get(item.category)!;
            const Icon = meta.icon;
            const isSelected = i === selectedIndex;
            const showHeading = category === "all" && !query && (i === 0 || rows[i - 1].category !== item.category);
            return (
              <div key={item.id}>
                {showHeading && (
                  <div
                    role="presentation"
                    className="px-3 pt-2 pb-0.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500"
                  >
                    {meta.label}
                  </div>
                )}
                <div
                  id={`${ROW_ID_PREFIX}${i}`}
                  role="option"
                  aria-selected={isSelected}
                  data-orphan-id={item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    listRef.current?.focus();
                  }}
                  onDoubleClick={() => setOpenFile(item.file)}
                  className={cn(
                    "flex cursor-default gap-2 px-3 py-1 select-none",
                    isSelected
                      ? "bg-primary-50 text-slate-900 dark:bg-primary-900/30 dark:text-white"
                      : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800",
                  )}
                >
                  <Icon aria-hidden className={cn("mt-0.5 h-3.5 w-3.5 flex-shrink-0", meta.color)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate font-medium">{item.name}</span>
                      <span className="truncate text-xs text-slate-400 dark:text-slate-500">
                        {shortPath(item.file)}
                        {item.line !== null && `:${item.line}`}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{item.reason}</div>
                  </div>
                </div>
              </div>
            );
          })}
          {data?.truncated && (
            <p className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
              code/ has more files than can be scanned; results may be incomplete.
            </p>
          )}
        </div>
      )}

      {data && data.files_scanned > 0 && (
        <div className="border-t border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {data.entry_points.length === 0 ? (
            <p className="px-3 py-1.5 text-amber-700 dark:text-amber-400">
              No entry points found, so files are listed only when nothing imports them.
            </p>
          ) : (
            <>
              <button
                type="button"
                aria-expanded={showEntries}
                onClick={() => setShowEntries((v) => !v)}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {showEntries ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Based on {data.entry_points.length} entry point{data.entry_points.length === 1 ? "" : "s"} · {data.files_scanned} files
                scanned
                {data.parse_errors.length > 0 && ` · ${data.parse_errors.length} couldn't be read`}
              </button>
              {showEntries && (
                <ul className="max-h-32 overflow-y-auto px-3 pb-2 font-mono text-[11px]" aria-label="Entry points">
                  {data.entry_points.map((e) => (
                    <li key={e} className="truncate">
                      {shortPath(e)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <QuickView
        projectId={projectId}
        entry={quickViewEntry}
        onClose={() => {
          setOpenFile(null);
          listRef.current?.focus();
        }}
      />
    </div>
  );
}
