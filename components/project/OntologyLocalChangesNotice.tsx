"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, GitCommitHorizontal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { projectApi } from "@/lib/api/projects";

export const ontologyLocalChangesQueryKey = (projectId: string) => ["ontology-local-changes", projectId] as const;

/** How often to look for changes made in the folder: often enough to notice an agent at work, cheap for git. */
const POLL_MS = 5000;

interface OntologyLocalChangesNoticeProps {
  projectId: string;
  /** The branch the editor shows. The notice only applies when it's the one checked out in the folder. */
  activeBranch: string | undefined;
  /** Called after the changes are committed, to reload the editor. */
  onCommitted: () => void;
}

/**
 * A strip under the editor's top row when the ontology file in the project folder has changes
 * that aren't committed (made by an agent, a terminal or a text editor). The editor shows the
 * branch's last commit, so they're out of view until committed; this commits them and reloads.
 */
export function OntologyLocalChangesNotice({ projectId, activeBranch, onCommitted }: OntologyLocalChangesNoticeProps) {
  const queryClient = useQueryClient();
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ontologyLocalChangesQueryKey(projectId),
    queryFn: () => projectApi.getOntologyLocalChanges(projectId),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  if (!data?.changed || !activeBranch || data.branch !== activeBranch) return null;

  const commit = async () => {
    setCommitting(true);
    setError(null);
    try {
      await projectApi.commitOntologyLocalChanges(projectId);
      await queryClient.invalidateQueries({ queryKey: ontologyLocalChangesQueryKey(projectId) });
      onCommitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't commit the changes");
    } finally {
      setCommitting(false);
    }
  };

  const problem = data.problem ?? error;

  return (
    <div
      role="status"
      data-testid="ontology-local-changes"
      className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{data.path}</span> has changes in the project folder that aren&apos;t committed, so the
        editor isn&apos;t showing them.
        {problem && <span className="mt-0.5 block text-amber-800 dark:text-amber-300">{problem}</span>}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={commit}
        disabled={committing || !!data.problem}
        className="flex-shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-900/40"
      >
        {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCommitHorizontal className="h-4 w-4" />}
        Commit and reload
      </Button>
    </div>
  );
}
