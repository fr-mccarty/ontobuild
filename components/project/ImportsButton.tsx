"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FolderGit2, Globe, Layers, Link2, RefreshCw, Repeat, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { importErrorMessage, type ImportCandidate, type ImportStatus } from "@/lib/api/imports";
import { useImportCandidates, useImportMutations, useImports } from "@/lib/hooks/useImports";
import { cn } from "@/lib/utils";

interface ImportsButtonProps {
  projectId: string;
  branch?: string;
  /** Called after imports change the ontology (the editor can reload its source). */
  onChanged?: () => void;
}

/** Sub-heading (left): the ontology's owl:imports, with a dialog to add, remove and refresh them. */
export function ImportsButton({ projectId, branch, onChanged }: ImportsButtonProps) {
  const [open, setOpen] = useState(false);
  const { data } = useImports(projectId, branch);
  const count = data?.direct.length ?? 0;
  const problems = data?.closure.filter((e) => e.status !== "ok").length ?? 0;

  const tooltip =
    count === 0
      ? "Imports: no other ontologies are imported. Click to import one."
      : `Imports: ${count} ontolog${count === 1 ? "y is" : "ies are"} imported directly` +
        (data && data.closure.length > count ? `, ${data.closure.length} in total including their imports` : "") +
        (problems ? `. ${problems} could not be resolved.` : ".");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip side="bottom" content={tooltip}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label={`Imports (${count})`}
          >
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">Imports</span>
            {count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs font-medium leading-5",
                  problems
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
                )}
                data-testid="imports-count"
              >
                {count}
              </span>
            )}
          </button>
        </DialogTrigger>
      </Tooltip>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {open && <ImportsDialogBody projectId={projectId} branch={branch} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  );
}

function ImportsDialogBody({ projectId, branch, onChanged }: ImportsButtonProps) {
  const { data, isLoading, error } = useImports(projectId, branch);
  const { add, remove, refresh } = useImportMutations(projectId, branch, onChanged);
  const [actionError, setActionError] = useState<string | null>(null);

  const direct = useMemo(() => {
    if (!data) return [];
    return data.direct.map(
      (iri) =>
        data.closure.find((e) => e.iri === iri && e.direct) ??
        data.closure.find((e) => e.iri === iri) ?? {
          iri,
          source: "remote" as const,
          status: "error" as const,
          error: "Not resolved",
          class_count: 0,
          direct: true,
          imported_by: [],
          label: null,
        },
    );
  }, [data]);
  const indirect = data?.closure.filter((e) => !data.direct.includes(e.iri)) ?? [];
  const directIris = new Set(data?.direct ?? []);
  const hasRemote = data?.closure.some((e) => e.source === "remote") ?? false;
  const busy = add.isPending || remove.isPending || refresh.isPending;

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setActionError(importErrorMessage(err));
      return false;
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          Imports
        </DialogTitle>
        <DialogDescription>
          Ontologies this one imports (<code>owl:imports</code>), including what they import in turn. Their classes
          appear read-only in the class tree, and local classes can use them as parents.
        </DialogDescription>
      </DialogHeader>

      <section aria-labelledby="imports-direct-heading" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id="imports-direct-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Direct imports
          </h3>
          <Tooltip content="Fetch every remote import again and update the cached copies">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void run(() => refresh.mutateAsync())}
              disabled={busy || !hasRemote}
              aria-label="Refresh imports"
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", refresh.isPending && "animate-spin")} />
              Refresh
            </Button>
          </Tooltip>
        </div>
        {isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading imports...</p>
        ) : error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {importErrorMessage(error)}
          </p>
        ) : direct.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">This ontology does not import any other ontology yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {direct.map((entry) => (
              <ImportRow
                key={entry.iri}
                entry={entry}
                onRemove={() => void run(() => remove.mutateAsync(entry.iri))}
                disabled={busy}
              />
            ))}
          </ul>
        )}
      </section>

      {indirect.length > 0 && (
        <section aria-labelledby="imports-indirect-heading" className="space-y-2">
          <h3 id="imports-indirect-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Imported through other imports
          </h3>
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {indirect.map((entry) => (
              <ImportRow key={entry.iri} entry={entry} />
            ))}
          </ul>
        </section>
      )}

      <AddImport
        existing={directIris}
        busy={busy}
        onAdd={(iri) => run(() => add.mutateAsync(iri))}
      />

      {actionError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {actionError}
        </p>
      )}
    </>
  );
}

function StatusBadge({ entry }: { entry: ImportStatus }) {
  if (entry.status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {entry.class_count} class{entry.class_count === 1 ? "" : "es"}
      </span>
    );
  }
  if (entry.status === "cycle") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <Repeat className="h-3.5 w-3.5" />
        Cycle
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
      <AlertTriangle className="h-3.5 w-3.5" />
      Error
    </span>
  );
}

function ImportRow({ entry, onRemove, disabled }: { entry: ImportStatus; onRemove?: () => void; disabled?: boolean }) {
  const title = entry.project_name ?? entry.label ?? entry.iri;
  return (
    <li className="flex items-start gap-3 px-3 py-2" data-testid="import-row" data-iri={entry.iri}>
      <span className="mt-0.5 text-slate-400">
        {entry.source === "project" ? (
          <Tooltip content="An OntoKit project (read from its default branch)">
            <FolderGit2 className="h-4 w-4" aria-label="OntoKit project" />
          </Tooltip>
        ) : (
          <Tooltip content="Fetched from the web and cached">
            <Globe className="h-4 w-4" aria-label="Remote ontology" />
          </Tooltip>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{title}</span>
          <StatusBadge entry={entry} />
        </div>
        {title !== entry.iri && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{entry.iri}</p>}
        {!entry.direct && entry.imported_by.length > 0 && (
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">Imported by {entry.imported_by.join(", ")}</p>
        )}
        {entry.error && entry.status !== "ok" && (
          <p className="text-xs text-red-600 dark:text-red-400">{entry.error}</p>
        )}
      </div>
      {onRemove && (
        <Tooltip content="Remove this import">
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove import ${entry.iri}`}
            className="rounded-sm p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-slate-700"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
    </li>
  );
}

function AddImport({
  existing,
  busy,
  onAdd,
}: {
  existing: Set<string>;
  busy: boolean;
  onAdd: (iri: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"search" | "iri">("search");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [iri, setIri] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const candidates = useImportCandidates(debounced, mode === "search");
  const results = (candidates.data ?? []).filter((c: ImportCandidate) => !existing.has(c.ontology_iri));

  const submitIri = async () => {
    const value = iri.trim();
    if (!value) return;
    if (await onAdd(value)) setIri("");
  };

  const tabClass = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm",
      active
        ? "bg-slate-200 font-medium text-slate-900 dark:bg-slate-700 dark:text-slate-100"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
    );

  return (
    <section aria-labelledby="imports-add-heading" className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="imports-add-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Add import
        </h3>
        <div role="tablist" aria-label="How to add an import" className="flex gap-1">
          <button type="button" role="tab" aria-selected={mode === "search"} className={tabClass(mode === "search")} onClick={() => setMode("search")}>
            <Search className="h-3.5 w-3.5" />
            Search projects
          </button>
          <button type="button" role="tab" aria-selected={mode === "iri"} className={tabClass(mode === "iri")} onClick={() => setMode("iri")}>
            <Link2 className="h-3.5 w-3.5" />
            Paste IRI
          </button>
        </div>
      </div>

      {mode === "search" ? (
        <div className="space-y-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search OntoKit projects by name or ontology IRI"
            aria-label="Search OntoKit projects"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          <ul className="max-h-56 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700" aria-label="Projects to import">
            {candidates.isLoading ? (
              <li className="px-3 py-2 text-sm text-slate-500">Searching...</li>
            ) : results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                {debounced ? "No matching projects." : "No other projects with an ontology IRI."}
              </li>
            ) : (
              results.map((c) => (
                <li key={c.project_id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onAdd(c.ontology_iri)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
                    aria-label={`Import ${c.name}`}
                  >
                    <FolderGit2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{c.name}</span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{c.ontology_iri}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submitIri();
          }}
        >
          <input
            type="text"
            value={iri}
            onChange={(e) => setIri(e.target.value)}
            placeholder="https://example.org/ontology"
            aria-label="Ontology IRI"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
          <Button type="submit" size="sm" disabled={busy || !iri.trim()}>
            Add
          </Button>
        </form>
      )}
      {mode === "iri" && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The IRI of another OntoKit project&apos;s ontology links that project; any other http(s) IRI is fetched and cached.
        </p>
      )}
    </section>
  );
}
