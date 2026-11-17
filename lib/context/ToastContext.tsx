"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
  action?: ToastAction;
}

/** Extras for a toast: how long it stays (ms; 0 keeps it until dismissed) and a button. */
export interface ToastOptions {
  duration?: number;
  action?: ToastAction;
}

type ShowToast = (title: string, description?: string, options?: ToastOptions) => string;

/**
 * Every notification in the app goes through here and shows in the one ToastContainer.
 * Call the typed helpers: `toast.error("Couldn't <do the thing>", apiErrorMessage(err))`,
 * `toast.success("Copied the IRI")`. The title says what happened; the description why.
 */
interface ToastContextValue {
  toasts: Toast[];
  /** Low-level; components use success / error / warning / info. */
  addToast: (toast: Omit<Toast, "id">) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;

  success: ShowToast;
  error: ShowToast;
  warning: ShowToast;
  info: ShowToast;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 5000;

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, "id">): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const duration = toast.duration ?? DEFAULT_DURATION;

    const newToast: Toast = {
      ...toast,
      id,
      duration,
    };

    setToasts((prev) => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const success = useCallback<ShowToast>(
    (title, description, options) => addToast({ type: "success", title, description, ...options }),
    [addToast]
  );

  const error = useCallback<ShowToast>(
    (title, description, options) => addToast({ type: "error", title, description, ...options }),
    [addToast]
  );

  const warning = useCallback<ShowToast>(
    (title, description, options) => addToast({ type: "warning", title, description, ...options }),
    [addToast]
  );

  const info = useCallback<ShowToast>(
    (title, description, options) => addToast({ type: "info", title, description, ...options }),
    [addToast]
  );

  const value: ToastContextValue = {
    toasts,
    addToast,
    removeToast,
    clearToasts,
    success,
    error,
    warning,
    info,
  };

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
