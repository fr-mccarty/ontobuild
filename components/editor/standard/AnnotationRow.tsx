"use client";

import { Trash2 } from "lucide-react";
import { getAnnotationPropertyInfo } from "@/lib/ontology/annotationProperties";
import { Tooltip } from "@/components/ui/tooltip";
import { RunAsPromptButton } from "@/components/editor/RunAsPromptButton";

interface AnnotationRowProps {
  propertyIri: string;
  value: string;
  onValueChange: (value: string) => void;
  onRemove?: () => void;
  onBlur?: () => void;
  showPropertyLabel?: boolean;
  placeholder?: string;
  /** IRI of the entity this value belongs to (used as the prompt's source by "Run as prompt"). */
  subjectIri?: string;
}

export function AnnotationRow({
  propertyIri,
  value,
  onValueChange,
  onRemove,
  onBlur,
  showPropertyLabel = true,
  placeholder = "Value",
  subjectIri,
}: AnnotationRowProps) {
  const { displayLabel, curie } = getAnnotationPropertyInfo(propertyIri);
  const isLongValue = value.length > 80;

  return (
    <div className="flex items-start gap-2">
      {showPropertyLabel && (
        <Tooltip content={curie}>
          <span className="mt-1.5 shrink-0 rounded-sm bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {displayLabel}
          </span>
        </Tooltip>
      )}
      {isLongValue ? (
        <textarea
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={2}
          aria-label={`${displayLabel} value`}
          className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-hidden focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          aria-label={`${displayLabel} value`}
          className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-hidden focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
        />
      )}
      <RunAsPromptButton text={value} propertyIri={propertyIri} subjectIri={subjectIri} />
      {onRemove ? (
        <button
          onClick={onRemove}
          className="mt-1 shrink-0 rounded-sm p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
          aria-label={`Remove ${displayLabel} annotation`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <div className="mt-1 shrink-0 rounded-sm p-1">
          <div className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}
