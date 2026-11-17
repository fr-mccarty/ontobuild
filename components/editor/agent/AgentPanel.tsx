"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, FileText, KeyRound, Loader2, RotateCcw, SquarePen, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { DEFAULT_AGENT_API_KEY_ENV } from "@/lib/api/agentSettings";
import type { AgentOntologyChange, AgentUiAction } from "@/lib/api/agentChat";
import { buildPageContextFromDocument, type AgentPageInfo } from "@/lib/agent/pageContext";
import {
  retryAgentMessage,
  sendAgentMessage,
  startNewAgentChat,
  stopAgentMessage,
  useAgentChatStore,
  useAgentConversation,
} from "@/lib/stores/agentChatStore";
import { useAgentPermissionsStore } from "@/lib/stores/agentPermissionsStore";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";
import { AgentPermissionToggles } from "./AgentPermissionToggles";
import { AgentTranscript } from "./AgentTranscript";
import { AgentComposer } from "./AgentComposer";
import { AgentModelPicker } from "./AgentModelPicker";
import { useAgentStatus } from "./agentQueries";
import { AgentHealthStrip } from "./AgentHealthStrip";
import { AgentNotice, AGENT_NOTICE_ACTION_CLASSES } from "./AgentNotice";
import { buildHealthFixPrompt } from "@/lib/agent/healthSummary";
import { healthQueryKeys } from "@/lib/hooks/useHealthSummary";
import { useQueryClient } from "@tanstack/react-query";

export const AGENT_EXAMPLE_PROMPTS = [
  "Explain the selected entity",
  "Run all the health checks and fix what they find",
  "Add a subclass under the selected class",
  "Find classes that are missing labels or definitions",
];

/** The line put before a message that came from "Run as prompt" with a source. */
export function withPromptSource(text: string, source: string | null): string {
  return source ? `Prompt source: ${source}\n${text}` : text;
}

export interface AgentPanelProps {
  pageInfo: AgentPageInfo;
  /** A tool call changed project state (branches, pull requests, settings or the ontology). */
  onProjectChanged?: () => void;
  /** A tool call committed to the ontology on `change.branch`. */
  onOntologyChanged?: (change: AgentOntologyChange) => void;
  /** The agent asked the editor to act, for example to select an entity. */
  onUiAction?: (action: AgentUiAction) => void;
}

interface AgentPanelCallbacks {
  onProjectChanged?: () => void;
  onOntologyChanged?: (change: AgentOntologyChange) => void;
  onUiAction?: (action: AgentUiAction) => void;
}

export function AgentPanel({ pageInfo, onProjectChanged, onOntologyChanged, onUiAction }: AgentPanelProps) {
  const { projectId } = pageInfo;
  const conversation = useAgentConversation(projectId);
  const dismissError = useAgentChatStore((s) => s.dismissError);
  const model = useAgentChatStore((s) => s.model);
  const effort = useAgentChatStore((s) => s.effort);
  const setModel = useAgentChatStore((s) => s.setModel);
  const setEffort = useAgentChatStore((s) => s.setEffort);
  const { data: status, isLoading: statusLoading, error: statusError, refetch } = useAgentStatus();
  const [draft, setDraft] = useState("");
  const [promptSource, setPromptSource] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusPendingRef = useRef(false);
  const queryClient = useQueryClient();

  // The agent may run health checks or fix issues during a turn (checks don't count as
  // project changes), so refresh the health counts whenever a turn ends.
  const wasStreamingRef = useRef(conversation.isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !conversation.isStreaming) {
      void queryClient.invalidateQueries({ queryKey: healthQueryKeys.all });
    }
    wasStreamingRef.current = conversation.isStreaming;
  }, [conversation.isStreaming, queryClient]);

  // Restore the Edit Code / Edit Ontology choice after mount (the first render uses the defaults).
  useEffect(() => {
    void useAgentPermissionsStore.persist.rehydrate();
  }, []);

  // "Run as prompt" queues text in the workspace store; put it in the composer without sending.
  useEffect(() => {
    const consume = () => {
      const prompt = useWorkspaceStore.getState().takePendingPrompt();
      if (!prompt) return;
      setDraft(prompt.text);
      setPromptSource(prompt.source?.trim() || null);
      focusPendingRef.current = true;
      inputRef.current?.focus();
    };
    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      if (state.pendingPrompt) consume();
    });
    queueMicrotask(consume);
    return unsubscribe;
  }, []);

  // Focus once the composer exists (it is not rendered while the status loads).
  useEffect(() => {
    if (focusPendingRef.current && inputRef.current) {
      focusPendingRef.current = false;
      const el = inputRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });

  const pageInfoRef = useRef(pageInfo);
  const callbacksRef = useRef<AgentPanelCallbacks>({ onProjectChanged, onOntologyChanged, onUiAction });
  useEffect(() => {
    pageInfoRef.current = pageInfo;
    callbacksRef.current = { onProjectChanged, onOntologyChanged, onUiAction };
  });

  useEffect(() => {
    if (!status) return;
    if (model === null) setModel(status.settings.model);
    if (effort === null) setEffort(status.settings.effort);
  }, [status, model, effort, setModel, setEffort]);

  const runOptions = useCallback(
    () => ({
      projectId,
      branch: pageInfoRef.current.branch,
      buildContext: (last: string | null) => buildPageContextFromDocument(pageInfoRef.current, last),
      onProjectChanged: () => callbacksRef.current.onProjectChanged?.(),
      onOntologyChanged: (change: AgentOntologyChange) => callbacksRef.current.onOntologyChanged?.(change),
      onUiAction: (action: AgentUiAction) => callbacksRef.current.onUiAction?.(action),
    }),
    [projectId],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setDraft("");
      setPromptSource(null);
      void sendAgentMessage({ ...runOptions(), text: withPromptSource(trimmed, promptSource) });
    },
    [runOptions, promptSource],
  );

  const configured = status?.configured ?? false;
  const isEmpty = conversation.messages.length === 0 && !conversation.pendingUserText && !conversation.isStreaming;

  let body: React.ReactNode;
  if (statusLoading) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  } else if (statusError) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-600 dark:text-slate-400">
        <AlertCircle className="h-6 w-6 text-red-500" />
        <p>Could not load the agent status.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  } else if (!configured) {
    const envName = status?.api_key_env || DEFAULT_AGENT_API_KEY_ENV;
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="agent-not-configured">
        <KeyRound className="h-8 w-8 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">The agent isn&apos;t set up yet</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Add your OpenRouter key to{" "}
          <code className="break-all rounded bg-slate-100 px-1 py-0.5 font-mono text-xs dark:bg-slate-800">
            {status?.secrets_file ?? "the secrets file"}
          </code>
          :
        </p>
        <pre className="w-full overflow-x-auto rounded-md bg-slate-100 px-3 py-2 text-left font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          {envName}=...
        </pre>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Get a key at{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            className="text-primary-600 hover:underline dark:text-primary-400"
          >
            openrouter.ai/keys
          </a>
          , then check the setup in{" "}
          <Link href="/settings#agent" className="text-primary-600 hover:underline dark:text-primary-400">
            agent settings
          </Link>
          .
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Check again
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <AgentTranscript
          conversation={conversation}
          emptyState={
            <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
              <Sparkles className="h-7 w-7 text-primary-500" />
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Ask the agent to explain, check or edit this ontology. It can see what&apos;s on the page.
              </p>
              <div className="flex w-full flex-col gap-1.5">
                {AGENT_EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => send(p)}
                    className="rounded-md border border-slate-200 px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:border-primary-300 hover:bg-primary-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-700 dark:hover:bg-primary-900/20"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          }
        />
        {conversation.error && !conversation.isStreaming && (
          <AgentNotice
            tone="error"
            role="alert"
            icon={<AlertCircle className="h-3.5 w-3.5" />}
            onDismiss={() => dismissError(projectId)}
            actions={
              <button
                type="button"
                onClick={() => void retryAgentMessage(runOptions())}
                className={AGENT_NOTICE_ACTION_CLASSES}
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Retry
              </button>
            }
          >
            <span className="break-words">{conversation.error}</span>
          </AgentNotice>
        )}
        <AgentHealthStrip
          health={pageInfo.health}
          disabled={conversation.isStreaming}
          onFix={() => {
            if (!pageInfo.health) return;
            setDraft(buildHealthFixPrompt(pageInfo.health));
            setPromptSource("Health");
            focusPendingRef.current = true;
          }}
        />
        <AgentComposer
          value={draft}
          onChange={setDraft}
          onSend={() => send(draft)}
          onStop={() => stopAgentMessage(projectId)}
          isStreaming={conversation.isStreaming}
          inputRef={inputRef}
          toolbar={
            <>
              <AgentPermissionToggles />
              {promptSource && (
                <div
                  data-testid="agent-prompt-source"
                  className="inline-flex max-w-full items-center gap-1 self-start rounded-full bg-slate-100 py-0.5 pl-2 pr-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">From: {promptSource}</span>
                  <button
                    type="button"
                    onClick={() => setPromptSource(null)}
                    aria-label="Remove prompt source"
                    className="rounded-full p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </>
          }
        />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-1.5 dark:border-slate-700">
        {configured ? (
          <AgentModelPicker />
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500">Agent</span>
        )}
        <div className="ml-auto">
          <Tooltip content="Start a new conversation" side="bottom">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                startNewAgentChat(projectId);
                setDraft("");
                setPromptSource(null);
              }}
              disabled={isEmpty}
              aria-label="New chat"
              className="h-7 gap-1 px-2 text-xs"
            >
              <SquarePen className="h-3.5 w-3.5" />
              New chat
            </Button>
          </Tooltip>
        </div>
      </div>
      {body}
    </div>
  );
}
