"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, FileCode, FilePlus, FileWarning, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/client";
import {
  ONTOLOGY_FORMAT_NAMES,
  TURTLE_OUT_OF_DATE,
  projectErrorMessage,
  type OntologyFile,
  type OntologyFileChange,
  type OntologyFileList,
} from "@/lib/api/projects";
import { useOntologyFileMutations, useOntologyFiles } from "@/lib/hooks/useOntologyFiles";
import { useToast } from "@/lib/context/ToastContext";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/errors";

/**
 * Choosing and creating the project's ontology file. A project edits one ontology file at a
 * time; its folder (especially a cloned repository) may hold other RDF files. Four places use
 * this: the editor's breadcrumb menu, the "No Ontology File" view, Project settings, and the
 * editor's entity tree when the ontology file isn't on the current branch.
 */

export function formatName(format: string): string {
  return ONTOLOGY_FORMAT_NAMES[format] ?? format;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function baseName(p: string): string {
  return p.split("/").pop() || p;
}

/** What choosing a file that isn't Turtle does, in a few words. */
export function conversionNote(file: OntologyFile): string | null {
  if (file.format === "turtle" || !file.turtle_path) return null;
  return file.turtle_exists ? `Uses ${file.turtle_path}` : `Converts to ${file.turtle_path}`;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "ontology"
  );
}

const IRI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/;

const INPUT_CLASSES = cn(
  "mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-xs",
  "border-slate-300 focus:border-primary-500 focus:ring-primary-500",
  "dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
);

interface NewOntologyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current ontology file; when set, the dialog warns that the new file replaces it. */
  activePath: string | null;
  /** The branch the file is committed on, when known. */
  branch?: string;
  projectName: string;
  /** The current ontology's IRI, so the suggested IRI differs from it. */
  currentIri?: string | null;
  suggestedFileName: string;
  /** Paths already in the folder (RDF files), to catch a taken name before asking the server. */
  existingPaths: string[];
  onCreate: (data: { file_name: string; ontology_iri: string; title: string }) => Promise<void>;
}

/** Name, IRI and title for a new, empty ontology file. */
export function NewOntologyDialog({
  open,
  onOpenChange,
  activePath,
  branch,
  projectName,
  currentIri,
  suggestedFileName,
  existingPaths,
  onCreate,
}: NewOntologyDialogProps) {
  const ids = useId();
  const [fileName, setFileName] = useState(suggestedFileName);
  const [title, setTitle] = useState(projectName);
  const [iri, setIri] = useState("");
  const [iriEdited, setIriEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from fresh defaults each time the dialog opens (adjusting state while rendering).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFileName(suggestedFileName);
      setTitle(projectName);
      setIri("");
      setIriEdited(false);
      setError(null);
    }
  }

  let suggestedIri = `http://example.org/ontologies/${slugify(title || projectName)}`;
  if (currentIri && suggestedIri === currentIri) suggestedIri = `${suggestedIri}-${slugify(baseName(fileName).replace(/\.ttl$/i, ""))}`;
  const effectiveIri = iriEdited ? iri : suggestedIri;

  const trimmedName = fileName.trim().replace(/^\.\//, "");
  const nameProblem = !trimmedName
    ? "Enter a file name."
    : !trimmedName.toLowerCase().endsWith(".ttl") || trimmedName.endsWith("/.ttl") || trimmedName === ".ttl"
      ? "The file name must end in .ttl: OntoBuilder writes Turtle."
      : trimmedName.startsWith("/") || trimmedName.includes("\\") || trimmedName.split("/").some((s) => s === ".." || s === "." || s === "")
        ? "Use a path inside the project folder, like ontology.ttl or src/new.ttl."
        : existingPaths.includes(trimmedName)
          ? `${trimmedName} already exists. Choose another name.`
          : null;
  const iriProblem = !effectiveIri.trim()
    ? "Enter the ontology IRI."
    : !IRI_PATTERN.test(effectiveIri.trim())
      ? "Use an absolute IRI without spaces, like http://example.org/ontologies/pizza."
      : null;
  const titleProblem = title.trim() ? null : "Enter a title.";
  const invalid = !!(nameProblem || iriProblem || titleProblem);

  const submit = async () => {
    if (invalid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ file_name: trimmedName, ontology_iri: effectiveIri.trim(), title: title.trim() });
      onOpenChange(false);
    } catch (e) {
      setError(projectErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg" data-testid="new-ontology-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus className="h-5 w-5 text-slate-500" />
            New ontology
          </DialogTitle>
          <DialogDescription>
            Creates an empty Turtle file with an ontology declaration, commits it
            {branch ? ` on branch ${branch}` : ""} and makes it the project&apos;s ontology.
          </DialogDescription>
        </DialogHeader>

        {activePath && (
          <div
            role="alert"
            data-testid="new-ontology-replace-warning"
            className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              This project already has an ontology: <code className="break-all">{activePath}</code>. A project uses one
              ontology at a time, so the new file becomes the active ontology in its place. {baseName(activePath)} stays in
              the project folder unchanged, and you can switch back to it at any time from the ontology menu next to the
              project name or in Project settings.
            </p>
          </div>
        )}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label htmlFor={`${ids}-file`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              File name
            </label>
            <input
              id={`${ids}-file`}
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className={cn(INPUT_CLASSES, "font-mono")}
              aria-invalid={!!nameProblem}
              aria-describedby={`${ids}-file-help`}
              disabled={submitting}
              spellCheck={false}
            />
            <p id={`${ids}-file-help`} className={cn("mt-1 text-xs", nameProblem ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400")}>
              {nameProblem ?? "A path in the project folder, ending in .ttl."}
            </p>
          </div>
          <div>
            <label htmlFor={`${ids}-title`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Title
            </label>
            <input
              id={`${ids}-title`}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={INPUT_CLASSES}
              maxLength={255}
              aria-invalid={!!titleProblem}
              disabled={submitting}
            />
            {titleProblem && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{titleProblem}</p>}
          </div>
          <div>
            <label htmlFor={`${ids}-iri`} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Ontology IRI
            </label>
            <input
              id={`${ids}-iri`}
              type="text"
              value={effectiveIri}
              onChange={(e) => {
                setIri(e.target.value);
                setIriEdited(true);
              }}
              className={cn(INPUT_CLASSES, "font-mono")}
              aria-invalid={!!iriProblem}
              disabled={submitting}
              spellCheck={false}
            />
            <p className={cn("mt-1 text-xs", iriProblem ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400")}>
              {iriProblem ?? "Identifies the ontology. Other ontologies import it by this IRI."}
            </p>
          </div>

          {error && (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={invalid || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : activePath ? (
                "Create and switch"
              ) : (
                "Create ontology"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A switch the server refused because the existing .ttl is out of date. */
interface OutOfDateTurtle {
  file: OntologyFile;
  turtlePath: string;
  /** The server's explanation, e.g. "src/wine.owl has changed since it was converted…". */
  reason: string;
}

/**
 * The confirm step for a file whose existing .ttl is out of date: use that .ttl as it is, or
 * convert the file again (overwriting the .ttl in a new commit).
 */
export function OutOfDateTurtleDialog({
  choice,
  branch,
  onClose,
  onChoose,
}: {
  choice: OutOfDateTurtle | null;
  branch?: string;
  onClose: () => void;
  onChoose: (reconvert: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"use" | "convert" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fresh state each time the dialog opens (adjusting state while rendering).
  const [shown, setShown] = useState(choice);
  if (choice !== shown) {
    setShown(choice);
    setBusy(null);
    setError(null);
  }
  const run = async (reconvert: boolean) => {
    setBusy(reconvert ? "convert" : "use");
    setError(null);
    try {
      await onChoose(reconvert);
      onClose();
    } catch (e) {
      setError(projectErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const name = choice ? baseName(choice.turtlePath) : "";
  return (
    <Dialog open={!!choice} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="out-of-date-turtle-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {name} may be out of date
          </DialogTitle>
          <DialogDescription>
            {choice
              ? `${choice.reason}. OntoBuilder edits ${choice.turtlePath} when you choose ${baseName(choice.file.path)}, which itself is never changed.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch sm:space-x-0">
          <Button variant="outline" disabled={!!busy} onClick={() => void run(false)}>
            {busy === "use" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Use the existing file
          </Button>
          <Button disabled={!!busy} onClick={() => void run(true)}>
            {busy === "convert" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Convert again (overwrites {name} with a new commit{branch ? ` on ${branch}` : ""})
          </Button>
          <Button variant="ghost" disabled={!!busy} onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ControllerOptions {
  projectId: string;
  branch?: string;
  projectName: string;
  currentIri?: string | null;
  enabled?: boolean;
  onChanged?: (change: OntologyFileChange) => void;
}

/**
 * The shared logic of the three places: the file list, choosing a file (with a confirmation
 * when it has to be converted to Turtle, since that commits a new file), and the New ontology
 * dialog. Render `dialogs` once.
 */
function useOntologyFileController({ projectId, branch, projectName, currentIri, enabled = true, onChanged }: ControllerOptions) {
  const toast = useToast();
  const query = useOntologyFiles(projectId, branch, { enabled });
  const list = query.data;
  const announce = (change: OntologyFileChange, created: boolean) => {
    const details = [
      change.converted
        ? `${change.source_path} was converted to Turtle and committed as ${change.path} on branch ${change.branch} (not pushed)` +
          `${change.replaced ? `, replacing the earlier ${baseName(change.path)}` : ""}. ${change.source_path} is unchanged.`
        : null,
      created ? `Committed on branch ${change.branch} (not pushed).` : null,
      change.previous_path && change.previous_path !== change.path
        ? `${change.previous_path} is unchanged; you can switch back to it at any time.`
        : null,
      ...change.warnings,
    ].filter(Boolean);
    toast.success(
      created ? `Created ${change.path}` : `The project now edits ${change.path}`,
      details.join(" ") || undefined,
    );
    onChanged?.(change);
  };
  const { switchFile, createFile } = useOntologyFileMutations(projectId, branch);
  const [pendingConversion, setPendingConversion] = useState<OntologyFile | null>(null);
  const [outOfDate, setOutOfDate] = useState<OutOfDateTurtle | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const doSwitch = async (file: OntologyFile, reconvert?: boolean) => {
    const change = await switchFile.mutateAsync({ path: file.path, reconvert });
    announce(change, false);
  };

  const choose = (file: OntologyFile) => {
    if (file.active || switchFile.isPending) return;
    if (file.format !== "turtle" && !file.turtle_exists) {
      setPendingConversion(file);
      return;
    }
    doSwitch(file).catch((e) => {
      // The .ttl next to it is out of date: let the user choose (see OutOfDateTurtleDialog).
      if (e instanceof ApiError && e.code === TURTLE_OUT_OF_DATE) {
        const body = e.body ?? {};
        setOutOfDate({
          file,
          turtlePath: typeof body.turtle_path === "string" ? body.turtle_path : (file.turtle_path ?? ""),
          reason: typeof body.reason === "string" ? body.reason : e.detail,
        });
        return;
      }
      toast.error(`Couldn't switch to ${file.path}`, apiErrorMessage(e));
    });
  };

  const dialogs = (
    <>
      <ConfirmDialog
        open={!!pendingConversion}
        onOpenChange={(open) => !open && setPendingConversion(null)}
        onConfirm={async () => {
          if (pendingConversion) await doSwitch(pendingConversion);
        }}
        title={`Convert ${pendingConversion ? baseName(pendingConversion.path) : ""} to Turtle?`}
        description={
          pendingConversion
            ? `OntoBuilder edits Turtle only. ${pendingConversion.path} is ${formatName(pendingConversion.format)}, so it will be converted ` +
              `and saved as ${pendingConversion.turtle_path}, committed on branch ${list?.branch ?? branch ?? "the default branch"} (not pushed). ` +
              `That Turtle file becomes the project's ontology; ${baseName(pendingConversion.path)} itself is not changed.`
            : ""
        }
        confirmLabel="Convert and switch"
      />
      <OutOfDateTurtleDialog
        choice={outOfDate}
        branch={list?.branch ?? branch}
        onClose={() => setOutOfDate(null)}
        onChoose={(reconvert) => doSwitch(outOfDate!.file, reconvert)}
      />
      <NewOntologyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        activePath={list?.active_path ?? null}
        branch={list?.branch ?? branch}
        projectName={projectName}
        currentIri={currentIri}
        suggestedFileName={list?.suggested_file_name ?? "ontology.ttl"}
        existingPaths={list?.files.map((f) => f.path) ?? []}
        onCreate={async (data) => {
          const change = await createFile.mutateAsync(data);
          announce(change, true);
        }}
      />
    </>
  );

  return {
    query,
    list,
    choose,
    switching: switchFile.isPending ? (switchFile.variables?.path ?? null) : null,
    openCreate: () => setCreateOpen(true),
    dialogs,
  };
}

function FileRowText({ file }: { file: OntologyFile }) {
  const note = conversionNote(file);
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-mono text-xs text-slate-800 dark:text-slate-100">{file.path}</span>
      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
        {formatName(file.format)} · {formatSize(file.size_bytes)}
        {note && <> · {note}</>}
      </span>
    </span>
  );
}

function MissingOnBranch({ list }: { list: OntologyFileList }) {
  if (!list.active_path || list.active_exists) return null;
  return (
    <p
      data-testid="ontology-file-missing"
      className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span>
        <code className="break-all">{list.active_path}</code> isn&apos;t on branch {list.branch}. The ontology file is one
        setting for the whole project: switch to a branch that has it, or choose a file that is on this branch.
      </span>
    </p>
  );
}

const CONVERSION_HELP =
  "OntoBuilder edits Turtle. Choosing a file in another format (RDF/XML, JSON-LD, …) converts it to a .ttl file next to it, committed on this branch; the original isn't changed. If that .ttl exists already, it is used when it is up to date; if it isn't, you choose whether to use it or convert again.";

interface OntologyFileMenuProps extends ControllerOptions {
  /** The project's ontology file, shown on the button. */
  activePath: string | null | undefined;
}

/** Breadcrumb: `file.ttl ▾`, a menu of the RDF files in the folder plus "New ontology…". */
export function OntologyFileMenu({ activePath, ...options }: OntologyFileMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const controller = useOntologyFileController(options);
  const { list, query } = controller;
  const missing = !!list && !!list.active_path && !list.active_exists;

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = activePath ? baseName(activePath) : "No ontology file";
  const tooltip = activePath
    ? `Ontology file: ${activePath}${missing ? ` (not on branch ${list?.branch})` : ""}. The project edits one ontology file at a time; click to switch to another RDF file in the project folder or create a new ontology.`
    : "No ontology file: click to choose an RDF file in the project folder or create a new ontology.";

  return (
    <div ref={ref} className="relative flex min-w-0 items-center">
      <Tooltip side="bottom" disabled={open} content={tooltip}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={`Ontology file: ${activePath ?? "none"}`}
          aria-expanded={open}
          aria-haspopup="menu"
          data-testid="ontology-file-button"
          className={cn(
            "inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-700",
            missing ? "text-amber-700 dark:text-amber-400" : "text-slate-600 dark:text-slate-300",
          )}
        >
          {missing ? (
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" aria-label="missing on this branch" />
          ) : (
            <FileCode className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          )}
          <span className="min-w-0 truncate font-mono text-xs">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
        </button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          aria-label="Ontology file"
          data-testid="ontology-file-menu"
          className="absolute left-0 top-full z-50 mt-1 w-[24rem] max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="space-y-1 px-3 pb-2 pt-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ontology file</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              The project edits one ontology at a time. Choose which RDF file in the project folder it is
              {list ? ` (files on branch ${list.branch})` : ""}.
            </p>
            {list && <MissingOnBranch list={list} />}
          </div>
          <div className="max-h-72 overflow-y-auto border-t border-slate-200 dark:border-slate-700">
            {query.isLoading ? (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for RDF files…
              </p>
            ) : query.error ? (
              <p className="px-3 py-2 text-xs text-red-600 dark:text-red-400">{projectErrorMessage(query.error)}</p>
            ) : !list?.files.length ? (
              <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">No RDF files in the project folder.</p>
            ) : (
              list.files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  role="menuitemradio"
                  aria-checked={file.active}
                  disabled={!!controller.switching}
                  onClick={() => {
                    controller.choose(file);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-100 disabled:opacity-60 dark:hover:bg-slate-700",
                    file.active && "bg-primary-50 dark:bg-primary-900/20",
                  )}
                >
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {controller.switching === file.path ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : file.active ? (
                      <Check className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-label="active" />
                    ) : null}
                  </span>
                  <FileRowText file={file} />
                </button>
              ))
            )}
          </div>
          {list?.files.some((f) => f.format !== "turtle") && (
            <p className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {CONVERSION_HELP}
            </p>
          )}
          <div className="border-t border-slate-200 pt-1 dark:border-slate-700">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                controller.openCreate();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <FilePlus className="h-4 w-4 flex-shrink-0" />
              New ontology…
            </button>
          </div>
        </div>
      )}
      {controller.dialogs}
    </div>
  );
}

interface OntologyFilePanelProps extends ControllerOptions {
  /** Shown above the list, e.g. an explanation for the "No Ontology File" view. */
  intro?: ReactNode;
  className?: string;
}

/**
 * The files as a list with "Use" buttons, and a New ontology button: the "No Ontology File" view
 * and the Ontology file section of Project settings.
 */
export function OntologyFilePanel({ intro, className, ...options }: OntologyFilePanelProps) {
  const controller = useOntologyFileController(options);
  const { list, query } = controller;
  const others = list?.files ?? [];
  return (
    <div className={cn("space-y-3", className)} data-testid="ontology-file-panel">
      {intro}
      {list && <MissingOnBranch list={list} />}
      {query.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Looking for RDF files in the project folder…
        </p>
      ) : query.error ? (
        <div className="flex items-center gap-3 text-sm text-red-600 dark:text-red-400">
          <span>{projectErrorMessage(query.error)}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : others.length ? (
        <ul
          aria-label={`RDF files in the project folder${list ? ` on branch ${list.branch}` : ""}`}
          className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700"
        >
          {others.map((file) => (
            <li key={file.path} className="flex items-center gap-3 px-3 py-2">
              <FileCode className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden />
              <FileRowText file={file} />
              {file.active ? (
                <span className="flex items-center gap-1 rounded-sm bg-primary-50 px-1.5 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                  <Check className="h-3.5 w-3.5" /> Active
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!controller.switching}
                  onClick={() => controller.choose(file)}
                  aria-label={`Use ${file.path}`}
                >
                  {controller.switching === file.path ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Use"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No RDF files (.ttl, .owl, .rdf, .jsonld, …) are committed in the project folder{list ? ` on branch ${list.branch}` : ""}.
        </p>
      )}
      {others.some((f) => f.format !== "turtle") && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{CONVERSION_HELP}</p>
      )}
      <div>
        <Button variant={others.length ? "outline" : "primary"} onClick={controller.openCreate}>
          <FilePlus className="mr-2 h-4 w-4" />
          New ontology…
        </Button>
      </div>
      {controller.dialogs}
    </div>
  );
}

interface OntologyLoadErrorProps extends ControllerOptions {
  /** The error text of the failed request (an API error's `detail`, not its raw body). */
  message: string;
}

/**
 * What the entity tree shows when the ontology can't be loaded. When the reason is that the
 * project's ontology file isn't on this branch, a tidy explanation with the ways out: choose
 * another file (the list of RDF files on the branch), create a new ontology, or switch branch.
 * Any other error is shown as its message.
 */
export function OntologyLoadError({ message, ...options }: OntologyLoadErrorProps) {
  const controller = useOntologyFileController(options);
  const { list, query } = controller;
  const [listOpen, setListOpen] = useState(false);
  const missing = !!list && !!list.active_path && !list.active_exists;

  if (!missing) {
    return (
      <div className="p-4">
        <div
          role="alert"
          data-testid="ontology-load-error"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-center dark:border-red-900/50 dark:bg-red-900/20"
        >
          <p className="break-words text-sm text-red-700 dark:text-red-400">{message}</p>
        </div>
        {controller.dialogs}
      </div>
    );
  }

  const activePath = list.active_path!;
  const others = list.files;
  return (
    <div className="p-3" data-testid="ontology-file-missing-notice">
      <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
        <p className="flex items-start gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
          <FileWarning className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          <span className="min-w-0">
            <code className="break-all">{baseName(activePath)}</code> isn&apos;t on branch{" "}
            <span className="break-all">{list.branch}</span>
          </span>
        </p>
        <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
          The project&apos;s ontology file, <code className="break-all">{activePath}</code>, doesn&apos;t exist on this branch, so
          there is nothing to show here. The ontology file is one setting for the whole project.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
            <FileCode className="mr-1.5 h-3.5 w-3.5" />
            Choose another file
          </Button>
          <Button size="sm" variant="outline" onClick={controller.openCreate}>
            <FilePlus className="mr-1.5 h-3.5 w-3.5" />
            New ontology…
          </Button>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          <GitBranch className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span>Or switch to a branch that has {baseName(activePath)} from the Repository menu.</span>
        </p>
      </div>
      {listOpen && (
        <div className="mt-2">
          {query.isFetching && !others.length ? (
            <p className="flex items-center gap-2 px-1 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for RDF files…
            </p>
          ) : others.length ? (
            <ul
              aria-label={`RDF files on branch ${list.branch}`}
              className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700"
            >
              {others.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    disabled={!!controller.switching}
                    onClick={() => controller.choose(file)}
                    aria-label={`Use ${file.path}`}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-100 disabled:opacity-60 dark:hover:bg-slate-700"
                  >
                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                      {controller.switching === file.path ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileCode className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      )}
                    </span>
                    <FileRowText file={file} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
              No RDF files are committed on branch {list.branch}. Create a new ontology, or switch branch.
            </p>
          )}
        </div>
      )}
      {controller.dialogs}
    </div>
  );
}
