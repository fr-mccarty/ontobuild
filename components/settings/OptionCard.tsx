import { type ComponentType, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface OptionCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  selected: boolean;
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
}

export function OptionCard({
  selected,
  title,
  description,
  icon: Icon,
  className,
  type = "button",
  ...props
}: OptionCardProps) {
  return (
    <button
      type={type}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors disabled:opacity-50",
        selected
          ? "border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20"
          : "border-slate-200 hover:border-slate-300 dark:border-slate-600 dark:hover:border-slate-500",
        className,
      )}
      {...props}
    >
      {Icon && (
        <Icon
          className={cn(
            "h-5 w-5 flex-shrink-0",
            selected ? "text-primary-600 dark:text-primary-400" : "text-slate-400",
          )}
        />
      )}
      <div>
        <p
          className={cn(
            "font-medium",
            selected ? "text-primary-700 dark:text-primary-300" : "text-slate-900 dark:text-white",
          )}
        >
          {title}
        </p>
        {description && (
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
    </button>
  );
}
