"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, Component, FileCode, Loader2, Package, Repeat, RefreshCw, Search, X } from "lucide-react";
import type { ComponentNode, ComponentTree } from "@/lib/api/tools";
import type { WorkspaceEntry } from "@/lib/api/workspace";
import { useComponentTree } from "@/lib/hooks/useTools";
import { useWorkspaceFiles } from "@/lib/hooks/useWorkspace";
import { Tooltip } from "@/components/ui/tooltip";
import { QuickView } from "@/components/workspace/QuickView";
import { cn } from "@/lib/utils";

const ROW_ID_PREFIX = "component-tree-row-";
const MAX_SEARCH_RESULTS = 300;

export interface TreeRow {
  /** Unique per position: the ids from the root down, joined with ">". */
  key: string;
  node: ComponentNode;
  depth: number;
  parentKey: string | null;
  /** Times the parent renders this component. */
  count: number;
  hasChildren: boolean;
  /** The component already appears above this row (it renders itself, directly or not). */
  recursive: boolean;
}

const isExternal = (n: ComponentNode) => n.kind === "external" || n.kind === "unknown";

/** Visible rows of the tree, given which row keys are expanded. */
export function buildRows(tree: ComponentTree, expanded: Set<string>, showExternal: boolean): TreeRow[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const visibleChildren = (n: ComponentNode) =>
    n.children.filter((c) => {
      const child = byId.get(c.id);
      return child && (showExternal || !isExternal(child));
    });
  const rows: TreeRow[] = [];
  const walk = (id: string, depth: number, parentKey: string | null, count: number, ancestors: Set<string>) => {
    const node = byId.get(id);
    if (!node) return;
    const key = parentKey === null ? id : `${parentKey}>${id}`;
    const recursive = ancestors.has(id);
    const children = recursive ? [] : visibleChildren(node);
    rows.push({ key, node, depth, parentKey, count, hasChildren: children.length > 0, recursive });
    if (children.length === 0 || !expanded.has(key)) return;
    const next = new Set(ancestors).add(id);
    for (const c of children) walk(c.id, depth + 1, key, c.count, next);
  };
  for (const id of tree.roots) walk(id, 0, null, 1, new Set());
  return rows;
}

function NodeIcon({ node }: { node: ComponentNode }) {
  const cls = "h-3.5 w-3.5 flex-shrink-0";
  if (node.kind === "module") return <FileCode className={cn(cls, "text-blue-500")} />;
  if (isExternal(node)) return <Package className={cn(cls, "text-slate-400")} />;
  return <Component className={cn(cls, "text-primary-600 dark:text-primary-400")} />;
}

/** Where a node comes from: "src/App.tsx:12", the package name, or why it isn't resolved. */
function nodeHint(node: ComponentNode): string {
  if (node.kind === "external") return node.source ?? "";
  if (node.kind === "unknown") return "not resolved";
  return `${(node.file ?? "").replace(/^code\//, "")}:${node.line}`;
}

export function ComponentTreePanel({ projectId, isActive }: { projectId: string; isActive: boolean }) {
  const { data, isLoading, isFetching, error, refetch } = useComponentTree(projectId, isActive);
  const [query, setQuery] = useState("");
  const [showExternal, setShowExternal] = useState(false);
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: fileList } = useWorkspaceFiles(projectId, !!openFile);

  // Roots start expanded one level.
  const expandedKeys = useMemo(() => expanded ?? new Set(data?.roots ?? []), [expanded, data]);
  const searching = query.trim().length > 0;

  const rows: TreeRow[] = useMemo(() => {
    if (!data) return [];
    if (!searching) return buildRows(data, expandedKeys, showExternal);
    const q = query.trim().toLowerCase();
    return data.nodes
      .filter((n) => (showExternal || !isExternal(n)) && n.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const ai = a.name.toLowerCase().indexOf(q);
        const bi = b.name.toLowerCase().indexOf(q);
        return ai - bi || a.name.length - b.name.length || a.name.localeCompare(b.name);
      })
      .slice(0, MAX_SEARCH_RESULTS)
      .map((node) => ({ key: node.id, node, depth: 0, parentKey: null, count: 1, hasChildren: false, recursive: false }));
  }, [data, searching, query, expandedKeys, showExternal]);

  const foundIndex = rows.findIndex((r) => r.key === selectedKey);
  const selectedIndex = foundIndex >= 0 ? foundIndex : searching && rows.length > 0 ? 0 : -1;

  useEffect(() => {
    if (selectedIndex < 0) return;
    document.getElementById(`${ROW_ID_PREFIX}${selectedIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const setOpen = (key: string, open?: boolean) =>
    setExpanded(() => {
      const next = new Set(expandedKeys);
      if (open ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });

  const select = (index: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (r) setSelectedKey(r.key);
  };

  const openSource = (row: TreeRow) => {
    if (row.node.file) setOpenFile(row.node.file);
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
        if (row.hasChildren && !expandedKeys.has(row.key)) setOpen(row.key, true);
        else if (rows[selectedIndex + 1]?.parentKey === row.key) select(selectedIndex + 1);
        break;
      case "ArrowLeft":
        if (!row || searching) break;
        e.preventDefault();
        if (row.hasChildren && expandedKeys.has(row.key)) setOpen(row.key, false);
        else if (row.parentKey) setSelectedKey(row.parentKey);
        break;
      case "Enter":
      case " ":
        if (!row) break;
        e.preventDefault();
        openSource(row);
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) searchRef.current?.focus();
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length === 0) return;
      if (selectedIndex < 0) setSelectedKey(rows[0].key);
      listRef.current?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = selectedIndex >= 0 ? rows[selectedIndex] : rows[0];
      if (row) openSource(row);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
    }
  };

  const quickViewEntry: WorkspaceEntry | null = openFile
    ? { path: openFile, type: "file", size: fileList?.entries.find((f) => f.path === openFile)?.size ?? 0 }
    : null;
  const componentCount = data?.nodes.filter((n) => n.kind === "component").length ?? 0;

  const headerButton =
    "rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="component-tree-panel">
      <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search components"
            aria-label="Search components"
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
        <Tooltip side="bottom" content={showExternal ? "Hide components from packages" : "Show components from packages"}>
          <button
            type="button"
            aria-label="Show components from packages"
            aria-pressed={showExternal}
            className={cn(headerButton, showExternal && "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white")}
            onClick={() => setShowExternal((v) => !v)}
          >
            <Package className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="Scan code/ again">
          <button
            type="button"
            aria-label="Refresh component tree"
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
          Couldn&apos;t read the components. {error instanceof Error ? error.message : ""}
        </div>
      ) : (
        <div
          ref={listRef}
          role={searching ? "listbox" : "tree"}
          aria-label={searching ? "Matching components" : "Component tree"}
          tabIndex={0}
          aria-activedescendant={selectedIndex >= 0 ? `${ROW_ID_PREFIX}${selectedIndex}` : undefined}
          onKeyDown={onListKeyDown}
          onFocus={() => {
            if (selectedIndex < 0 && rows.length > 0) setSelectedKey(rows[0].key);
          }}
          className="min-h-0 flex-1 overflow-y-auto py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary-500 focus-visible:ring-inset"
        >
          {rows.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {searching
                ? "No matching components"
                : data && data.files_scanned > 0
                  ? "No React components found in code/"
                  : "No JavaScript or TypeScript files in code/"}
            </p>
          )}
          {rows.map((row, i) => {
            const { node } = row;
            const isOpen = row.hasChildren && expandedKeys.has(row.key);
            const isSelected = i === selectedIndex;
            const external = isExternal(node);
            return (
              <div
                key={row.key}
                id={`${ROW_ID_PREFIX}${i}`}
                role={searching ? "option" : "treeitem"}
                aria-selected={isSelected}
                aria-expanded={row.hasChildren && !searching ? isOpen : undefined}
                aria-level={searching ? undefined : row.depth + 1}
                data-node-id={node.id}
                onClick={() => {
                  setSelectedKey(row.key);
                  if (row.hasChildren && !searching) setOpen(row.key);
                  listRef.current?.focus();
                }}
                onDoubleClick={() => openSource(row)}
                className={cn(
                  "group flex cursor-default items-center gap-1 py-0.5 pr-2 select-none",
                  isSelected
                    ? "bg-primary-50 text-slate-900 dark:bg-primary-900/30 dark:text-white"
                    : "text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800",
                )}
                style={{ paddingLeft: 6 + row.depth * 14 }}
              >
                <span className="flex w-4 flex-shrink-0 justify-center text-slate-400">
                  {row.hasChildren && !searching ? (
                    isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                  ) : null}
                </span>
                <NodeIcon node={node} />
                <span className={cn("min-w-0 flex-1 truncate", external && "text-slate-500 dark:text-slate-400")}>
                  {node.name}
                  {row.count > 1 && <span className="ml-1 text-xs text-slate-400">×{row.count}</span>}
                  {row.recursive && (
                    <Repeat aria-label="Renders itself" className="ml-1 inline h-3 w-3 text-amber-500" />
                  )}
                  <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                    {nodeHint(node)}
                  </span>
                </span>
              </div>
            );
          })}
          {data?.truncated && (
            <p className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
              code/ has more files than can be scanned; some components may be missing.
            </p>
          )}
        </div>
      )}

      <div className="border-t border-slate-200 px-3 py-1.5 text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
        {data ? (
          <>
            {componentCount} component{componentCount === 1 ? "" : "s"} in {data.files_scanned} file
            {data.files_scanned === 1 ? "" : "s"}
            {data.parse_errors.length > 0 && ` · ${data.parse_errors.length} couldn't be read`}
            {" · Enter: open source"}
          </>
        ) : (
          "Enter: open source · arrows: navigate"
        )}
      </div>

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
