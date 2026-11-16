"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Keeps the tooltip closed, e.g. while the trigger's own menu is open. */
  disabled?: boolean;
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  if (content === null || content === undefined || content === false || content === "") {
    return <>{children}</>;
  }
  return (
    <TooltipPrimitive.Root open={open && !disabled} onOpenChange={(next) => setOpen(next && !disabled)}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={5}
          className={cn(
            "z-50 max-w-xs rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-50",
            "shadow-md tooltip-fade-in",
            "dark:bg-slate-100 dark:text-slate-900",
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-slate-900 dark:fill-slate-100" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
