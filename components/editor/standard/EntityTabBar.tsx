"use client";

import { cn } from "@/lib/utils";

export type EntityTab = "classes" | "properties" | "individuals";

interface EntityTabBarProps {
  activeTab: EntityTab;
  onTabChange: (tab: EntityTab) => void;
  /** Entity counts shown after each tab's label; a missing count shows nothing. */
  counts?: Partial<Record<EntityTab, number>>;
}

const tabs: { id: EntityTab; label: string }[] = [
  { id: "classes", label: "Classes" },
  { id: "properties", label: "Properties" },
  { id: "individuals", label: "Individuals" },
];

export function EntityTabBar({ activeTab, onTabChange, counts }: EntityTabBarProps) {
  return (
    <div className="flex border-b border-slate-200 dark:border-slate-700">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "flex-1 px-3 py-2 text-xs font-medium transition-colors",
            activeTab === tab.id
              ? "border-b-2 border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
          )}
        >
          {tab.label}
          {counts?.[tab.id] !== undefined && (
            <span data-testid={`entity-count-${tab.id}`} className="ml-1 font-normal text-slate-400 tabular-nums dark:text-slate-500">
              {counts[tab.id]!.toLocaleString()}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
