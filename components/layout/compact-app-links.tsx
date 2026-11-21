"use client";

import Link from "next/link";
import { UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * Pages with their own top row (the project editor) leave out the main header; these stand in for it there.
 */

export const USER_SETTINGS_TOOLTIP =
  "User settings: your preferences across all projects (theme, Save button, AI agent key, effort and instructions)";

/** The app icon (same drawing as app/icon.svg). */
export function OntoBuildIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <rect width="32" height="32" rx="6" fill="#3B82F6" />
      <circle cx="16" cy="10" r="3" fill="white" />
      <circle cx="8" cy="22" r="3" fill="white" />
      <circle cx="24" cy="22" r="3" fill="white" />
      <line x1="16" y1="13" x2="9" y2="19" stroke="white" strokeWidth="2" />
      <line x1="16" y1="13" x2="23" y2="19" stroke="white" strokeWidth="2" />
      <line x1="11" y1="22" x2="21" y2="22" stroke="white" strokeWidth="2" />
    </svg>
  );
}

/** The OntoBuild icon, linking home to the projects list. Sits at the far left of the row. */
export function HomeIconLink() {
  return (
    <Tooltip side="bottom" content="OntoBuild: back to all projects">
      <Link href="/" aria-label="OntoBuild home" className="-my-1 flex flex-shrink-0 items-center rounded-md">
        <OntoBuildIcon className="h-6 w-6" />
      </Link>
    </Tooltip>
  );
}

/** The user settings gear. A user-cog so it reads apart from the project settings gear beside it. */
export function UserSettingsLink({ className }: { className?: string }) {
  return (
    <Tooltip side="bottom" content={USER_SETTINGS_TOOLTIP}>
      <Link href="/settings" aria-label="User settings" className={className}>
        <Button
          variant="ghost"
          size="sm"
          tabIndex={-1}
          className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          <UserCog className="h-4 w-4" />
        </Button>
      </Link>
    </Tooltip>
  );
}
