"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

/**
 * Open state of the editor's two sidebars: the entity tree on the left and the agent and
 * health panel on the right.
 *
 * From Tailwind's `lg` breakpoint (1024px) up both may be open side by side. Below it the
 * right panel floats over the editor (see RightSidebar), and only one sidebar shows at a
 * time: opening one closes the other, and when both were left open (on a wide window that
 * then narrowed) only the most recently opened one shows. Visibility is derived during
 * render from the open states and the breakpoint, so widening the window again shows both.
 */
export type EditorSidebarSide = "left" | "right";

export interface EditorSidebarState {
  left: boolean;
  right: boolean;
  /** The sidebar opened most recently; decides which one shows on a narrow window. */
  last?: EditorSidebarSide;
}

export const EDITOR_SIDEBARS_KEY = "ontobuilder:editorSidebars";
/** Both open by default; with nothing opened yet, a narrow window shows the right one. */
export const EDITOR_SIDEBARS_DEFAULT: EditorSidebarState = { left: true, right: true };
/** Below this width the sidebars are exclusive (Tailwind `lg` is 1024px). */
export const NARROW_EDITOR_QUERY = "(max-width: 1023.98px)";

function readStoredRaw(): string | null {
  try {
    return localStorage.getItem(EDITOR_SIDEBARS_KEY);
  } catch {
    return null;
  }
}

function parseState(raw: string | null): EditorSidebarState {
  if (!raw) return EDITOR_SIDEBARS_DEFAULT;
  try {
    const v = JSON.parse(raw) as Partial<EditorSidebarState>;
    if (typeof v?.left !== "boolean" || typeof v?.right !== "boolean") return EDITOR_SIDEBARS_DEFAULT;
    const last = v.last === "left" || v.last === "right" ? v.last : undefined;
    return { left: v.left, right: v.right, last };
  } catch {
    return EDITOR_SIDEBARS_DEFAULT;
  }
}

function writeState(state: EditorSidebarState) {
  try {
    localStorage.setItem(EDITOR_SIDEBARS_KEY, JSON.stringify(state));
  } catch {
    return;
  }
}

const subscribeToNothing = () => () => {};
const getServerRaw = () => null;

function subscribeToNarrow(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(NARROW_EDITOR_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const getNarrow = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(NARROW_EDITOR_QUERY).matches;
const getServerNarrow = () => false;

/** Whether the window is below the editor's overlay breakpoint. */
export function useIsNarrowEditor(): boolean {
  return useSyncExternalStore(subscribeToNarrow, getNarrow, getServerNarrow);
}

/** Which sidebars show, given their open states and whether the window is narrow. */
export function visibleSidebars(state: EditorSidebarState, narrow: boolean): { left: boolean; right: boolean } {
  if (!narrow || !state.left || !state.right) return { left: state.left, right: state.right };
  const winner = state.last ?? "right";
  return { left: winner === "left", right: winner === "right" };
}

export function useEditorSidebars() {
  const narrow = useIsNarrowEditor();
  // The persisted state; the server snapshot uses the default so hydration matches.
  const storedRaw = useSyncExternalStore(subscribeToNothing, readStoredRaw, getServerRaw);
  const stored = useMemo(() => parseState(storedRaw), [storedRaw]);
  // Changes made in this session win (and still work when storage is unavailable).
  const [chosen, setChosen] = useState<EditorSidebarState | undefined>(undefined);
  const state = chosen ?? stored;
  const visible = visibleSidebars(state, narrow);

  const update = useCallback((next: EditorSidebarState) => {
    setChosen(next);
    writeState(next);
  }, []);

  const setOpen = useCallback(
    (side: EditorSidebarSide, open: boolean) => {
      const other: EditorSidebarSide = side === "left" ? "right" : "left";
      if (!open) {
        update({ ...state, [side]: false });
        return;
      }
      // On a narrow window opening one sidebar closes the other.
      update({ ...state, [side]: true, [other]: narrow ? false : state[other], last: side });
    },
    [state, narrow, update],
  );

  // Toggles act on what the user sees: a sidebar that is open but hidden behind the
  // other on a narrow window opens (and takes over) rather than closing.
  const toggleLeft = useCallback(() => setOpen("left", !visible.left), [setOpen, visible.left]);
  const toggleRight = useCallback(() => setOpen("right", !visible.right), [setOpen, visible.right]);
  const closeRight = useCallback(() => {
    if (visible.right) setOpen("right", false);
  }, [setOpen, visible.right]);

  return {
    narrow,
    state,
    leftOpen: visible.left,
    rightOpen: visible.right,
    setOpen,
    toggleLeft,
    toggleRight,
    closeRight,
  };
}
