"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { GripVertical } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

interface ResizablePanelDividerProps {
  width: number;
  onWidthChange: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  invert?: boolean;
}

export function ResizablePanelDivider({
  width,
  onWidthChange,
  minWidth = 200,
  maxWidth = 600,
  invert = false,
}: ResizablePanelDividerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      setIsDragging(true);
    },
    [width]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = (e.clientX - startXRef.current) * (invert ? -1 : 1);
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta));
      onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, minWidth, maxWidth, onWidthChange, invert]);

  return (
    <Tooltip content="Drag to resize">
      <div
        onMouseDown={handleMouseDown}
        className="group relative z-10 flex w-0 cursor-col-resize items-center justify-center"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        <div
          className={`absolute inset-y-0 w-px transition-colors ${
            isDragging
              ? "bg-primary-500"
              : "bg-slate-200 group-hover:bg-primary-400 dark:bg-slate-700 dark:group-hover:bg-primary-500"
          }`}
        />
        <div
          className={`relative z-10 flex h-8 w-4 items-center justify-center rounded-xs transition-opacity ${
            isDragging
              ? "bg-primary-500 text-white opacity-100"
              : "bg-slate-200 text-slate-400 opacity-0 group-hover:opacity-100 dark:bg-slate-600 dark:text-slate-400"
          }`}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
      </div>
    </Tooltip>
  );
}
