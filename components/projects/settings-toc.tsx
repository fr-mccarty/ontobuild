"use client";

import { useEffect, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

export interface SettingsTocItem {
  id: string;
  label: string;
  /** Draws attention to a section that needs action (for example, normalization recommended). */
  attention?: boolean;
  danger?: boolean;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Project settings: links to each section, scrolling down to it. */
export function SettingsToc({ items }: { items: SettingsTocItem[] }) {
  // The page loads its data after the browser handled the URL's #section, so scroll there once rendered.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);

  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
  };

  return (
    <nav
      aria-label="Settings sections"
      className="mb-8 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
    >
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">On this page</h2>
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(e) => go(e, item.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:underline focus-visible:outline-2 focus-visible:outline-primary-500",
                item.danger
                  ? "text-red-600 dark:text-red-400"
                  : "text-primary-600 dark:text-primary-400",
              )}
            >
              {item.label}
              {item.attention && (
                <span
                  className="h-2 w-2 rounded-full bg-amber-500"
                  role="img"
                  aria-label="needs attention"
                />
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
