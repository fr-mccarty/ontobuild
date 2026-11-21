"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

interface AgentComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  /** Shown above the input, for example the permission toggles and a prompt source chip. */
  toolbar?: ReactNode;
  /** Receives the textarea, so the panel can focus it. */
  inputRef?: Ref<HTMLTextAreaElement>;
}

const MAX_HEIGHT = 200;

export function AgentComposer({ value, onChange, onSend, onStop, isStreaming, disabled, toolbar, inputRef }: AgentComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(inputRef, () => ref.current as HTMLTextAreaElement, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    // Only scroll once the text is taller than the cap; otherwise no scrollbar shows.
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [value]);

  const canSend = !disabled && !isStreaming && value.trim().length > 0;

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className="border-t border-slate-200 p-2 dark:border-slate-700">
      {toolbar && <div className="mb-1.5 flex flex-col gap-1.5 px-0.5">{toolbar}</div>}
      <div className="flex items-end gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500 dark:border-slate-600 dark:bg-slate-800">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
          placeholder="Ask the agent about this ontology…"
          aria-label="Message the agent"
          className="max-h-[200px] min-h-[1.5rem] flex-1 resize-none bg-transparent py-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden disabled:cursor-not-allowed dark:text-white dark:placeholder:text-slate-500"
        />
        {isStreaming ? (
          <Tooltip content="Stop">
            <Button variant="secondary" size="sm" onClick={onStop} aria-label="Stop" className="h-7 w-7 shrink-0 p-0">
              <Square className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        ) : (
          <Tooltip content="Send (Enter)">
            <Button
              variant="primary"
              size="sm"
              onClick={onSend}
              disabled={!canSend}
              aria-label="Send"
              className="h-7 w-7 shrink-0 p-0"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </Tooltip>
        )}
      </div>
      <p className="mt-1 px-1 text-[10px] text-slate-400 dark:text-slate-500">Enter to send, Shift+Enter for a new line</p>
    </div>
  );
}
