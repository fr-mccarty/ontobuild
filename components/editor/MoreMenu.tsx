"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Classes for a row in the More menu. */
export const MORE_MENU_ITEM_CLASSES = cn(
  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100",
  "dark:text-slate-300 dark:hover:bg-slate-700",
);

interface MoreMenuProps {
  /**
   * The menu's items. Items that also appear inline in the bar at some widths hide themselves
   * there (e.g. "sm:hidden"). Receives a function that closes the menu.
   */
  children: (closeMenu: () => void) => ReactNode;
  /** Extra classes for the menu's wrapper, e.g. to hide it at some widths. */
  className?: string;
}

/** Sub header (far right, every width): a ⋮ menu for less used controls, and those that don't fit in the bar. */
export function MoreMenu({ children, className }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative flex items-center", className)}>
      <Tooltip side="bottom" disabled={open} content="More: keyboard shortcuts and other editor controls">
        <Button
          variant="ghost"
          size="sm"
          className="px-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          onClick={() => setOpen(!open)}
          aria-label="More"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          {children(closeMenu)}
        </div>
      )}
    </div>
  );
}
