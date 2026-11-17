import { create } from "zustand";

/** One terminal tab in the bottom panel (a shell, a file run or the dev server). */
export interface TerminalTab {
  id: string;
  title: string;
  kind: "shell" | "run" | "devserver";
}

export type RightSidebarTab = "agent" | "health" | "files";

interface WorkspaceState {
  /** Bottom terminal panel. */
  terminalPanelOpen: boolean;
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  setTerminalPanelOpen: (open: boolean) => void;
  addTerminal: (tab: TerminalTab) => void;
  removeTerminal: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  setTerminals: (tabs: TerminalTab[]) => void;
  /** Project the terminal tabs belong to; switching projects clears the tabs. */
  terminalsProjectId: string | null;
  setTerminalsProject: (projectId: string) => void;

  /** Right sidebar: the selected tab, and a counter bumped to ask the page to open the sidebar. */
  rightTab: RightSidebarTab;
  rightOpenRequest: number;
  /** Set when an action asked for a specific tab; the sidebar otherwise opens on Agent. */
  rightTabRequested: boolean;
  /** Called when the sidebar mounts: keeps a requested tab, or goes back to Agent. */
  resetRightTabOnOpen: () => void;
  setRightTab: (tab: RightSidebarTab) => void;
  showRightTab: (tab: RightSidebarTab) => void;

  /** Text queued for the agent composer by "Run as prompt"; the agent panel consumes it. */
  pendingPrompt: { text: string; source?: string } | null;
  queuePrompt: (text: string, source?: string) => void;
  takePendingPrompt: () => { text: string; source?: string } | null;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  terminalPanelOpen: false,
  terminals: [],
  activeTerminalId: null,
  setTerminalPanelOpen: (open) => set({ terminalPanelOpen: open }),
  addTerminal: (tab) =>
    set((s) => ({
      terminals: s.terminals.some((t) => t.id === tab.id) ? s.terminals : [...s.terminals, tab],
      activeTerminalId: tab.id,
      terminalPanelOpen: true,
    })),
  removeTerminal: (id) =>
    set((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id);
      const activeTerminalId =
        s.activeTerminalId === id ? (terminals[terminals.length - 1]?.id ?? null) : s.activeTerminalId;
      return { terminals, activeTerminalId, terminalPanelOpen: terminals.length > 0 && s.terminalPanelOpen };
    }),
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
  setTerminals: (tabs) =>
    set((s) => ({
      terminals: tabs,
      activeTerminalId: tabs.some((t) => t.id === s.activeTerminalId) ? s.activeTerminalId : (tabs[0]?.id ?? null),
    })),

  terminalsProjectId: null,
  setTerminalsProject: (projectId) =>
    set((s) =>
      s.terminalsProjectId === projectId
        ? s
        : { terminalsProjectId: projectId, terminals: [], activeTerminalId: null, terminalPanelOpen: false },
    ),

  rightTab: "agent",
  rightOpenRequest: 0,
  rightTabRequested: false,
  resetRightTabOnOpen: () =>
    set((s) => (s.rightTabRequested ? { rightTabRequested: false } : { rightTab: "agent" })),
  setRightTab: (tab) => set({ rightTab: tab }),
  showRightTab: (tab) =>
    set((s) => ({ rightTab: tab, rightTabRequested: true, rightOpenRequest: s.rightOpenRequest + 1 })),

  pendingPrompt: null,
  queuePrompt: (text, source) =>
    set((s) => ({
      pendingPrompt: { text, source },
      rightTab: "agent",
      rightTabRequested: true,
      rightOpenRequest: s.rightOpenRequest + 1,
    })),
  takePendingPrompt: () => {
    const p = get().pendingPrompt;
    if (p) set({ pendingPrompt: null });
    return p;
  },
}));
