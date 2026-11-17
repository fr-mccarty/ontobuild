"use client";

import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Loader2, RefreshCw, Unlink } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { githubErrorMessage, type GitHubRemote } from "@/lib/api/github";
import { useGitHub } from "@/lib/hooks/useGitHub";
import { cn } from "@/lib/utils";

/** The GitHub mark (lucide-react in this version has no GitHub icon). */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function remoteLabel(r: GitHubRemote): string {
  if (!r.remote_url) return "";
  if (r.web_url) return r.web_url.replace(/^https:\/\//, "");
  return r.remote_url;
}

function tooltipFor(r: GitHubRemote | undefined): string {
  if (!r) return "GitHub: link this project to a repository";
  if (!r.remote_url) return "GitHub: link this project to a repository to push and pull";
  const where = r.is_github ? remoteLabel(r) : `${remoteLabel(r)} (not GitHub)`;
  if (r.ahead === null || r.behind === null) return `Linked to ${where}. The ${r.branch} branch hasn't been pushed yet.`;
  if (!r.ahead && !r.behind) return `Linked to ${where}. ${r.branch} is up to date with ${r.upstream ?? "the remote"} (as of the last fetch).`;
  return `Linked to ${where}. ${r.branch} is ${r.ahead} ahead and ${r.behind} behind ${r.upstream ?? "the remote"} (as of the last fetch).`;
}

/** `onPulled` runs after a pull moved the checked-out branch, so the editor can reload its source. */
export function GitHubButton({ projectId, onPulled }: { projectId: string; onPulled?: () => void }) {
  const [open, setOpen] = useState(false);
  const { query } = useGitHub(projectId);
  const remote = query.data;
  const linked = !!remote?.remote_url;
  const ahead = remote?.ahead ?? 0;
  const behind = remote?.behind ?? 0;

  return (
    <>
      <Tooltip side="bottom" content={tooltipFor(remote)}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={linked ? "GitHub: linked" : "GitHub: not linked"}
          className={cn(
            "inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-md px-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700",
            linked ? "text-slate-700 dark:text-slate-200" : "text-slate-400 dark:text-slate-500",
          )}
        >
          <GitHubMark className="h-4 w-4" />
          {linked && (ahead > 0 || behind > 0) && (
            <span data-testid="github-ahead-behind" className="flex items-center gap-0.5 text-xs tabular-nums">
              {ahead > 0 && (
                <span className="flex items-center">
                  <ArrowUp className="h-3 w-3" />
                  {ahead}
                </span>
              )}
              {behind > 0 && (
                <span className="flex items-center">
                  <ArrowDown className="h-3 w-3" />
                  {behind}
                </span>
              )}
            </span>
          )}
        </button>
      </Tooltip>
      {open && <GitHubDialog projectId={projectId} onOpenChange={setOpen} onPulled={onPulled} />}
    </>
  );
}

function GitHubDialog({
  projectId,
  onOpenChange,
  onPulled,
}: {
  projectId: string;
  onOpenChange: (open: boolean) => void;
  onPulled?: () => void;
}) {
  const gh = useGitHub(projectId);
  const remote = gh.query.data;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitHubMark className="h-5 w-5" /> GitHub
          </DialogTitle>
          <DialogDescription>
            Push and pull this project&apos;s repository. Sign-in uses your existing git setup (gh auth login, a
            credential helper or SSH keys); OntoKit never stores tokens.
          </DialogDescription>
        </DialogHeader>
        {gh.query.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {gh.query.error && <p className="text-sm text-red-600">{githubErrorMessage(gh.query.error)}</p>}
        {remote && (remote.remote_url ? <LinkedView remote={remote} gh={gh} onPulled={onPulled} /> : <UnlinkedView remote={remote} gh={gh} />)}
      </DialogContent>
    </Dialog>
  );
}

type GitHubHook = ReturnType<typeof useGitHub>;

function Output({ text, error }: { text?: string | null; error?: unknown }) {
  if (error) {
    return (
      <pre role="alert" className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
        {githubErrorMessage(error)}
      </pre>
    );
  }
  if (!text) return null;
  return (
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-slate-100 p-2 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
      {text}
    </pre>
  );
}

function UnlinkedView({ remote, gh }: { remote: GitHubRemote; gh: GitHubHook }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [description, setDescription] = useState("");

  const submitLink = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) gh.link.mutate(url.trim());
  };
  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) gh.create.mutate({ name: name.trim(), private: isPrivate, description: description.trim() || undefined });
  };

  return (
    <div className="space-y-5 text-sm">
      <form onSubmit={submitLink} className="space-y-2">
        <label htmlFor="github-remote-url" className="block font-medium text-slate-700 dark:text-slate-200">
          Link an existing repository
        </label>
        <div className="flex gap-2">
          <input
            id="github-remote-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo.git or git@github.com:owner/repo.git"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white"
          />
          <Button type="submit" size="sm" disabled={!url.trim() || gh.link.isPending}>
            {gh.link.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Link"}
          </Button>
        </div>
        <Output error={gh.link.error} />
      </form>

      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        {remote.gh_available && remote.gh_authenticated ? (
          <form onSubmit={submitCreate} className="space-y-2">
            <p className="font-medium text-slate-700 dark:text-slate-200">Or create a new repository on GitHub</p>
            <input
              aria-label="Repository name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-ontology or owner/my-ontology"
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white"
            />
            <input
              aria-label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                Private
              </label>
              <Button type="submit" size="sm" disabled={!name.trim() || gh.create.isPending}>
                {gh.create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create on GitHub"}
              </Button>
            </div>
            <Output error={gh.create.error} />
          </form>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">
            {remote.gh_available
              ? "To create a repository from here, sign in to the GitHub CLI: run "
              : "To create a repository from here, install the GitHub CLI (cli.github.com) and run "}
            <code className="rounded-sm bg-slate-100 px-1 dark:bg-slate-700">gh auth login</code> in a terminal.
          </p>
        )}
      </div>
    </div>
  );
}

function LinkedView({ remote, gh, onPulled }: { remote: GitHubRemote; gh: GitHubHook; onPulled?: () => void }) {
  const [pushAll, setPushAll] = useState(false);
  const busy = gh.fetchRemote.isPending || gh.pull.isPending || gh.push.isPending || gh.unlink.isPending;
  const last = [gh.fetchRemote, gh.pull, gh.push]
    .filter((m) => m.submittedAt > 0)
    .sort((a, b) => b.submittedAt - a.submittedAt)[0];

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {remote.web_url ? (
            <a
              href={remote.web_url}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-1 font-medium text-primary-600 hover:underline dark:text-primary-400"
            >
              <span className="truncate">{remoteLabel(remote)}</span>
              <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
            </a>
          ) : (
            <span className="truncate font-medium">{remote.remote_url}</span>
          )}
          {!remote.is_github && (
            <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {remote.host ?? "other host"}
            </span>
          )}
        </div>
        <p data-testid="github-status" className="text-slate-500 dark:text-slate-400">
          Branch <code>{remote.branch}</code>
          {remote.upstream ? (
            <>
              {" "}tracks <code>{remote.upstream}</code>: {remote.ahead ?? 0} ahead, {remote.behind ?? 0} behind
            </>
          ) : (
            " hasn't been pushed yet"
          )}
          {remote.last_fetched_at ? ` · fetched ${new Date(remote.last_fetched_at).toLocaleString()}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content="Download new commits from the remote without changing your branch">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => gh.fetchRemote.mutate()}>
            {gh.fetchRemote.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
            Fetch
          </Button>
        </Tooltip>
        <Tooltip content={`Fast-forward ${remote.branch} to the remote's commits`}>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => gh.pull.mutate(undefined, { onSuccess: () => onPulled?.() })}>
            {gh.pull.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowDown className="mr-1 h-4 w-4" />}
            Pull
          </Button>
        </Tooltip>
        <Tooltip content={pushAll ? "Push every local branch" : `Push ${remote.branch} to the remote`}>
          <Button size="sm" disabled={busy} onClick={() => gh.push.mutate({ all: pushAll })}>
            {gh.push.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowUp className="mr-1 h-4 w-4" />}
            Push
          </Button>
        </Tooltip>
        <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={pushAll} onChange={(e) => setPushAll(e.target.checked)} />
          all branches
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-slate-500 hover:text-red-600"
          disabled={busy}
          onClick={() => gh.unlink.mutate()}
        >
          <Unlink className="mr-1 h-4 w-4" />
          Unlink
        </Button>
      </div>

      {last && <Output text={last.data?.output} error={last.error} />}
      <Output error={gh.unlink.error} />
    </div>
  );
}
