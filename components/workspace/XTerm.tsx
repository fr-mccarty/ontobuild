"use client";

/**
 * One terminal session rendered with xterm.js. Browser only: load it through
 * next/dynamic with ssr:false (see TerminalPanel). Output arrives over SSE
 * (/stream), keystrokes go to /input and size changes to /resize.
 */
import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { workspaceApi } from "@/lib/api/workspace";

const LIGHT: ITheme = {
  background: "#ffffff",
  foreground: "#1e293b",
  cursor: "#0f172a",
  cursorAccent: "#ffffff",
  selectionBackground: "#bfdbfe",
  black: "#1e293b",
  brightBlack: "#64748b",
  white: "#cbd5e1",
  brightWhite: "#f8fafc",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
};

const DARK: ITheme = {
  background: "#0f172a",
  foreground: "#e2e8f0",
  cursor: "#e2e8f0",
  cursorAccent: "#0f172a",
  selectionBackground: "#334155",
  black: "#1e293b",
  brightBlack: "#64748b",
  white: "#cbd5e1",
  brightWhite: "#f8fafc",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
};

export interface XTermProps {
  projectId: string;
  terminalId: string;
  /** Whether this tab is visible; it fits and takes focus when it becomes active. */
  active: boolean;
  dark: boolean;
  onExit?: (exitCode: number | null) => void;
}

export default function XTerm({ projectId, terminalId, active, dark, onExit }: XTermProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const onExitRef = useRef(onExit);
  const activeRef = useRef(active);
  const darkRef = useRef(dark);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: false,
      theme: darkRef.current ? DARK : LIGHT,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    // Keystrokes: sent in order, coalescing whatever is typed while a request is in flight.
    let pending = "";
    let sending = false;
    const flush = async () => {
      if (sending || !pending) return;
      sending = true;
      while (pending && !disposed) {
        const chunk = pending;
        pending = "";
        try {
          await workspaceApi.sendInput(projectId, terminalId, chunk);
        } catch {
          // The session may have ended; drop the input.
        }
      }
      sending = false;
    };
    const dataSub = term.onData((d) => {
      pending += d;
      void flush();
    });

    // Size: fit to the container, then tell the PTY (debounced).
    let lastSize = "";
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const sendSize = () => {
      const size = `${term.cols}x${term.rows}`;
      if (size === lastSize) return;
      lastSize = size;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        void workspaceApi.resizeTerminal(projectId, terminalId, term.cols, term.rows).catch(() => {});
      }, 100);
    };
    const doFit = () => {
      if (disposed || !activeRef.current) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      sendSize();
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => doFit()) : null;
    observer?.observe(container);
    requestAnimationFrame(doFit);

    // Output. The first "data" event replays the session's buffer; after a reconnect we reset
    // so the replay doesn't duplicate what is already on screen.
    let opens = 0;
    let exited = false;
    const es = new EventSource(workspaceApi.terminalStreamUrl(projectId, terminalId));
    es.onopen = () => {
      opens++;
      if (opens > 1) term.reset();
    };
    es.addEventListener("data", (ev) => {
      try {
        const { data } = JSON.parse((ev as MessageEvent<string>).data) as { data: string };
        if (typeof data === "string") term.write(data);
      } catch {
        // ignore malformed events
      }
    });
    es.addEventListener("exit", (ev) => {
      let code: number | null = null;
      try {
        code = (JSON.parse((ev as MessageEvent<string>).data) as { exit_code: number | null }).exit_code ?? null;
      } catch {
        // keep null
      }
      exited = true;
      es.close();
      onExitRef.current?.(code);
    });
    es.onerror = () => {
      // EventSource reconnects by itself; stop once the session is gone.
      if (exited) es.close();
    };

    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      observer?.disconnect();
      es.close();
      dataSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [projectId, terminalId]);

  useEffect(() => {
    darkRef.current = dark;
    if (termRef.current) termRef.current.options.theme = dark ? DARK : LIGHT;
  }, [dark]);

  useEffect(() => {
    activeRef.current = active;
    if (!active) return;
    const id = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container || container.clientWidth === 0) return;
      try {
        fitRef.current?.fit();
      } catch {
        // not laid out yet
      }
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [active]);

  return <div ref={containerRef} className="h-full w-full" data-testid={`xterm-${terminalId}`} />;
}
