"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/lib/stores/preferencesStore";
import type { SaveStatus } from "@/lib/hooks/useAutoSave";

interface AutoSaveAffordanceBarProps {
  status: SaveStatus;
  error?: string | null;
  validationError?: string | null;
  onRetry?: () => void;
  /** Writes the draft to the ontology and commits it now, instead of waiting to leave the entity. */
  onManualSave?: () => void;
  /** Throws the draft away and goes back to the saved version. */
  onCancel?: () => void;
}

type EffectiveStatus = SaveStatus | "validationError";

const LABELS: Record<EffectiveStatus, string> = {
  idle: "Saved",
  saved: "Saved",
  draft: "Unsaved changes",
  saving: "Saving…",
  error: "Not saved",
  validationError: "Can't save",
};

const LABEL_CLASSES: Record<EffectiveStatus, string> = {
  idle: "text-slate-500 dark:text-slate-400",
  saved: "text-green-600 dark:text-green-400",
  draft: "text-amber-600 dark:text-amber-400",
  saving: "text-slate-500 dark:text-slate-400",
  error: "text-red-600 dark:text-red-400",
  validationError: "text-red-600 dark:text-red-400",
};

const HOW_SAVING_WORKS =
  "Edits save automatically. As you type they're kept as a draft in this browser, and they're written to the ontology file and committed to Git when you select another entity or leave the page.";

function StatusIcon({ status }: { status: EffectiveStatus }) {
  if (status === "saving") return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (status === "draft") return <span className="h-2 w-2 rounded-full bg-amber-400" />;
  if (status === "error" || status === "validationError") return <AlertTriangle className="h-3.5 w-3.5" />;
  return <Check className="h-3.5 w-3.5" />;
}

function statusDetail(status: EffectiveStatus, error?: string | null, validationError?: string | null): string {
  switch (status) {
    case "draft":
      return "Your edits are kept as a draft in this browser but aren't in the ontology file yet.";
    case "saving":
      return "Writing your edits to the ontology file and committing them to Git.";
    case "error":
      return `Your edits couldn't be saved: ${error || "the save failed"}. They're still kept as a draft in this browser.`;
    case "validationError":
      return `Your edits can't be saved until this is fixed: ${validationError}`;
    default:
      return "Everything is saved to the ontology file.";
  }
}

/**
 * Whether the entity being edited is saved. A single status label beside the entity's title;
 * clicking it explains how saving works and offers Save now / Discard / Retry when they apply.
 */
export function AutoSaveAffordanceBar({
  status,
  error,
  validationError,
  onRetry,
  onManualSave,
  onCancel,
}: AutoSaveAffordanceBarProps) {
  const hideSaveNow = usePreferencesStore((s) => s.hideSaveButton);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const effectiveStatus: EffectiveStatus = validationError ? "validationError" : status;
  const isError = effectiveStatus === "error" || effectiveStatus === "validationError";
  const canSaveNow = effectiveStatus === "draft" && !!onManualSave && !hideSaveNow;
  const canDiscard = (effectiveStatus === "draft" || isError) && !!onCancel;
  const canRetry = effectiveStatus === "error" && !!onRetry;

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

  const run = (action?: () => void) => {
    setOpen(false);
    action?.();
  };

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <div role="status" aria-live={isError ? "assertive" : "polite"}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`${LABELS[effectiveStatus]}: about saving`}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-700",
            LABEL_CLASSES[effectiveStatus],
          )}
        >
          <StatusIcon status={effectiveStatus} />
          {LABELS[effectiveStatus]}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </div>

      {canRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
        >
          Retry
        </button>
      )}

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="About saving"
          className="absolute right-0 top-full z-30 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <p className={cn("font-medium", LABEL_CLASSES[effectiveStatus])}>
            {statusDetail(effectiveStatus, error, validationError)}
          </p>
          <p className="mt-2 text-slate-600 dark:text-slate-300">{HOW_SAVING_WORKS}</p>

          {(canSaveNow || canDiscard) && (
            <div className="mt-3 flex items-center gap-2">
              {canSaveNow && (
                <button
                  type="button"
                  onClick={() => run(onManualSave)}
                  className="rounded-md bg-primary-600 px-2.5 py-1 font-medium text-white hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
                >
                  Save now
                </button>
              )}
              {canDiscard && (
                <button
                  type="button"
                  onClick={() => run(onCancel)}
                  className="rounded-md px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Discard changes
                </button>
              )}
            </div>
          )}

          <p className="mt-3 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Change how saving works in{" "}
            <Link
              href="/settings#save-button"
              className="text-primary-600 hover:underline dark:text-primary-400"
              onClick={() => setOpen(false)}
            >
              Settings
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
