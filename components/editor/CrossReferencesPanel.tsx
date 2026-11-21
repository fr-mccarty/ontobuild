"use client";

import { ExternalLink, Link } from "lucide-react";
import { DisclosureSection } from "@/components/editor/shared/Disclosure";
import { useCrossReferences } from "@/lib/hooks/useCrossReferences";
import { cn, getLocalName } from "@/lib/utils";
import { EntityTypeIcon, EntityTypeTooltipContent } from "@/components/editor/shared/EntityTypeIcon";
import type { CrossReferenceGroup, ReferenceContext } from "@/lib/ontology/qualityTypes";
import { Tooltip } from "@/components/ui/tooltip";
import { sectionHelp } from "@/lib/editor/sectionHelp";

const CONTEXT_LABELS: Record<ReferenceContext, string> = {
  parent_iris: "As parent class",
  domain_iris: "As domain",
  range_iris: "As range",
  type_iris: "As type",
  equivalent_iris: "As equivalent class",
  disjoint_iris: "As disjoint class",
  some_values_from: "In restriction",
  annotation_value: "In annotation",
  see_also: "As see also",
  inverse_of: "As inverse property",
};

interface CrossReferencesPanelProps {
  projectId: string;
  entityIri: string | null;
  branch?: string;
  onNavigateToClass?: (iri: string) => void;
}

export function CrossReferencesPanel({
  projectId,
  entityIri,
  branch,
  onNavigateToClass,
}: CrossReferencesPanelProps) {
  const { data, isLoading } = useCrossReferences(
    projectId,
    entityIri,
    branch
  );

  if (!entityIri) return null;

  const total = data?.total ?? 0;

  return (
    <DisclosureSection
      key={entityIri}
      icon={<Link className="h-4 w-4" />}
      title="Used By"
      count={isLoading ? null : total}
      tooltip={sectionHelp("Used By")}
      defaultOpen
      openable={!isLoading && total > 0}
      aside={
        isLoading && (
          <div className="py-1">
            <div className="h-4 w-24 animate-pulse rounded-sm bg-slate-200 dark:bg-slate-700" />
          </div>
        )
      }
    >
      <div className="space-y-2">
        {data?.groups.map((group: CrossReferenceGroup) => (
          <ReferenceGroup
            key={group.context}
            group={group}
            onNavigate={onNavigateToClass}
          />
        ))}
      </div>
    </DisclosureSection>
  );
}

function ReferenceGroup({
  group,
  onNavigate,
}: {
  group: CrossReferenceGroup;
  onNavigate?: (iri: string) => void;
}) {
  const label = CONTEXT_LABELS[group.context] || group.context_label;

  return (
    <div>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {label} ({group.references.length})
      </p>
      <div className="mt-1 space-y-0.5">
        {group.references.map((ref) => {
          return (
            <Tooltip key={`${ref.source_iri}-${ref.reference_context}`} content={<EntityTypeTooltipContent type={ref.source_type} iri={ref.source_iri} />}>
              <button
                onClick={() => onNavigate?.(ref.source_iri)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm",
                  "text-primary-600 hover:bg-slate-50 hover:text-primary-700",
                  "dark:text-primary-400 dark:hover:bg-slate-800 dark:hover:text-primary-300"
                )}
              >
                <EntityTypeIcon type={ref.source_type} className="h-4 w-4" tooltip={false} />
                <span className="truncate">
                  {ref.source_label || getLocalName(ref.source_iri)}
                </span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
