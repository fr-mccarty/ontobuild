"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentOntologyChange, AgentUiAction } from "@/lib/api/agentChat";
import type { RefreshTreeOptions } from "@/lib/hooks/useOntologyTree";
import { useToast } from "@/lib/context/ToastContext";
import { useDraftStore, draftKey } from "@/lib/stores/draftStore";
import { useSelectionStore } from "@/lib/stores/selectionStore";
import { getLocalName } from "@/lib/utils";

/** How long to wait for more agent changes before refreshing, so a burst refreshes once. */
export const AGENT_REFRESH_DELAY_MS = 300;

/** Marks the element that holds the entity detail panel; focus inside it means the user is editing. */
export const ENTITY_DETAIL_PANEL_ATTR = "data-entity-detail-panel";

export interface UseAgentEditorSyncOptions {
  projectId: string;
  /** The branch open in the editor. */
  activeBranch?: string;
  /** Reload the class tree in place (keeps expanded nodes and the selection). */
  refreshTree: (options?: RefreshTreeOptions) => Promise<void>;
  /** Reload the Turtle source the editor holds. */
  reloadSource: () => Promise<void>;
  /** Make the open detail panel re-read its entity (the editor's own post-save refresh). */
  refreshDetail: () => void;
  /** Selects an entity the way a click in the tree does: switches tab, expands, selects. */
  entityNavigationRef: React.RefObject<((iri: string, type?: string) => void) | null>;
  /** Clears the property or individual selection when it was deleted. */
  entityRemovalRef?: React.RefObject<((iris: string[]) => void) | null>;
  /** Fallback for selecting a class when the layout has not registered its navigation yet. */
  navigateToNode: (iri: string) => Promise<void>;
}

interface PendingRefresh {
  project: boolean;
  ontology: boolean;
  removedIris: Set<string>;
}

const nothingPending = (): PendingRefresh => ({ project: false, ontology: false, removedIris: new Set() });

/**
 * Keeps the editor in step with the agent. The agent panel reports project changes (any
 * mutating tool), ontology commits (with their branch) and UI actions; this hook turns them
 * into one coalesced refresh of everything the editor shows and into entity selection.
 */
export function useAgentEditorSync({
  projectId,
  activeBranch,
  refreshTree,
  reloadSource,
  refreshDetail,
  entityNavigationRef,
  entityRemovalRef,
  navigateToNode,
}: UseAgentEditorSyncOptions) {
  const queryClient = useQueryClient();
  const toast = useToast();

  /** Reloads the property and individual lists in place. */
  const [entityListRefreshKey, setEntityListRefreshKey] = useState(0);
  /** Remounts the open detail panel so it re-reads the entity from scratch. */
  const [detailEpoch, setDetailEpoch] = useState(0);
  /** Reloads the health panel and the history panel. */
  const [sidePanelsRefreshKey, setSidePanelsRefreshKey] = useState(0);

  const stateRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    running: Promise<void> | null;
    pending: PendingRefresh;
  }>({ timer: null, running: null, pending: nothingPending() });

  const latest = useRef({ projectId, activeBranch, refreshTree, reloadSource, refreshDetail, toast });
  useEffect(() => {
    latest.current = { projectId, activeBranch, refreshTree, reloadSource, refreshDetail, toast };
  });

  const runRefresh = useCallback(
    async ({ ontology, removedIris }: PendingRefresh) => {
      const { projectId: pid, activeBranch: branch } = latest.current;
      // Branch heads and commit hashes, the project, the open PR count, lint summary,
      // normalization status, entity history and cross-references: every query scoped
      // to this project.
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes(pid) });
      setSidePanelsRefreshKey((k) => k + 1);
      if (!ontology) return;

      const removed = [...removedIris];
      if (removed.length) entityRemovalRef?.current?.(removed);
      await Promise.all([
        latest.current.refreshTree({ removedIris: removed }),
        latest.current.reloadSource().catch((err) => console.error("Failed to reload source:", err)),
      ]);
      setEntityListRefreshKey((k) => k + 1);
      latest.current.refreshDetail();

      // The detail panel keeps its form state once loaded, so it shows the agent's change
      // only after a remount. A remount would drop the user's unsaved edits, so remount
      // only when there are none: no draft for the entity and no focus inside the panel
      // (an edit in progress that is not a draft yet).
      const { iri: shownIri } = useSelectionStore.getState();
      if (!shownIri || removedIris.has(shownIri)) {
        setDetailEpoch((e) => e + 1);
        return;
      }
      const key = draftKey(pid, branch || "main", shownIri);
      const hasDraft = useDraftStore.getState().hasDraft(key);
      const panel = document.querySelector(`[${ENTITY_DETAIL_PANEL_ATTR}]`);
      const active = document.activeElement;
      const editing = !!panel && !!active && active !== document.body && panel.contains(active);
      if (!hasDraft && !editing) {
        setDetailEpoch((e) => e + 1);
        return;
      }
      latest.current.toast.addToast({
        type: "warning",
        title: "The agent changed the ontology",
        description:
          `Your unsaved edits to "${getLocalName(shownIri)}" are kept, so its panel does not show the agent's changes yet. ` +
          "Saving your edits replaces the agent's changes to this entity only.",
        duration: 15000,
        action: {
          label: "Discard my edits",
          onClick: () => {
            useDraftStore.getState().clearDraft(key);
            setDetailEpoch((e) => e + 1);
          },
        },
      });
    },
    [queryClient, entityRemovalRef],
  );

  /** Runs any pending refresh now and resolves when no refresh is running. */
  const flush = useCallback(async () => {
    const state = stateRef.current;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    while (state.running) await state.running;
    const work = state.pending;
    if (!work.project && !work.ontology) return;
    state.pending = nothingPending();
    state.running = runRefresh(work).finally(() => {
      state.running = null;
    });
    await state.running;
  }, [runRefresh]);

  const schedule = useCallback(
    (change: { ontology: boolean; removedIris?: string[] }) => {
      const state = stateRef.current;
      state.pending.project = true;
      if (change.ontology) state.pending.ontology = true;
      for (const iri of change.removedIris ?? []) state.pending.removedIris.add(iri);
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => void flush(), AGENT_REFRESH_DELAY_MS);
    },
    [flush],
  );

  useEffect(
    () => () => {
      const state = stateRef.current;
      if (state.timer) clearTimeout(state.timer);
    },
    [],
  );

  const onProjectChanged = useCallback(() => schedule({ ontology: false }), [schedule]);

  const onOntologyChanged = useCallback(
    (change: AgentOntologyChange) => {
      // An empty branch means unknown (the stream stopped mid-tool): assume the open one.
      const current = latest.current.activeBranch;
      const onOpenBranch = !change.branch || !current || change.branch === current;
      schedule({ ontology: onOpenBranch, removedIris: onOpenBranch ? change.deleted_iris : [] });
    },
    [schedule],
  );

  const onUiAction = useCallback(
    async (action: AgentUiAction) => {
      if (action.action !== "select_entity") return;
      const current = latest.current.activeBranch;
      if (action.branch && current && action.branch !== current) {
        latest.current.toast.info(
          `"${action.label || getLocalName(action.iri)}" is on branch ${action.branch}`,
          `The editor shows ${current}.`,
        );
        return;
      }
      // Apply pending refreshes first, so an entity the agent just created is in the tree.
      await flush();
      if (entityNavigationRef.current) {
        entityNavigationRef.current(action.iri, action.entity_type);
      } else if (action.entity_type === "class") {
        await navigateToNode(action.iri);
      }
    },
    [flush, entityNavigationRef, navigateToNode],
  );

  return {
    entityListRefreshKey,
    detailEpoch,
    sidePanelsRefreshKey,
    onProjectChanged,
    onOntologyChanged,
    onUiAction,
    flush,
  };
}
