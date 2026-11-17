import { useEffect, useRef } from "react";

/**
 * Cmd/Ctrl+S in the editor. The page's shortcut dispatches this event; the entity panel being
 * edited answers by committing its draft, the same as its "Save now" button.
 */
export const SAVE_REQUEST_EVENT = "ontobuilder:save-request";

export function requestSave(): void {
  window.dispatchEvent(new Event(SAVE_REQUEST_EVENT));
}

/** Run `save` when Cmd/Ctrl+S is pressed, while `enabled`. */
export function useSaveShortcut(enabled: boolean, save: () => unknown): void {
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    if (!enabled) return;
    const onSave = () => void saveRef.current();
    window.addEventListener(SAVE_REQUEST_EVENT, onSave);
    return () => window.removeEventListener(SAVE_REQUEST_EVENT, onSave);
  }, [enabled]);
}
