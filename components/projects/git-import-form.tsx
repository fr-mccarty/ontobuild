"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, FileCode, GitBranch, HelpCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/client";
import { githubErrorMessage } from "@/lib/api/github";
import { projectApi, type GitImportResponse } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

interface GitImportFormProps {
  /** Called with the new project when there is nothing to report; otherwise after the user reviews the summary. */
  onImported: (project: GitImportResponse) => void;
  onCancel?: () => void;
}

const inputClass = cn(
  "mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-xs",
  "border-slate-300 focus:border-primary-500 focus:ring-primary-500",
  "dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
);
const labelClass = "block text-sm font-medium text-slate-700 dark:text-slate-300";
const hintClass = "mt-1 text-xs text-slate-500 dark:text-slate-400";

/** The repository name a URL points at, used as the default project name. */
export function repoNameFromUrl(url: string): string {
  const last = url.trim().replace(/[/\\]+$/, "").split(/[/:\\]/).pop() ?? "";
  return last.replace(/\.git$/, "");
}

/**
 * Checks the URL shape before asking the server, which validates it again: https://, ssh:// or
 * git@host:owner/repo, without spaces or embedded credentials.
 */
export function gitUrlProblem(url: string): string | null {
  const u = url.trim();
  if (!u) return "Enter the repository URL.";
  if (/\s/.test(u)) return "The URL must not contain spaces.";
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9][A-Za-z0-9.-]*:[^/].*\/.+/.test(u)) return null;
  if (!/^(https|ssh):\/\//i.test(u)) {
    return "Use an https:// URL (like https://github.com/owner/repo.git) or an SSH URL (like git@github.com:owner/repo.git).";
  }
  if (/^https:\/\/[^/@]+@/i.test(u)) {
    return "Don't put a username or token in the URL. Sign in with `gh auth login` or a git credential helper instead.";
  }
  return null;
}

/** A heading for a failed import, from the HTTP status the server chose. */
function errorTitle(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "Clone timed out";
  if (!(error instanceof ApiError)) return "Import failed";
  switch (error.status) {
    case 400:
      return "Couldn't clone the repository";
    case 403:
      return "Sign-in failed or repository not found";
    case 404:
      return "Not found";
    case 409:
    case 422:
      return "Couldn't use the ontology file";
    case 502:
      return "Couldn't reach the host";
    case 504:
      return "Clone timed out";
    default:
      return "Import failed";
  }
}

/** Whether the import picked or converted anything the user should hear about before opening the project. */
export function needsReview(result: GitImportResponse): boolean {
  const s = result.git_import;
  return s.selection === "none" || s.converted || s.warnings.length > 0 || s.candidates.length > 1;
}

export function GitImportForm({ onImported, onCancel }: GitImportFormProps) {
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ontologyPath, setOntologyPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [result, setResult] = useState<GitImportResponse | null>(null);

  const defaultName = repoNameFromUrl(url);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = gitUrlProblem(url);
    if (problem) {
      setError({ title: "Invalid repository URL", detail: problem });
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const project = await projectApi.importFromGit({
        url: url.trim(),
        branch: branch.trim() || undefined,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        ontology_path: ontologyPath.trim() || undefined,
      });
      if (needsReview(project)) setResult(project);
      else onImported(project);
    } catch (err) {
      const title = err instanceof ApiError && err.status === 400 && /URL/i.test(err.message) ? "Invalid repository URL" : errorTitle(err);
      setError({
        title,
        detail:
          err instanceof Error && err.name === "AbortError"
            ? "The clone took too long. Try cloning it in a terminal instead."
            : githubErrorMessage(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (result) return <GitImportSummaryView result={result} onOpen={() => onImported(result)} />;

  return (
    <form onSubmit={handleSubmit} className="space-y-6" aria-busy={submitting}>
      <div>
        <label htmlFor="git-url" className={labelClass}>
          Repository URL <span className="text-red-500">*</span>
        </label>
        <input
          id="git-url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
          className={inputClass}
          placeholder="https://github.com/owner/repo.git"
          disabled={submitting}
          required
        />
        <p className={hintClass}>
          HTTPS or SSH (git@github.com:owner/repo.git). Private repositories use your git sign-in: <code>gh auth login</code>, a
          credential helper or an SSH key.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="git-branch" className={labelClass}>
            Branch
          </label>
          <input
            id="git-branch"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className={inputClass}
            placeholder="Default branch"
            disabled={submitting}
          />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <label htmlFor="git-ontology-path" className={labelClass}>
              Ontology file
            </label>
            <Tooltip
              content={
                "Leave empty to find it: ontology.ttl at the top of the repository first, then files declaring owl:Ontology, " +
                "Turtle before other formats. Other formats are converted to Turtle in a new commit; the original is kept."
              }
            >
              <button
                type="button"
                aria-label="How the ontology file is chosen"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
          <input
            id="git-ontology-path"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={ontologyPath}
            onChange={(e) => setOntologyPath(e.target.value)}
            className={inputClass}
            placeholder="Found automatically"
            disabled={submitting}
          />
        </div>
      </div>

      <div>
        <label htmlFor="git-name" className={labelClass}>
          Project Name
        </label>
        <input
          id="git-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder={defaultName ? `Leave empty to use “${defaultName}”` : "Leave empty to use the repository name"}
          maxLength={255}
          disabled={submitting}
        />
      </div>

      <div>
        <label htmlFor="git-description" className={labelClass}>
          Description
        </label>
        <textarea
          id="git-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={inputClass}
          placeholder="Leave empty to use the description from the ontology"
          disabled={submitting}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">{error.title}</p>
            <p className="mt-0.5 break-words">{error.detail}</p>
          </div>
        </div>
      )}

      {submitting && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-600 dark:bg-slate-700"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
          <div>
            <p className="font-medium text-slate-700 dark:text-slate-300">Cloning repository...</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Large repositories can take a few minutes. The full history is kept.
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={submitting || !url.trim()}>
          {submitting ? "Cloning..." : "Import Repository"}
        </Button>
      </div>
    </form>
  );
}

function GitImportSummaryView({ result, onOpen }: { result: GitImportResponse; onOpen: () => void }) {
  const s = result.git_import;
  const others = s.candidates.filter((c) => c.path !== s.source_path);
  return (
    <div className="space-y-5" data-testid="git-import-summary">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" />
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Repository imported</h2>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400">
            <GitBranch className="h-3.5 w-3.5" />
            {result.name}
            {s.branch ? ` · ${s.branch}` : ""}
          </p>
        </div>
      </div>

      {s.ontology_path ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-600 dark:bg-slate-700">
          <p className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
            <FileCode className="h-4 w-4" />
            Ontology: <code className="break-all">{s.ontology_path}</code>
          </p>
          {s.converted && (
            <p className="mt-2 text-slate-600 dark:text-slate-300">
              Converted from <code className="break-all">{s.source_path}</code> to Turtle and committed locally (not pushed yet).
              The original file is unchanged.
            </p>
          )}
          {!s.converted && s.selection === "automatic" && others.length > 0 && (
            <p className="mt-2 text-slate-600 dark:text-slate-300">Chosen automatically from {s.candidates.length} RDF files.</p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <p className="font-medium">No ontology file</p>
          <p className="mt-1">
            The project was created with the repository&apos;s files and history, but without an ontology. You can still use its
            code, terminals and Git features.
          </p>
        </div>
      )}

      {others.length > 0 && (
        <div className="text-sm">
          <p className="font-medium text-slate-700 dark:text-slate-300">Other RDF files in the repository</p>
          <ul className="mt-1 max-h-40 list-inside list-disc overflow-y-auto text-slate-600 dark:text-slate-400">
            {others.map((c) => (
              <li key={c.path}>
                <code className="break-all">{c.path}</code>
              </li>
            ))}
          </ul>
          <p className={hintClass}>To use one of them instead, delete this project and import again with its path as the Ontology file.</p>
        </div>
      )}

      {s.warnings.length > 0 && (
        <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
          {s.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="break-words">{w}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end pt-2">
        <Button type="button" onClick={onOpen}>
          Open Project
        </Button>
      </div>
    </div>
  );
}
