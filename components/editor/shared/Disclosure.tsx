"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The editor's one way to show and hide a list (Used By, History, a class's subclasses and
 * individuals): a chevron toggle and the body it opens. DisclosureSection lays them out as a
 * heading row like the editor's other sections and, while open, the body under it beside a line
 * just right of where the title starts.
 */

/** Right when closed, down when open. */
export function DisclosureChevron({ open, className }: { open: boolean; className?: string }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <Icon
      aria-hidden
      data-testid="disclosure-chevron"
      data-open={String(open)}
      className={cn("h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500", className)}
    />
  );
}

/** The space a chevron takes, to line up a row that has nothing to disclose with one that does. */
export function DisclosureChevronSpacer() {
  return <span aria-hidden className="h-3 w-3 shrink-0" />;
}

interface DisclosureToggleProps {
  open: boolean;
  onToggle: () => void;
  /** Explains what opens; shown on hover and focus. */
  tooltip?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function DisclosureToggle({ open, onToggle, tooltip, className, children }: DisclosureToggleProps) {
  const button = (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm text-left focus:outline-hidden focus-visible:ring-1 focus-visible:ring-primary-500",
        className,
      )}
    >
      <DisclosureChevron open={open} />
      {children}
    </button>
  );
  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
}

/** What a toggle opens. Renders nothing while closed. */
export function DisclosureBody({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div data-testid="disclosure-body" className={className}>
      {children}
    </div>
  );
}

/*
 * Where the open row's line and content fall, from the section's left edge. The heading's title
 * starts 38px in (the 16px icon, a 6px gap, the 12px chevron and a 4px gap); the line sits a little
 * to the right of that, and the content a little to the right of the line.
 */
const LINE_LEFT = "left-[44px]";
const CONTENT_INDENT = "pl-[56px]";

interface DisclosureSectionProps {
  /** The section's icon, as in the editor's other sections. */
  icon: ReactNode;
  title: string;
  /** Shown after the title, e.g. "Used By (3)"; null while unknown shows "...". */
  count?: number | null;
  /** Explains the section; shown on hover and focus of the label. */
  tooltip?: ReactNode;
  /**
   * Whether it starts open. It keeps its own state from there; give the section a `key` (such as
   * the entity's IRI) to start again from this when the entity changes.
   */
  defaultOpen: boolean;
  /** False when there is nothing to open: the label shows without a chevron (lined up) and the body is hidden. */
  openable?: boolean;
  /** Always shown beside the heading, in the content column: a loading line, an error, an action. */
  aside?: ReactNode;
  testId?: string;
  children: ReactNode;
}

/**
 * A section of the entity editor whose content opens and closes, in two rows: the heading (icon,
 * chevron, title and count) in the left column like every other section, with `aside` beside it;
 * and, while open, the content under it, beside a line just right of where the title starts.
 */
export function DisclosureSection({
  icon,
  title,
  count,
  tooltip,
  defaultOpen,
  openable = true,
  aside,
  testId,
  children,
}: DisclosureSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const onToggle = () => setOpen((v) => !v);
  const label = count === undefined ? title : `${title} (${count === null ? "..." : count})`;
  const labelClasses = "text-xs font-medium text-slate-500 dark:text-slate-400";
  return (
    <div data-testid={testId}>
      <div className="flex gap-4">
        <div className="flex w-40 shrink-0 items-start gap-1.5 pt-1">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-slate-400 dark:text-slate-500">{icon}</span>
          {openable ? (
            <DisclosureToggle
              open={open}
              onToggle={onToggle}
              tooltip={tooltip}
              className={cn(labelClasses, "hover:text-slate-700 dark:hover:text-slate-300")}
            >
              {label}
            </DisclosureToggle>
          ) : (
            <Tooltip content={tooltip}>
              <span className={cn("inline-flex items-center gap-1", labelClasses)}>
                <DisclosureChevronSpacer />
                {label}
              </span>
            </Tooltip>
          )}
        </div>
        <div className="min-w-0 flex-1">{aside}</div>
      </div>
      {openable && open && (
        // Under the heading: a line just right of where the title starts, and the content beside it.
        <div className={cn("relative pt-1", CONTENT_INDENT)}>
          <span
            aria-hidden
            data-testid="disclosure-line"
            className={cn("absolute bottom-0 top-0 w-px bg-slate-200 dark:bg-slate-700", LINE_LEFT)}
          />
          <DisclosureBody open>{children}</DisclosureBody>
        </div>
      )}
    </div>
  );
}
