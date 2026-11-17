"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import { useToast, type Toast } from "@/lib/context/ToastContext";
import { cn } from "@/lib/utils";

const toastIcons = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  error: <XCircle className="h-4 w-4 text-red-500" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  info: <Info className="h-4 w-4 text-blue-500" />,
};

const toastStyles = {
  success: "border-emerald-200 dark:border-emerald-800",
  error: "border-red-200 dark:border-red-800",
  warning: "border-amber-200 dark:border-amber-800",
  info: "border-blue-200 dark:border-blue-800",
};

/**
 * Where every toast shows: the bottom-right corner of the window. Fixed on purpose; there is
 * one container (mounted in app/providers.tsx) and no way to place toasts anywhere else.
 * Portaled to <body> so no ancestor (a transform, an overflow, a stacking context) can move or
 * clip it, above dialogs (z-50), and clickable while a modal dialog makes the page inert.
 */
export const TOAST_REGION_CLASS = "pointer-events-auto fixed bottom-4 right-4 z-100 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2";

export function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div className={TOAST_REGION_CLASS} data-toast-region="" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useToast();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => removeToast(toast.id), 150);
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-white px-4 py-3 shadow-lg transition-all duration-150 dark:bg-slate-800",
        toastStyles[toast.type],
        isVisible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      )}
      role="alert"
    >
      <span className="mt-0.5 shrink-0">{toastIcons[toast.type]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {toast.title}
        </p>
        {toast.description && (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {toast.description}
          </p>
        )}
      </div>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick();
            handleDismiss();
          }}
          className="shrink-0 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-sm p-0.5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
