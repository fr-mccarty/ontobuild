"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, KeyRound, Loader2, RotateCcw, SquarePen, Sparkles } from "lucide-react";
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
import { AgentTranscript } from "./AgentTranscript";
import { AgentComposer } from "./AgentComposer";
import { AgentModelPicker } from "./AgentModelPicker";
import { useAgentStatus } from "./agentQueries";

export const AGENT_EXAMPLE_PROMPTS = [
  "Explain the selected entity",
  "Run lint and fix the warnings",
  "Add a subclass under the selected class",
  "Find classes that are missing labels or definitions",
];

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
      void sendAgentMessage({ ...runOptions(), text: trimmed });
    },
    [runOptions],
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
          <div
            role="alert"
            className="mx-3 mb-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{conversation.error}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void retryAgentMessage(runOptions())}
              className="h-6 shrink-0 gap-1 px-2 text-xs"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dismissError(projectId)}
              className="h-6 shrink-0 px-2 text-xs"
            >
              Dismiss
            </Button>
          </div>
        )}
        <AgentComposer
          value={draft}
          onChange={setDraft}
          onSend={() => send(draft)}
          onStop={() => stopAgentMessage(projectId)}
          isStreaming={conversation.isStreaming}
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
