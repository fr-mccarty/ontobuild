import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { AgentPermissions } from "@/lib/api/agentChat";

export type { AgentPermissions };

export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = { edit_code: false, edit_ontology: true };

export const AGENT_PERMISSIONS_STORAGE_KEY = "ontokit-agent-permissions";

/** localStorage that never throws (private windows, blocked storage, test environments). */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return globalThis.localStorage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      globalThis.localStorage?.setItem(name, value);
    } catch {
      // Not persisted; the choice still applies for this page load.
    }
  },
  removeItem: (name) => {
    try {
      globalThis.localStorage?.removeItem(name);
    } catch {
      // ignore
    }
  },
};

interface AgentPermissionsState extends AgentPermissions {
  setEditCode: (on: boolean) => void;
  setEditOntology: (on: boolean) => void;
}

export const useAgentPermissionsStore = create<AgentPermissionsState>()(
  persist(
    (set) => ({
      ...DEFAULT_AGENT_PERMISSIONS,
      setEditCode: (on) => set({ edit_code: on }),
      setEditOntology: (on) => set({ edit_ontology: on }),
    }),
    {
      name: AGENT_PERMISSIONS_STORAGE_KEY,
      // Rehydrated by the agent panel after mount, so server and client render the same defaults first.
      skipHydration: true,
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (s) => ({ edit_code: s.edit_code, edit_ontology: s.edit_ontology }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AgentPermissions>;
        return {
          ...current,
          edit_code: typeof p.edit_code === "boolean" ? p.edit_code : current.edit_code,
          edit_ontology: typeof p.edit_ontology === "boolean" ? p.edit_ontology : current.edit_ontology,
        };
      },
    },
  ),
);

/** The current permissions, as sent to the server. */
export function getAgentPermissions(): AgentPermissions {
  const { edit_code, edit_ontology } = useAgentPermissionsStore.getState();
  return { edit_code, edit_ontology };
}
