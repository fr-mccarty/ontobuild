"use client";

import { useEffect } from "react";

export interface ShortcutDefinition {
  id: string;
  key: string;
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean };
  description: string;
  category: string;
  action: () => void;
  global?: boolean;
  ignoreWhenEditorFocused?: boolean;
}

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
}

export function formatShortcut(def: ShortcutDefinition): string {
  const parts: string[] = [];
  if (def.modifiers?.ctrl) parts.push(isMac() ? "Cmd" : "Ctrl");
  if (def.modifiers?.shift) parts.push("Shift");
  if (def.modifiers?.alt) parts.push(isMac() ? "Option" : "Alt");
  parts.push(def.key.length === 1 ? def.key.toUpperCase() : def.key);
  return parts.join("+");
}

function isInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function isMonacoFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  return !!active.closest(".monaco-editor");
}

function isRadixDialogOpen(): boolean {
  return !!document.querySelector("[data-state='open'][role='dialog']");
}

export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[]): void {
  useEffect(() => {
    if (shortcuts.length === 0) return;

    const handler = (e: KeyboardEvent) => {
      if (isRadixDialogOpen()) return;

      const monacoFocused = isMonacoFocused();
      const inputFocused = isInputElement(document.activeElement);

      for (const shortcut of shortcuts) {
        const wantsCtrl = shortcut.modifiers?.ctrl ?? false;
        const wantsShift = shortcut.modifiers?.shift ?? false;
        const wantsAlt = shortcut.modifiers?.alt ?? false;

        const ctrlMatch = wantsCtrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
        const shiftMatch = wantsShift ? e.shiftKey : !e.shiftKey;
        const altMatch = wantsAlt ? e.altKey : !e.altKey;

        const keyMatch =
          e.key.toLowerCase() === shortcut.key.toLowerCase() ||
          e.key === shortcut.key;

        if (!keyMatch || !ctrlMatch || !shiftMatch || !altMatch) continue;

        if (monacoFocused && shortcut.ignoreWhenEditorFocused !== false) continue;

        if (inputFocused && !shortcut.global) continue;

        e.preventDefault();
        e.stopPropagation();
        shortcut.action();
        return;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [shortcuts]);
}
