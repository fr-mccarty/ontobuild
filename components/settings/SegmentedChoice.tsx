import { type ComponentType } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedChoiceOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

interface SegmentedChoiceProps<T extends string> {
  labelledBy: string;
  options: SegmentedChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function SegmentedChoice<T extends string>({
  labelledBy,
  options,
  value,
  onChange,
  disabled = false,
}: SegmentedChoiceProps<T>) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-labelledby={labelledBy}>
      {options.map(({ value: optionValue, label, icon: Icon }) => (
        <button
          type="button"
          key={optionValue}
          onClick={() => onChange(optionValue)}
          aria-pressed={value === optionValue}
          disabled={disabled}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
            value === optionValue
              ? "border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-900/20 dark:text-primary-300"
              : "border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500",
          )}
        >
          {Icon && <Icon className="h-4 w-4" />}
          {label}
        </button>
      ))}
    </div>
  );
}
