"use client";

import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import NextLink from "next/link";
import { Share2, ChevronDown, Link as LinkIcon, GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/context/ToastContext";
import { getLocalName } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

/** Classes for a row in the share menu; overflow items passed in `moreItems` use them too. */
export const SHARE_MENU_ITEM_CLASSES = cn(
  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100",
  "dark:text-slate-300 dark:hover:bg-slate-700",
);

interface ShareButtonProps {
  projectId: string;
  selectedIri?: string | null;
  selectedLabel?: string | null;
  openPRCount?: number;
  /**
   * Controls that no longer fit inline in the sub header on narrow windows. Rendered above
   * the share items; each item hides itself (display:none) at the widths where its inline
   * version shows. Receives a function that closes the menu.
   */
  moreItems?: (closeMenu: () => void) => ReactNode;
  /**
   * The responsive class that hides the "more" part (its divider and the "and more" in the
   * trigger's name and tooltip) once every overflow item is back inline, e.g. "lg:hidden".
   */
  moreHiddenClass?: string;
}

export function ShareButton({
  projectId,
  selectedIri,
  selectedLabel,
  openPRCount = 0,
  moreItems,
  moreHiddenClass,
}: ShareButtonProps) {
  const toast = useToast();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const projectUrl = typeof window !== "undefined"
    ? `${window.location.origin}/projects/${projectId}`
    : `/projects/${projectId}`;

  const classUrl = selectedIri
    ? `${projectUrl}?classIri=${encodeURIComponent(selectedIri)}`
    : null;

  const displayLabel = selectedLabel || (selectedIri ? getLocalName(selectedIri) : null);
  const truncatedLabel = displayLabel && displayLabel.length > 24
    ? `${displayLabel.slice(0, 23)}…`
    : displayLabel;

  const copyToClipboard = useCallback(async (url: string, label?: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(label ? `Copied link to "${label}"` : "Copied project link");
    } catch {
      toast.error("Failed to copy link");
    }
    setDropdownOpen(false);
  }, [toast]);

  const closeMenu = useCallback(() => setDropdownOpen(false), []);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [dropdownOpen]);

  return (
    <div ref={dropdownRef} className="relative flex items-center">
      <Tooltip
        side="bottom"
        disabled={dropdownOpen}
        content={
          <>
            {`Share: copy a link to this project${selectedIri ? " or the selected class" : ""}, or open pull requests${openPRCount > 0 ? ` (${openPRCount} open)` : ""}`}
            {moreItems && (
              <span className={moreHiddenClass}>. Also holds the editor controls that don&apos;t fit in the bar at this width</span>
            )}
          </>
        }
      >
        <Button
          variant="ghost"
          size="sm"
          className="gap-0.5 px-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          aria-label={moreItems ? undefined : "Share options"}
          aria-expanded={dropdownOpen}
          aria-haspopup="menu"
        >
          {moreItems && (
            <>
              {/* Named by its content so the "and more" part drops out with display:none on wide screens. */}
              <span className="sr-only">Share options</span>
              <span className={cn("sr-only", moreHiddenClass)}> and more</span>
            </>
          )}
          <Share2 className="h-4 w-4" />
          <ChevronDown className={cn("h-3 w-3 transition-transform", dropdownOpen && "rotate-180")} />
        </Button>
      </Tooltip>

      {dropdownOpen && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg",
            "dark:border-slate-700 dark:bg-slate-800",
            "animate-in fade-in-0 zoom-in-95",
          )}
        >
          {moreItems && (
            <div className={moreHiddenClass}>
              {moreItems(closeMenu)}
              <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
            </div>
          )}
          {classUrl && (
            <button
              role="menuitem"
              className={SHARE_MENU_ITEM_CLASSES}
              onClick={() => copyToClipboard(classUrl, displayLabel || undefined)}
            >
              <Share2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">Copy link to &ldquo;{truncatedLabel}&rdquo;</span>
            </button>
          )}
          <button
            role="menuitem"
            className={SHARE_MENU_ITEM_CLASSES}
            onClick={() => copyToClipboard(projectUrl)}
          >
            <LinkIcon className="h-3.5 w-3.5 flex-shrink-0" />
            Copy project link
          </button>
          <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
          <NextLink
            href={`/projects/${projectId}/pull-requests`}
            role="menuitem"
            className={SHARE_MENU_ITEM_CLASSES}
            onClick={() => setDropdownOpen(false)}
          >
            <GitPullRequest className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1">Pull requests</span>
            {openPRCount > 0 && (
              <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
                {openPRCount}
              </span>
            )}
          </NextLink>
        </div>
      )}
    </div>
  );
}
