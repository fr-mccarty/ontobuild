"use client";

import { isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Brain, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentMessage } from "@/lib/api/agentChat";
import { visibleUserText, type AgentConversation } from "@/lib/stores/agentChatStore";
import { ToolCallRow } from "./ToolCallRow";

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary-600 px-3 py-2 text-sm whitespace-pre-wrap break-words text-white dark:bg-primary-500">
        {text}
      </div>
    </div>
  );
}

function groupToolRows(items: ReactNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const key = isValidElement(run[0]) ? `tools-${String(run[0].key)}` : `tools-${out.length}`;
    out.push(
      <div key={key} className="-my-1 flex flex-col">
        {run}
      </div>,
    );
    run = [];
  };
  for (const item of items) {
    if (isValidElement(item) && item.type === ToolCallRow) run.push(item);
    else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

function AssistantText({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed whitespace-pre-wrap break-words",
        muted ? "text-slate-500 dark:text-slate-400" : "text-slate-800 dark:text-slate-100",
      )}
    >
      {text}
    </div>
  );
}

function ThinkingSection({ text, active }: { text: string; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // While the model is still thinking, keep the expanded box pinned to its newest line.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && open && active && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [text, open, active]);

  return (
    <div className="text-xs text-slate-500 dark:text-slate-400">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 italic hover:text-slate-700 dark:hover:text-slate-300"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        {active ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
        {active ? "Thinking…" : "Thought"}
      </button>
      {open && (
        <div className="mt-1 border-l-2 border-slate-200 dark:border-slate-700">
          <div
            ref={bodyRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
            className="max-h-64 overflow-y-auto overscroll-contain pl-2 whitespace-pre-wrap break-words"
          >
            {text}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-1 ml-2 flex items-center gap-1 italic hover:text-slate-700 dark:hover:text-slate-300"
          >
            <ChevronRight className="h-3 w-3 -rotate-90" />
            Hide thinking
          </button>
        </div>
      )}
    </div>
  );
}

function parseArguments(args: string | undefined): unknown {
  if (!args) return undefined;
  try {
    return JSON.parse(args);
  } catch {
    return args;
  }
}

function reasoningText(message: AgentMessage): string {
  const r = (message as { reasoning?: unknown }).reasoning;
  if (typeof r === "string" && r.trim()) return r;
  const details = (message as { reasoning_details?: unknown }).reasoning_details;
  if (!Array.isArray(details)) return "";
  return details
    .map((d) => {
      if (!d || typeof d !== "object") return "";
      const { summary, text } = d as { summary?: unknown; text?: unknown };
      if (typeof summary === "string") return summary;
      if (typeof text === "string") return text;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

interface AgentTranscriptProps {
  conversation: AgentConversation;
  emptyState?: ReactNode;
}

export function AgentTranscript({ conversation, emptyState }: AgentTranscriptProps) {
  const { messages, toolCalls, liveToolIds, pendingUserText, streamingText, thinkingText, isStreaming, stopped } =
    conversation;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const historyToolIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of messages) {
      if (m.role === "assistant") for (const c of m.tool_calls ?? []) ids.add(c.id);
    }
    return ids;
  }, [messages]);

  const items: ReactNode[] = [];
  messages.forEach((m, i) => {
    if (m.role === "user") {
      const text = visibleUserText(m);
      if (text) items.push(<UserBubble key={`m${i}`} text={text} />);
    } else if (m.role === "assistant") {
      const reasoning = reasoningText(m);
      if (reasoning.trim()) items.push(<ThinkingSection key={`r${i}`} text={reasoning} />);
      if (typeof m.content === "string" && m.content.trim()) {
        items.push(<AssistantText key={`t${i}`} text={m.content} />);
      }
      for (const call of m.tool_calls ?? []) {
        const info = toolCalls[call.id];
        items.push(
          <ToolCallRow
            key={`c${call.id}`}
            name={call.function?.name ?? info?.name ?? ""}
            input={info?.input ?? parseArguments(call.function?.arguments)}
            status={info?.status ?? "unknown"}
            summary={info?.summary}
          />,
        );
      }
    }
  });

  if (pendingUserText) items.push(<UserBubble key="pending-user" text={pendingUserText} />);
  if (thinkingText.trim()) items.push(<ThinkingSection key="live-thinking" text={thinkingText} active={isStreaming} />);
  if (streamingText) {
    items.push(<AssistantText key="live-text" text={streamingText} />);
  }
  for (const id of liveToolIds) {
    if (historyToolIds.has(id)) continue;
    const info = toolCalls[id];
    if (!info) continue;
    items.push(
      <ToolCallRow key={`live-${id}`} name={info.name} input={info.input} status={info.status} summary={info.summary} />,
    );
  }
  if (!isStreaming && stopped) {
    items.push(<AssistantText key="stopped" text="Stopped." muted />);
  }
  if (isStreaming && !streamingText && !thinkingText) {
    items.push(
      <div key="working" className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Working…
      </div>,
    );
  }

  const contentSignature = `${messages.length}|${streamingText.length}|${thinkingText.length}|${liveToolIds.length}|${Object.keys(toolCalls).length}|${pendingUserText ?? ""}|${isStreaming}`;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [contentSignature]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      role="log"
      aria-live="polite"
      aria-label="Agent conversation"
    >
      {items.length === 0 ? emptyState : <div className="flex flex-col gap-3">{groupToolRows(items)}</div>}
    </div>
  );
}
