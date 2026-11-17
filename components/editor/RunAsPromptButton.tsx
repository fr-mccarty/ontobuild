"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { QueryClientContext } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { getAnnotationPropertyInfo } from "@/lib/ontology/annotationProperties";
import { provenanceSummary, type Provenance } from "@/lib/api/provenance";
import { useProvenance } from "@/lib/hooks/useProvenance";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";
import { cn, getLocalName } from "@/lib/utils";

interface RunAsPromptButtonProps {
  text: string;
  propertyIri?: string;
  subjectIri?: string;
}

/**
 * ▶ next to a text value: puts the text in the agent composer (it is not sent). A dot shows
 * whether the text was approved through a pull request; unapproved text asks first.
 */
export function RunAsPromptButton(props: RunAsPromptButtonProps) {
  const queryClient = useContext(QueryClientContext);
  const params = useParams<{ id?: string }>();
  const projectId = typeof params?.id === "string" ? params.id : undefined;
  if (queryClient && projectId && props.subjectIri && props.propertyIri) {
    return <WithProvenance {...props} projectId={projectId} />;
  }
  return <PromptButton {...props} provenance={null} loading={false} />;
}

function WithProvenance(props: RunAsPromptButtonProps & { projectId: string }) {
  const searchParams = useSearchParams();
  const branch = searchParams?.get("branch") || undefined;
  const { data, isLoading } = useProvenance(
    props.projectId,
    { iri: props.subjectIri, property: props.propertyIri, value: props.text },
    branch,
  );
  // While the text is being edited the answer is for an older value.
  const current = data && data.value === props.text ? data : null;
  return <PromptButton {...props} provenance={current} loading={isLoading} />;
}

export function promptSource(
  subjectIri: string | undefined,
  propertyIri: string | undefined,
  provenance: Provenance | null | undefined,
): string | undefined {
  const parts: string[] = [];
  if (subjectIri) parts.push(getLocalName(subjectIri) || subjectIri);
  if (propertyIri) parts.push(getAnnotationPropertyInfo(propertyIri).displayLabel);
  if (!parts.length) return undefined;
  const summary = provenanceSummary(provenance);
  return parts.join(" · ") + (summary ? ` (${summary})` : "");
}

function statusText(p: Provenance | null, loading: boolean): string {
  if (!p) return loading ? "Checking whether this text was approved…" : "Not approved: this text isn't in the ontology yet, or hasn't been through a pull request.";
  const pr = p.pull_request;
  switch (p.status) {
    case "approved": {
      const who = pr?.approvals.map((a) => a.reviewer).join(", ");
      return `Approved in pull request #${pr?.number}${who ? ` by ${who}` : ""}.`;
    }
    case "pending":
      return pr
        ? `Not approved yet: pending in pull request #${pr.number} (${pr.status}).`
        : "Not approved yet: only on a branch, not in a pull request.";
    case "direct":
      return pr
        ? `Not approved: pull request #${pr.number} was merged without an approving review.`
        : "Not approved: committed directly to the default branch, not through a pull request.";
    default:
      return "Not approved: this text isn't saved in the ontology yet.";
  }
}

function PromptButton({
  text,
  propertyIri,
  subjectIri,
  provenance,
  loading,
}: RunAsPromptButtonProps & { provenance: Provenance | null; loading: boolean }) {
  const queuePrompt = useWorkspaceStore((s) => s.queuePrompt);
  const [confirming, setConfirming] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const empty = !text.trim();
  const approved = provenance?.status === "approved";
  const showDot = !empty && (provenance !== null || !loading);

  useEffect(() => {
    if (!confirming) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setConfirming(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [confirming]);

  const run = () => {
    setConfirming(false);
    queuePrompt(text, promptSource(subjectIri, propertyIri, provenance));
  };

  const tooltip = empty ? (
    "Run as prompt: enter some text first"
  ) : (
    <span>
      Run as prompt: put this text in the agent composer
      <br />
      <span className="opacity-80">{statusText(provenance, loading)}</span>
    </span>
  );

  return (
    <div ref={wrapRef} className="relative mt-1 shrink-0">
      <Tooltip content={tooltip} disabled={confirming}>
        <button
          type="button"
          onClick={() => (approved ? run() : setConfirming((v) => !v))}
          disabled={empty}
          aria-label="Run as prompt"
          aria-expanded={confirming || undefined}
          data-status={provenance?.status ?? (loading ? "loading" : "unknown")}
          className="relative rounded-sm p-1 text-slate-400 hover:bg-primary-50 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:hover:bg-primary-900/20 dark:hover:text-primary-400"
        >
          <Play className="h-3.5 w-3.5" />
          {showDot && (
            <span
              data-testid="prompt-approval-dot"
              aria-hidden
              className={cn(
                "absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-white dark:ring-slate-800",
                approved ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
          )}
        </button>
      </Tooltip>
      {confirming && (
        <div
          role="dialog"
          aria-label="Use unapproved text as a prompt"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <p className="text-slate-700 dark:text-slate-200">
            This text hasn&apos;t been approved through a pull request yet. Use it anyway?
          </p>
          <p className="mt-1 text-slate-500 dark:text-slate-400">{statusText(provenance, loading)}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-sm px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              autoFocus
              className="rounded-sm bg-primary-600 px-2 py-1 font-medium text-white hover:bg-primary-700"
            >
              Use anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
