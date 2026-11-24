"use client";

import { XCircle, AlertTriangle, Info, ExternalLink } from "lucide-react";
import { cn, getLocalName } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { EntityTypeIcon } from "@/components/editor/shared/EntityTypeIcon";
import type { RuleSeverity, RuleViolation } from "@/lib/api/rules";

const severityIcons: Record<RuleSeverity, React.ReactNode> = {
  error: <XCircle className="h-4 w-4 shrink-0 text-red-500" />,
  warning: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />,
  info: <Info className="h-4 w-4 shrink-0 text-blue-500" />,
};

const severityColors: Record<RuleSeverity, string> = {
  error: "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10",
  warning: "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10",
  info: "border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-900/10",
};

interface RuleViolationListProps {
  violations: RuleViolation[];
  onNavigate?: (iri: string, entityType: string) => void;
  showFocus?: boolean;
}

export function RuleViolationList({ violations, onNavigate, showFocus = true }: RuleViolationListProps) {
  return (
    <div className="space-y-2" data-testid="rule-violations">
      {violations.map((v, index) => (
        <div
          key={`${v.rule_iri}-${v.focus_node}-${v.property_iri ?? ""}-${v.value ?? ""}-${index}`}
          className={cn("rounded-lg border p-3", severityColors[v.severity])}
          data-severity={v.severity}
        >
          <div className="flex items-start gap-2">
            {severityIcons[v.severity]}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-700 dark:text-slate-300">{v.message}</p>
              {showFocus && (
                <Tooltip content={v.focus_node}>
                  <button
                    type="button"
                    onClick={() => onNavigate?.(v.focus_node, "individual")}
                    disabled={!onNavigate}
                    className="mt-1 flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 hover:underline disabled:no-underline dark:text-primary-400"
                  >
                    <EntityTypeIcon type="individual" className="h-4 w-4" tooltip={false} />
                    {getLocalName(v.focus_node)}
                    <ExternalLink className="h-3 w-3 opacity-50" />
                  </button>
                </Tooltip>
              )}
              {(v.property_iri || v.value !== null) && (
                <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                  {v.property_iri && <span>{getLocalName(v.property_iri)}</span>}
                  {v.property_iri && v.value !== null && <span>: </span>}
                  {v.value !== null && <span className="font-mono">{v.value}</span>}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
