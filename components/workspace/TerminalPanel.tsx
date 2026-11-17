"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Globe, Play, Plus, SquareTerminal, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { workspaceApi, type TerminalKind } from "@/lib/api/workspace";
import { useCreateTerminal, useTerminalSessions, workspaceQueryKeys } from "@/lib/hooks/useWorkspace";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";
import { useToast } from "@/lib/context/ToastContext";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useIsDarkMode } from "./QuickView";

const XTerm = dynamic(() => import("./XTerm"), { ssr: false });

const HEIGHT_KEY = "ontobuilder.terminalPanel.height";
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;

function readHeight(): number {
  try {
    const v = Number(window.localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(v) && v >= MIN_HEIGHT ? v : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

function writeHeight(h: number) {
  try {
    window.localStorage.setItem(HEIGHT_KEY, String(Math.round(h)));
  } catch {
    // storage unavailable; the height just isn't remembered
  }
}

const maxHeight = () => (typeof window === "undefined" ? 800 : Math.max(MIN_HEIGHT, window.innerHeight * 0.8));

function KindIcon({ kind }: { kind: TerminalKind }) {
  const cls = "h-3.5 w-3.5 flex-shrink-0";
  if (kind === "run") return <Play className={cls} />;
  if (kind === "devserver") return <Globe className={cls} />;
  return <SquareTerminal className={cls} />;
}

interface SessionStatus {
  running: boolean;
  exit_code: number | null;
}

/** Bottom panel with one tab per terminal session. */
export function TerminalPanel({ projectId }: { projectId: string }) {
  const open = useWorkspaceStore((s) => s.terminalPanelOpen);
  const terminals = useWorkspaceStore((s) => s.terminals);
  const activeId = useWorkspaceStore((s) => s.activeTerminalId);
  const setOpen = useWorkspaceStore((s) => s.setTerminalPanelOpen);
  const setActive = useWorkspaceStore((s) => s.setActiveTerminal);
  const setTerminals = useWorkspaceStore((s) => s.setTerminals);
  const removeTerminal = useWorkspaceStore((s) => s.removeTerminal);
  const toast = useToast();
  const qc = useQueryClient();
  const dark = useIsDarkMode();
  const createTerminal = useCreateTerminal(projectId);
  const { data } = useTerminalSessions(projectId);

  // The panel never renders on the server (no sessions there), so reading storage here is safe.
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? DEFAULT_HEIGHT : Math.min(readHeight(), maxHeight()),
  );
  const [exits, setExits] = useState<Record<string, number | null>>({});
  const syncedFor = useRef<string | null>(null);

  // Tabs belong to one project: entering another project starts from its own sessions.
  useEffect(() => {
    useWorkspaceStore.getState().setTerminalsProject(projectId);
  }, [projectId]);

  // On first load for a project, adopt the server's sessions so tabs survive a page reload
  // (keeping any tab opened locally before the list arrived).
  useEffect(() => {
    if (!data || syncedFor.current === projectId) return;
    syncedFor.current = projectId;
    const server = data.items.map((t) => ({ id: t.id, title: t.title, kind: t.kind }));
    const local = useWorkspaceStore.getState().terminals.filter((t) => !server.some((s) => s.id === t.id));
    setTerminals([...server, ...local]);
  }, [data, projectId, setTerminals]);

  const status = useCallback(
    (id: string): SessionStatus => {
      if (id in exits) return { running: false, exit_code: exits[id] };
      const s = data?.items.find((t) => t.id === id);
      return s ? { running: s.running, exit_code: s.exit_code } : { running: true, exit_code: null };
    },
    [data, exits],
  );

  const onExit = useCallback(
    (id: string, code: number | null) => {
      setExits((prev) => ({ ...prev, [id]: code }));
      void qc.invalidateQueries({ queryKey: workspaceQueryKeys.terminals(projectId) });
      void qc.invalidateQueries({ queryKey: workspaceQueryKeys.devServer(projectId) });
    },
    [qc, projectId],
  );

  const closeTab = useCallback(
    async (id: string) => {
      removeTerminal(id);
      try {
        await workspaceApi.closeTerminal(projectId, id);
      } catch (e) {
        // Already gone on the server is fine; anything else is worth a mention.
        if (!(e instanceof ApiError && e.status === 404)) {
          toast.error(`Couldn't close the terminal: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      void qc.invalidateQueries({ queryKey: workspaceQueryKeys.terminals(projectId) });
      void qc.invalidateQueries({ queryKey: workspaceQueryKeys.devServer(projectId) });
    },
    [removeTerminal, projectId, toast, qc],
  );

  const newShell = () =>
    createTerminal.mutate(
      { kind: "shell" },
      { onError: (e) => toast.error(`Couldn't open a terminal: ${e instanceof Error ? e.message : String(e)}`) },
    );

  const onResizeStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    let latest = startH;
    const move = (ev: PointerEvent) => {
      latest = Math.min(maxHeight(), Math.max(MIN_HEIGHT, startH + (startY - ev.clientY)));
      setHeight(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      writeHeight(latest);
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onResizeKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const next = Math.min(maxHeight(), Math.max(MIN_HEIGHT, height + (e.key === "ArrowUp" ? 20 : -20)));
    setHeight(next);
    writeHeight(next);
  };

  if (terminals.length === 0 && !open) return null;

  const iconButton =
    "rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white";

  return (
    <section
      aria-label="Terminals"
      data-testid="terminal-panel"
      hidden={!open}
      className={cn(
        "relative flex-shrink-0 flex-col border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
        open ? "flex" : "hidden",
      )}
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        aria-valuenow={Math.round(height)}
        aria-valuemin={MIN_HEIGHT}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKey}
        className="absolute -top-1 right-0 left-0 z-10 h-2 cursor-row-resize hover:bg-primary-500/30 focus-visible:bg-primary-500/40 focus-visible:outline-none"
      />
      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 dark:border-slate-700 dark:bg-slate-800">
        <div role="tablist" aria-label="Terminal sessions" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1">
          {terminals.map((t) => {
            const st = status(t.id);
            const isActive = t.id === activeId;
            const statusText = st.running
              ? "running"
              : `exited${st.exit_code !== null ? ` with code ${st.exit_code}` : ""}`;
            return (
              <div
                key={t.id}
                className={cn(
                  "group flex flex-shrink-0 items-center rounded-md text-xs",
                  isActive
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
                    : "text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700",
                )}
              >
                <Tooltip side="top" content={`${t.title}: ${statusText}`}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`terminal-tabpanel-${t.id}`}
                    onClick={() => setActive(t.id)}
                    className="flex max-w-[16rem] items-center gap-1.5 py-1 pr-1 pl-2"
                  >
                    <KindIcon kind={t.kind} />
                    <span className="truncate">{t.title}</span>
                    <span
                      data-testid={`terminal-status-${t.id}`}
                      aria-label={statusText}
                      className={cn(
                        "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                        st.running ? "bg-green-500" : st.exit_code === 0 ? "bg-slate-400" : "bg-red-500",
                      )}
                    />
                    {!st.running && st.exit_code !== null && (
                      <span className={cn("font-mono", st.exit_code === 0 ? "text-slate-400" : "text-red-500")}>
                        {st.exit_code}
                      </span>
                    )}
                  </button>
                </Tooltip>
                <Tooltip side="top" content={st.running ? "Close: ends the process" : "Close"}>
                  <button
                    type="button"
                    aria-label={`Close ${t.title}`}
                    onClick={() => void closeTab(t.id)}
                    className="mr-1 rounded p-0.5 text-slate-400 opacity-60 group-hover:opacity-100 hover:bg-slate-300 hover:text-slate-900 dark:hover:bg-slate-600 dark:hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
        <Tooltip side="top" content="New terminal in the project folder">
          <button type="button" aria-label="New terminal" className={iconButton} onClick={newShell}>
            <Plus className="h-4 w-4" />
          </button>
        </Tooltip>
        <Tooltip side="top" content="Hide the terminal panel (sessions keep running)">
          <button type="button" aria-label="Hide terminal panel" className={iconButton} onClick={() => setOpen(false)}>
            <ChevronDown className="h-4 w-4" />
          </button>
        </Tooltip>
      </div>
      <div className="relative min-h-0 flex-1">
        {terminals.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            <button type="button" onClick={newShell} className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white">
              <Plus className="h-4 w-4" /> New terminal
            </button>
          </div>
        )}
        {terminals.map((t) => (
          <div
            key={t.id}
            id={`terminal-tabpanel-${t.id}`}
            role="tabpanel"
            hidden={t.id !== activeId}
            className={cn("absolute inset-0 py-1 pl-2", dark ? "bg-[#0f172a]" : "bg-white")}
          >
            <XTerm
              projectId={projectId}
              terminalId={t.id}
              active={open && t.id === activeId}
              dark={dark}
              onExit={(code) => onExit(t.id, code)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
