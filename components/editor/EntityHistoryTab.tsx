"use client";

import {
  History,
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  ArrowUp,
  AlertTriangle,
} from "lucide-react";
import { useEntityHistory } from "@/lib/hooks/useEntityHistory";
import { DisclosureSection } from "@/components/editor/shared/Disclosure";
import { sectionHelp } from "@/lib/editor/sectionHelp";
import { cn } from "@/lib/utils";
import type { ChangeEventType } from "@/lib/api/analytics";
import { Tooltip } from "@/components/ui/tooltip";

const EVENT_ICONS: Record<ChangeEventType, React.ReactNode> = {
  create: <Plus className="h-3.5 w-3.5 text-green-500" />,
  update: <Pencil className="h-3.5 w-3.5 text-blue-500" />,
  delete: <Trash2 className="h-3.5 w-3.5 text-red-500" />,
  rename: <ArrowRight className="h-3.5 w-3.5 text-purple-500" />,
  reparent: <ArrowUp className="h-3.5 w-3.5 text-amber-500" />,
  deprecate: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
};

const EVENT_LABELS: Record<ChangeEventType, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
  rename: "renamed",
  reparent: "reparented",
  deprecate: "deprecated",
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

interface EntityHistoryTabProps {
  projectId: string;
  entityIri: string | null;
  branch?: string;
}

export function EntityHistoryTab({
  projectId,
  entityIri,
  branch,
}: EntityHistoryTabProps) {
  const { data, isLoading, error } = useEntityHistory(
    projectId,
    entityIri,
    branch
  );

  if (!entityIri) return null;

  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  if (!isLoading && !error && data && total === 0) return null;

  return (
    <DisclosureSection
      key={entityIri}
      icon={<History className="h-4 w-4" />}
      title="History"
      count={isLoading ? null : total}
      tooltip={sectionHelp("History")}
      defaultOpen={false}
      aside={
        <>
          {isLoading && (
            <div className="py-1">
              <div className="h-4 w-24 animate-pulse rounded-sm bg-slate-200 dark:bg-slate-700" />
            </div>
          )}
          {error && !isLoading && (
            <p className="py-1 text-xs text-red-500">Failed to load history</p>
          )}
        </>
      }
    >
      <div>
        {events.map((event) => {
          const icon =
            EVENT_ICONS[event.event_type as ChangeEventType] || EVENT_ICONS.update;
          const label =
            EVENT_LABELS[event.event_type as ChangeEventType] || event.event_type;

          return (
            <div
              key={event.id}
              className="relative flex items-start gap-2.5 py-1.5 pl-0"
            >
              <span className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white dark:bg-slate-900">
                {icon}
              </span>
              <div className="min-w-0 flex-1 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {event.user_name || "Unknown"}
                </span>{" "}
                {label}
                {event.changed_fields.length > 0 && (
                  <span className="text-slate-400 dark:text-slate-500">
                    {" "}
                    ({event.changed_fields.join(", ")})
                  </span>
                )}
                <Tooltip content={new Date(event.created_at).toLocaleString()}>
                  <span
                    className={cn(
                      "ml-1.5 text-[10px] text-slate-400 dark:text-slate-500"
                    )}
                  >
                    {formatRelativeTime(event.created_at)}
                  </span>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
    </DisclosureSection>
  );
}
