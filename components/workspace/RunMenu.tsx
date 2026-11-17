"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  FolderTree,
  Loader2,
  PanelBottomClose,
  PanelBottomOpen,
  Play,
  Settings2,
  Square,
  SquareTerminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateTerminal, useDevServer, useDevServerActions } from "@/lib/hooks/useWorkspace";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";
import { useToast } from "@/lib/context/ToastContext";
import { cn } from "@/lib/utils";
import type { DevServerStatus } from "@/lib/api/workspace";

const ITEM = cn(
  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-50",
  "dark:text-slate-300 dark:hover:bg-slate-700",
);

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ConfigureDialog({
  open,
  onOpenChange,
  status,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: DevServerStatus | undefined;
  onSave: (config: { command: string; cwd: string; url: string }) => void;
  saving: boolean;
}) {
  // Mounted only while open, so the fields are prefilled each time it opens.
  const [command, setCommand] = useState(status?.command || status?.suggested_command || "");
  const [cwd, setCwd] = useState(status?.cwd || "");
  const [url, setUrl] = useState(status?.configured_url || "");

  const input =
    "mt-1 h-8 w-full rounded-md border border-slate-300 bg-white px-2 font-mono text-sm text-slate-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white";
  const label = "block text-sm font-medium text-slate-700 dark:text-slate-300";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure dev server</DialogTitle>
          <DialogDescription>
            The command that serves this project&apos;s app. &ldquo;View in Browser&rdquo; opens its URL.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ command: command.trim(), cwd: cwd.trim(), url: url.trim() });
          }}
        >
          <label className={label}>
            Command
            <input
              className={input}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={status?.suggested_command || "npm run dev"}
              autoFocus
            />
          </label>
          <label className={label}>
            Working directory <span className="font-normal text-slate-500">(relative to the project folder)</span>
            <input className={input} value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="code" />
          </label>
          <label className={label}>
            URL <span className="font-normal text-slate-500">(optional; otherwise detected from the output)</span>
            <input
              className={input}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:5173"
              type="url"
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !command.trim()}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Sub-heading (right): "View in Browser" and the run dropdown (dev server, terminals). */
export function RunMenu({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { data: dev } = useDevServer(projectId);
  const { start, stop, configure } = useDevServerActions(projectId);
  const createTerminal = useCreateTerminal(projectId);
  const panelOpen = useWorkspaceStore((s) => s.terminalPanelOpen);
  const setPanelOpen = useWorkspaceStore((s) => s.setTerminalPanelOpen);
  const addTerminal = useWorkspaceStore((s) => s.addTerminal);
  const showRightTab = useWorkspaceStore((s) => s.showRightTab);

  const [menuOpen, setMenuOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const url = dev?.url ?? null;
  const running = !!dev?.running;
  const command = dev?.command || null;

  const viewTooltip = url
    ? `View in Browser: open ${url} in a new tab`
    : running
      ? "View in Browser: waiting for the dev server to print its URL (or set one in Configure dev server)"
      : command
        ? "View in Browser: start the dev server first (Run menu), or set its URL in Configure dev server"
        : "View in Browser: no dev server yet. Configure one from the Run menu";

  const close = () => setMenuOpen(false);

  const startServer = () => {
    close();
    if (!command) {
      setConfigOpen(true);
      return;
    }
    start.mutate(undefined, { onError: (e) => toast.error(`Couldn't start the dev server: ${errorText(e)}`) });
  };

  const stopServer = () => {
    close();
    stop.mutate(undefined, { onError: (e) => toast.error(`Couldn't stop the dev server: ${errorText(e)}`) });
  };

  const openServerTerminal = () => {
    close();
    if (dev?.terminal_id) addTerminal({ id: dev.terminal_id, title: "Dev server", kind: "devserver" });
  };

  const newTerminal = () => {
    close();
    createTerminal.mutate(
      { kind: "shell" },
      { onError: (e) => toast.error(`Couldn't open a terminal: ${errorText(e)}`) },
    );
  };

  return (
    <div ref={menuRef} className="relative flex items-center">
      <Tooltip side="bottom" content={viewTooltip}>
        {/* The span keeps the tooltip working while the button is disabled. */}
        <span tabIndex={url ? undefined : 0} className="inline-flex rounded-md">
          <Button
            variant="ghost"
            size="sm"
            disabled={!url}
            aria-label="View in Browser"
            onClick={() => url && window.open(url, "_blank", "noopener")}
            className="gap-1.5 rounded-r-none px-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden xl:inline">View in Browser</span>
          </Button>
        </span>
      </Tooltip>
      <Tooltip
        side="bottom"
        disabled={menuOpen}
        content={`Run: ${running ? "dev server running" : "start the dev server"}, open terminals, browse project files`}
      >
        <Button
          variant="ghost"
          size="sm"
          aria-label="Run menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="gap-0.5 rounded-l-none px-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <Play className={cn("h-4 w-4", running && "fill-green-500 text-green-600 dark:text-green-400")} />
          <ChevronDown className={cn("h-3 w-3 transition-transform", menuOpen && "rotate-180")} />
        </Button>
      </Tooltip>

      {menuOpen && (
        <div
          role="menu"
          className={cn(
            "absolute top-full right-0 z-50 mt-1 w-72 rounded-lg border border-slate-200 bg-white py-1 shadow-lg",
            "dark:border-slate-700 dark:bg-slate-800",
            "animate-in fade-in-0 zoom-in-95",
          )}
        >
          {running ? (
            <button role="menuitem" className={ITEM} onClick={stopServer} disabled={stop.isPending}>
              <Square className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />
              <span className="min-w-0 flex-1">
                Stop dev server
                {command && <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400">{command}</span>}
              </span>
            </button>
          ) : (
            <button role="menuitem" className={ITEM} onClick={startServer} disabled={start.isPending}>
              {start.isPending ? (
                <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 flex-shrink-0 text-green-600 dark:text-green-400" />
              )}
              <span className="min-w-0 flex-1">
                Start dev server
                <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                  {command ?? "not configured yet"}
                </span>
              </span>
            </button>
          )}
          <button
            role="menuitem"
            className={ITEM}
            onClick={() => {
              close();
              setConfigOpen(true);
            }}
          >
            <Settings2 className="h-3.5 w-3.5 flex-shrink-0" />
            Configure dev server…
          </button>
          {dev?.terminal_id && (
            <button role="menuitem" className={ITEM} onClick={openServerTerminal}>
              <SquareTerminal className="h-3.5 w-3.5 flex-shrink-0" />
              Open dev server terminal
            </button>
          )}
          <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
          <button role="menuitem" className={ITEM} onClick={newTerminal}>
            <SquareTerminal className="h-3.5 w-3.5 flex-shrink-0" />
            New terminal
          </button>
          <button
            role="menuitem"
            className={ITEM}
            onClick={() => {
              close();
              setPanelOpen(!panelOpen);
            }}
          >
            {panelOpen ? (
              <PanelBottomClose className="h-3.5 w-3.5 flex-shrink-0" />
            ) : (
              <PanelBottomOpen className="h-3.5 w-3.5 flex-shrink-0" />
            )}
            {panelOpen ? "Hide terminal panel" : "Show terminal panel"}
          </button>
          <button
            role="menuitem"
            className={ITEM}
            onClick={() => {
              close();
              showRightTab("files");
            }}
          >
            <FolderTree className="h-3.5 w-3.5 flex-shrink-0" />
            Files
          </button>
        </div>
      )}

      {configOpen && (
      <ConfigureDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        status={dev}
        saving={configure.isPending}
        onSave={(config) =>
          configure.mutate(
            { command: config.command, cwd: config.cwd, url: config.url },
            {
              onSuccess: () => {
                setConfigOpen(false);
                toast.success("Dev server configured");
              },
              onError: (e) => toast.error(`Couldn't save the dev server settings: ${errorText(e)}`),
            },
          )
        }
      />
      )}
    </div>
  );
}
