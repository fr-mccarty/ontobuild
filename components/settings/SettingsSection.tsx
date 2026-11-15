import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  id?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  highlighted?: boolean;
  className?: string;
  children: ReactNode;
}

export function SettingsSection({
  id,
  title,
  description,
  actions,
  highlighted = false,
  className,
  children,
}: SettingsSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-heading` : undefined}
      className={cn(
        "scroll-mt-20 rounded-lg border border-slate-200 bg-white p-6 transition-colors duration-1000 dark:border-slate-700 dark:bg-slate-800",
        highlighted && "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20",
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id={id ? `${id}-heading` : undefined} className="text-lg font-semibold text-slate-900 dark:text-white">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

interface SettingsFieldProps {
  id?: string;
  labelId: string;
  label: ReactNode;
  hint?: ReactNode;
  highlighted?: boolean;
  className?: string;
  children: ReactNode;
}

export function SettingsField({
  id,
  labelId,
  label,
  hint,
  highlighted = false,
  className,
  children,
}: SettingsFieldProps) {
  return (
    <div
      id={id}
      className={cn(
        "scroll-mt-8 rounded-lg p-2 -mx-2 transition-colors duration-1000",
        highlighted && "bg-amber-100 dark:bg-amber-900/30",
        className,
      )}
    >
      <span id={labelId} className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </span>
      {children}
      {hint && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}
