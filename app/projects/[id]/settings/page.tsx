"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Trash2, Tag, Check, GitPullRequest, AlertCircle, FileCode, FileText, RefreshCw, History, Play, CheckCircle, XCircle, Database, Shield, Layers } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { ProjectForm } from "@/components/projects/project-form";
import { LabelPreferences, normalizeLabelPreferences } from "@/components/projects/label-preferences";
import { ApiError, projectOntologyApi, type IndexStatusResponse, type IndexStatus } from "@/lib/api/client";
import { IndexStatusPoller, type IndexStatusEvent } from "@/lib/api/indexStatus";
import {
  projectApi,
  type Project,
  type ProjectUpdate,
} from "@/lib/api/projects";
import {
  prSettingsApi,
  type PRSettings,
} from "@/lib/api/pullRequests";
import {
  normalizationApi,
  type NormalizationStatusResponse,
  type NormalizationRunResponse,
} from "@/lib/api/normalization";
import { useProject, projectQueryKeys } from "@/lib/hooks/useProject";
import { useProjectHomeHref } from "@/lib/hooks/useProjectHomeHref";
import { useNormalizationStatus, normalizationQueryKeys } from "@/lib/hooks/useNormalizationStatus";
import { useIndexStatus, indexQueryKeys } from "@/lib/hooks/useIndexStatus";
import { cn, formatDate } from "@/lib/utils";
import dynamic from "next/dynamic";
import {
  lintApi,
  type LintConfig,
  type LintLevel,
  type LintSummary,
} from "@/lib/api/lint";
import { Tooltip } from "@/components/ui/tooltip";
import { ImportsManager } from "@/components/project/ImportsManager";
import { SettingsToc, type SettingsTocItem } from "@/components/projects/settings-toc";
import { GitHubMark, GitHubPanel } from "@/components/project/GitHub";
import { OntologyFilePanel } from "@/components/project/OntologyFile";

const NormalizationDiffViewer = dynamic(
  () => import("@/components/editor/NormalizationDiffViewer").then((mod) => mod.NormalizationDiffViewer),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="rounded-lg bg-white p-8 dark:bg-slate-800">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        </div>
      </div>
    ),
  }
);

export default function ProjectSettingsPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;
  // The editor passes its branch, so imports are edited on the branch the user was working on.
  const branch = useSearchParams().get("branch") || undefined;

  const selectionHref = useProjectHomeHref(projectId);
  const projectHomeHref = branch
    ? `${selectionHref}${selectionHref.includes("?") ? "&" : "?"}branch=${encodeURIComponent(branch)}`
    : selectionHref;

  const queryClient = useQueryClient();

  const {
    project,
    isLoading,
    error: projectError,
  } = useProject(projectId);

  const projectKey = projectQueryKeys.detail(projectId);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const error = localError || projectError || null;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const [labelPreferences, setLabelPreferences] = useState<string[]>([]);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);

  const {
    data: normalizationQueryData,
  } = useNormalizationStatus(projectId, {
    enabled: !!project?.source_file_path,
  });
  const [normalizationStatus, setNormalizationStatus] = useState<NormalizationStatusResponse | null>(null);
  useEffect(() => {
    if (normalizationQueryData) setNormalizationStatus(normalizationQueryData);
  }, [normalizationQueryData]);

  const [normalizationHistory, setNormalizationHistory] = useState<NormalizationRunResponse[]>([]);
  const [isCheckingNormalization, setIsCheckingNormalization] = useState(false);
  const [isRunningNormalization, setIsRunningNormalization] = useState(false);
  const [showNormalizationHistory, setShowNormalizationHistory] = useState(false);
  const [showPreviewHighlight, setShowPreviewHighlight] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [diffContent, setDiffContent] = useState<{
    original: string;
    normalized: string;
  } | null>(null);
  const [normalizationJobId, setNormalizationJobId] = useState<string | null>(null);
  const [normalizationJobStatus, setNormalizationJobStatus] = useState<string | null>(null);
  const normalizationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    data: indexQueryData,
  } = useIndexStatus(projectId, {
    enabled: !!project?.source_file_path,
  });
  const [indexStatus, setIndexStatus] = useState<IndexStatusResponse | null>(null);
  useEffect(() => {
    if (indexQueryData) setIndexStatus(indexQueryData);
  }, [indexQueryData]);

  const [isReindexing, setIsReindexing] = useState(false);

  useEffect(() => {
    if (!project?.id) return;

    const manager = new IndexStatusPoller(
      project.id,
      (message: IndexStatusEvent) => {
        if (message.type === "index_started") {
          setIsReindexing(true);
          setIndexStatus((prev) =>
            prev ? { ...prev, status: "indexing" as IndexStatus } : prev
          );
        } else if (message.type === "index_complete" || message.type === "index_failed") {
          setIsReindexing(false);
          queryClient.invalidateQueries({ queryKey: indexQueryKeys.status(projectId) });
        }
      },
    );

    const timeoutId = setTimeout(() => manager.connect(), 100);

    return () => {
      clearTimeout(timeoutId);
      manager.disconnect();
    };
  }, [project?.id, projectId, queryClient]);

  useEffect(() => {
    return () => {
      if (normalizationPollRef.current) {
        clearInterval(normalizationPollRef.current);
      }
    };
  }, []);

  const [, setPrSettings] = useState<PRSettings | null>(null);
  const [prApprovalRequired, setPrApprovalRequired] = useState(0);
  const [isSavingPrSettings, setIsSavingPrSettings] = useState(false);


  useEffect(() => {
    if (project) {
      setLabelPreferences(normalizeLabelPreferences(project.label_preferences || []));
    }
  }, [project]);

  const prSettingsQuery = useQuery({
    queryKey: ["prSettings", projectId],
    queryFn: () => prSettingsApi.get(projectId),
    retry: false,
  });
  useEffect(() => {
    if (prSettingsQuery.data) {
      setPrSettings(prSettingsQuery.data);
      setPrApprovalRequired(prSettingsQuery.data.pr_approval_required);
    }
  }, [prSettingsQuery.data]);

  useEffect(() => {
    if (!isLoading && typeof window !== "undefined" && window.location.hash) {
      const hash = window.location.hash.substring(1);
      const element = document.getElementById(hash);
      if (element) {
        setTimeout(() => {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      }
    }
  }, [isLoading]);

  const handleUpdateProject = async (data: { name: string; description?: string; is_public: boolean }) => {
    if (!project) return;

    setIsSaving(true);
    setLocalError(null);
    setSuccessMessage(null);

    try {
      // The form sends undefined for an empty description; send null so clearing it sticks.
      const payload: ProjectUpdate = { ...data, description: data.description ?? null };
      const updated = await projectApi.update(project.id, payload);
      queryClient.setQueryData<Project>(projectKey, updated);
      setSuccessMessage("Project settings saved successfully");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!project || deleteConfirmText !== project.name)
      return;

    setIsDeleting(true);

    try {
      await projectApi.delete(project.id);
      router.push("/");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to delete project");
      setIsDeleting(false);
    }
  };

  const handleSaveLabelPreferences = async () => {
    if (!project) return;

    setIsSavingPreferences(true);
    setPreferencesSaved(false);
    setLocalError(null);

    try {
      const updated = await projectApi.update(
        project.id,
        { label_preferences: normalizeLabelPreferences(labelPreferences) }
      );
      queryClient.setQueryData<Project>(projectKey, updated);
      setPreferencesSaved(true);
      setTimeout(() => setPreferencesSaved(false), 3000);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to save label preferences");
    } finally {
      setIsSavingPreferences(false);
    }
  };

  const handleSavePrSettings = async () => {
    if (!project) return;

    setIsSavingPrSettings(true);
    setLocalError(null);

    try {
      const updated = await prSettingsApi.update(
        project.id,
        { pr_approval_required: prApprovalRequired }
      );
      setPrSettings(updated);
      setSuccessMessage("PR settings saved");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to save PR settings");
    } finally {
      setIsSavingPrSettings(false);
    }
  };

  const handleReindex = async () => {
    if (!project) return;

    setIsReindexing(true);
    setLocalError(null);

    try {
      await projectOntologyApi.reindex(project.id);
      setIndexStatus((prev) =>
        prev ? { ...prev, status: "indexing" as IndexStatus } : prev
      );
      setSuccessMessage("Reindex job queued. The index will update in the background.");
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to trigger reindex");
      setIsReindexing(false);
    }
  };

  const handleCheckNormalization = async () => {
    if (!project) return;

    setIsCheckingNormalization(true);
    setLocalError(null);

    try {
      const status = await normalizationApi.getStatus(project.id);
      setNormalizationStatus(status);
      queryClient.invalidateQueries({ queryKey: normalizationQueryKeys.status(projectId) });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to check normalization status");
    } finally {
      setIsCheckingNormalization(false);
    }
  };

  const handleRunNormalization = async (dryRun: boolean = false) => {
    if (!project) return;

    setIsRunningNormalization(true);
    setLocalError(null);

    try {
      if (dryRun) {
        const result = await normalizationApi.runNormalization(
          project.id,
          true
        );

        setNormalizationStatus({
          needs_normalization: true,
          last_run: normalizationStatus?.last_run || null,
          last_run_id: normalizationStatus?.last_run_id || null,
          last_check: new Date().toISOString(),
          preview_report: result.report,
          error: null,
        });

        if (result.original_content && result.normalized_content) {
          setDiffContent({
            original: result.original_content,
            normalized: result.normalized_content,
          });
          setShowDiffViewer(true);
        } else {
          setShowPreviewHighlight(true);
          setTimeout(() => {
            previewRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 100);
          setTimeout(() => setShowPreviewHighlight(false), 2000);
        }
        setIsRunningNormalization(false);
      } else {
        const queueResult = await normalizationApi.queueNormalization(
          project.id,
          false
        );

        setNormalizationJobId(queueResult.job_id);
        setNormalizationJobStatus("queued");
        setSuccessMessage("Normalization job queued - processing in background...");

        normalizationPollRef.current = setInterval(async () => {
          try {
            const jobStatus = await normalizationApi.getJobStatus(
              project.id,
              queueResult.job_id
            );

            setNormalizationJobStatus(jobStatus.status);

            if (jobStatus.status === "completed") {
              clearInterval(normalizationPollRef.current!);
              normalizationPollRef.current = null;
              setNormalizationJobId(null);
              setNormalizationJobStatus(null);
              setIsRunningNormalization(false);

              const newStatus = await normalizationApi.getStatus(project.id);
              setNormalizationStatus(newStatus);
              queryClient.invalidateQueries({ queryKey: normalizationQueryKeys.status(projectId) });
              setSuccessMessage("Normalization completed successfully");
              setTimeout(() => setSuccessMessage(null), 3000);
            } else if (jobStatus.status === "failed") {
              clearInterval(normalizationPollRef.current!);
              normalizationPollRef.current = null;
              setNormalizationJobId(null);
              setNormalizationJobStatus(null);
              setIsRunningNormalization(false);
              setLocalError(jobStatus.error || "Normalization job failed");
            }
          } catch (pollErr) {
            if (pollErr instanceof ApiError && pollErr.status === 404) {
              clearInterval(normalizationPollRef.current!);
              normalizationPollRef.current = null;
              setNormalizationJobId(null);
              setNormalizationJobStatus(null);
              setIsRunningNormalization(false);
              setLocalError("Normalization job not found or expired");
              return;
            }
            console.error("Error polling job status:", pollErr);
          }
        }, 2000);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to run normalization");
      setIsRunningNormalization(false);
    }
  };

  const handleLoadNormalizationHistory = async () => {
    if (!project) return;

    try {
      const history = await normalizationApi.getHistory(project.id, 10, true);
      setNormalizationHistory(history.items);
      setShowNormalizationHistory(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to load normalization history");
    }
  };

  if (isLoading) {
    return (
      <>
        <Header />
        <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
          <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
            </div>
          </div>
        </main>
      </>
    );
  }

  if (error && !project) {
    return (
      <>
        <Header />
        <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
          <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
            <Link
              href="/"
              className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to projects
            </Link>

            <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/50 dark:bg-red-900/20">
              <h2 className="text-xl font-semibold text-red-700 dark:text-red-400">
                {error}
              </h2>
              <Link href="/" className="mt-4 inline-block">
                <Button variant="outline">Back to Projects</Button>
              </Link>
            </div>
          </div>
        </main>
      </>
    );
  }

  if (!project) {
    return (
      <>
        <Header />
        <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
          <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
              <h2 className="text-xl font-semibold text-slate-700 dark:text-slate-200">
                Project not found
              </h2>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                This project could not be loaded. It may have been deleted, or you may not have access.
              </p>
              <Link href="/projects" className="mt-4 inline-block">
                <Button variant="outline">Back to Projects</Button>
              </Link>
            </div>
          </div>
        </main>
      </>
    );
  }

  const hasSource = !!project.source_file_path;
  const tocItems: SettingsTocItem[] = [
    { id: "general", label: "General" },
    { id: "ontology-file", label: "Ontology File", attention: !hasSource },
    ...(hasSource ? [{ id: "imports", label: "Imports" }] : []),
    { id: "github", label: "GitHub" },
    ...(hasSource ? [{ id: "label-preferences", label: "Label Preferences" }] : []),
    ...(project.normalization_report ? [{ id: "normalization-report", label: "Import Normalization Report" }] : []),
    ...(hasSource
      ? [
          {
            id: "normalization",
            label: "Ontology Normalization",
            attention: !!normalizationStatus?.needs_normalization,
          },
          { id: "ontology-index", label: "Ontology Search Index" },
        ]
      : []),
    { id: "pull-requests", label: "Pull Request Settings" },
    ...(hasSource ? [{ id: "lint-config", label: "Lint Rule Configuration" }] : []),
    { id: "danger-zone", label: "Danger Zone", danger: true },
  ];

  // Shown inside the "Normalization recommended" notice when it applies, otherwise under the card text.
  const normalizationActions = (
    <>
      <Button
        onClick={() => handleRunNormalization(true)}
        variant="outline"
        disabled={isRunningNormalization || !!normalizationJobId}
      >
        Preview Changes
      </Button>
      <Button
        onClick={() => handleRunNormalization(false)}
        disabled={isRunningNormalization || !!normalizationJobId}
        variant={normalizationStatus?.needs_normalization ? "primary" : "outline"}
      >
        {isRunningNormalization || normalizationJobId ? (
          <>
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            {normalizationJobStatus === "running" ? "Processing..." : "Queued..."}
          </>
        ) : (
          <>
            <Play className="mr-2 h-4 w-4" />
            {normalizationStatus?.needs_normalization
              ? "Run Normalization"
              : "Re-normalize"}
          </>
        )}
      </Button>
    </>
  );

  return (
    <>
      <Header />
      <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
        {/* scroll-mt keeps a section's heading clear of the sticky header when the contents link to it. */}
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 [&>section]:scroll-mt-20">
          <Link
            href={projectHomeHref}
            className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to project
          </Link>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Project Settings
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {project.name}
            </p>
            <p data-testid="project-dates" className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500 dark:text-slate-400">
              <span>Created {formatDate(project.created_at)}</span>
              {project.updated_at && <span>Updated {formatDate(project.updated_at)}</span>}
            </p>
          </div>

          <SettingsToc items={tocItems} />

          {successMessage && (
            <div className="mb-6 rounded-lg bg-green-50 p-4 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
              {successMessage}
            </div>
          )}
          {error && (
            <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <section id="general" className="mb-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
              General
            </h2>
            <ProjectForm
              initialData={{
                name: project.name,
                description: project.description || "",
                is_public: project.is_public,
              }}
              onSubmit={handleUpdateProject}
              submitLabel="Save Changes"
              isLoading={isSaving}
            />
          </section>

          <section
            id="ontology-file"
            className="mb-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="mb-1 flex items-center gap-2">
              <FileCode className="h-5 w-5 text-slate-500" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Ontology File</h2>
              {branch && (
                <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  branch {branch}
                </span>
              )}
            </div>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
              The project edits one ontology file at a time.{" "}
              {hasSource && project.git_ontology_path ? (
                <>
                  Active: <code data-testid="settings-active-ontology-file" className="break-all">{project.git_ontology_path}</code>.
                </>
              ) : (
                <>It has none yet.</>
              )}{" "}
              Switch to another RDF file in the project folder or create a new ontology; the previous file stays in the folder
              unchanged, so you can switch back. The setting applies to every branch, and a file that is converted or
              created is committed on {branch ? `branch ${branch}` : "the default branch"}.
            </p>
            <OntologyFilePanel
              projectId={projectId}
              branch={branch}
              projectName={project.name}
              currentIri={project.ontology_iri}
            />
          </section>

          {project.source_file_path && (
            <section
              id="imports"
              className="mb-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="mb-1 flex items-center gap-2">
                <Layers className="h-5 w-5 text-slate-500" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Imports</h2>
                {branch && (
                  <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    branch {branch}
                  </span>
                )}
              </div>
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                Ontologies this one imports (<code>owl:imports</code>), including what they import in turn. Their classes
                appear read-only in the class tree, and local classes can use them as parents.
              </p>
              <ImportsManager projectId={projectId} branch={branch} />
            </section>
          )}

          <section
            id="github"
            className="mb-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="mb-1 flex items-center gap-2">
              <GitHubMark className="h-5 w-5 text-slate-500" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">GitHub</h2>
            </div>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
              Link this project&apos;s repository to a remote. Sign-in uses your existing git setup (gh auth login, a
              credential helper or SSH keys); OntoBuild never stores tokens.
            </p>
            <GitHubPanel projectId={projectId} mode="settings" />
          </section>

          {project.source_file_path && (
            <section id="label-preferences" className="mb-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-4 flex items-center gap-2">
                <Tag className="h-5 w-5 text-slate-500" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Label Preferences
                </h2>
              </div>
              <LabelPreferences
                preferences={labelPreferences}
                onChange={setLabelPreferences}
                disabled={isSavingPreferences}
              />
              <div className="mt-4 flex items-center justify-end gap-3">
                {preferencesSaved && (
                  <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                    <Check className="h-4 w-4" />
                    Preferences saved
                  </span>
                )}
                <Button
                  onClick={handleSaveLabelPreferences}
                  disabled={isSavingPreferences}
                >
                  {isSavingPreferences ? "Saving..." : "Save Preferences"}
                </Button>
              </div>
            </section>
          )}

          {project.normalization_report && (
            <section id="normalization-report" className="mb-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-4 flex items-center gap-2">
                <FileText className="h-5 w-5 text-slate-500" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Import Normalization Report
                </h2>
              </div>
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                When this ontology was imported, it was normalized to a canonical Turtle format
                to ensure consistent formatting and minimal diffs in future edits.
              </p>

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Original Format</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {project.normalization_report.original_format}
                      {project.normalization_report.format_converted && (
                        <span className="ml-1 text-xs font-normal text-slate-500">→ Turtle</span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Triple Count</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {project.normalization_report.triple_count.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Size Change</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {project.normalization_report.original_size_bytes.toLocaleString()} →{" "}
                      {project.normalization_report.normalized_size_bytes.toLocaleString()} bytes
                    </p>
                  </div>
                </div>

                {(project.normalization_report.prefixes_removed.length > 0 ||
                  project.normalization_report.prefixes_added.length > 0) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                    <h3 className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-200">
                      Prefix Changes
                    </h3>
                    {project.normalization_report.prefixes_removed.length > 0 && (
                      <div className="mb-2">
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Removed: </span>
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          {project.normalization_report.prefixes_removed.join(", ")}
                        </span>
                      </div>
                    )}
                    {project.normalization_report.prefixes_added.length > 0 && (
                      <div>
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Added: </span>
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          {project.normalization_report.prefixes_added.join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {project.normalization_report.notes.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                      Changes Made
                    </h3>
                    <ul className="space-y-1">
                      {project.normalization_report.notes.map((note, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {project.source_file_path && (
            <section
              id="normalization"
              className="mb-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 text-slate-500" />
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Ontology Normalization
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadNormalizationHistory}
                    disabled={isCheckingNormalization}
                  >
                    <History className="mr-1 h-4 w-4" />
                    History
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckNormalization}
                    disabled={isCheckingNormalization}
                  >
                    {isCheckingNormalization ? (
                      <>
                        <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
                        Checking...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-1 h-4 w-4" />
                        Check Status
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                Normalization converts the ontology to a canonical Turtle format, ensuring consistent
                formatting and minimal diffs in future edits. You can run normalization at any time
                to clean up the source file.
              </p>

              {normalizationStatus && (
                <div className="mb-4">
                  {normalizationStatus.error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                      <p className="text-sm text-red-700 dark:text-red-300">
                        Error checking status: {normalizationStatus.error}
                      </p>
                    </div>
                  ) : normalizationStatus.needs_normalization ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                          Normalization recommended
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        The ontology source file can be optimized for better formatting and smaller diffs.
                      </p>
                      <div data-testid="normalization-actions" className="mt-3 flex flex-wrap items-center gap-3">
                        {normalizationActions}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                          Ontology is already normalized
                        </p>
                      </div>
                      {normalizationStatus.last_run && (
                        <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                          Last normalized: {new Date(normalizationStatus.last_run).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {normalizationJobId && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                    <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                      {normalizationJobStatus === "queued" && "Normalization job queued..."}
                      {normalizationJobStatus === "pending" && "Normalization job pending..."}
                      {normalizationJobStatus === "running" && "Normalizing ontology (this may take a while for large files)..."}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                    Job ID: {normalizationJobId}
                  </p>
                </div>
              )}

              {normalizationStatus?.preview_report && normalizationStatus.needs_normalization && (
                <div
                  ref={previewRef}
                  className={`mb-4 space-y-3 rounded-lg border-2 p-4 transition-all duration-500 ${
                    showPreviewHighlight
                      ? "border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20"
                      : "border-transparent"
                  }`}
                >
                  <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Preview of Changes
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Triple Count</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {normalizationStatus.preview_report.triple_count.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Size Change</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {normalizationStatus.preview_report.original_size_bytes.toLocaleString()} →{" "}
                        {normalizationStatus.preview_report.normalized_size_bytes.toLocaleString()} bytes
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Prefixes</p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {normalizationStatus.preview_report.prefixes_removed.length > 0 && (
                          <span className="text-red-600">-{normalizationStatus.preview_report.prefixes_removed.length}</span>
                        )}
                        {normalizationStatus.preview_report.prefixes_removed.length > 0 &&
                          normalizationStatus.preview_report.prefixes_added.length > 0 && " / "}
                        {normalizationStatus.preview_report.prefixes_added.length > 0 && (
                          <span className="text-green-600">+{normalizationStatus.preview_report.prefixes_added.length}</span>
                        )}
                        {normalizationStatus.preview_report.prefixes_removed.length === 0 &&
                          normalizationStatus.preview_report.prefixes_added.length === 0 &&
                          "No changes"}
                      </p>
                    </div>
                  </div>

                  {normalizationStatus.preview_report.notes.length > 0 && (
                    <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                      <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Changes</p>
                      <ul className="space-y-0.5">
                        {normalizationStatus.preview_report.notes.slice(0, 5).map((note, idx) => (
                          <li key={idx} className="text-xs text-slate-600 dark:text-slate-400">
                            • {note}
                          </li>
                        ))}
                        {normalizationStatus.preview_report.notes.length > 5 && (
                          <li className="text-xs text-slate-500 dark:text-slate-500">
                            ... and {normalizationStatus.preview_report.notes.length - 5} more
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {!normalizationStatus?.needs_normalization && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">{normalizationActions}</div>
                  {!normalizationJobId && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Re-normalizing will apply canonical blank node identifiers for more stable diffs.
                    </p>
                  )}
                </div>
              )}

              {showNormalizationHistory && (
                <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-600">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-600">
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Normalization History
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowNormalizationHistory(false)}
                    >
                      Close
                    </Button>
                  </div>
                  {normalizationHistory.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                      No normalization history yet.
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      {normalizationHistory.map((run) => (
                        <div
                          key={run.id}
                          className="border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-700"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-slate-900 dark:text-white">
                                {run.trigger_type === "import" ? "Import" : run.trigger_type === "manual" ? "Manual" : "Automatic"}
                                {run.is_dry_run && (
                                  <span className="ml-2 rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                                    Preview
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {new Date(run.created_at).toLocaleString()}
                              </p>
                            </div>
                            <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                              {run.report && <p>{run.report.triple_count.toLocaleString()} triples</p>}
                              {run.commit_hash && (
                                <p className="font-mono">{run.commit_hash.substring(0, 7)}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {project.source_file_path && (
            <section
              id="ontology-index"
              className="mb-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-slate-500" />
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Ontology Search Index
                  </h2>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReindex}
                  disabled={isReindexing}
                >
                  {isReindexing ? (
                    <>
                      <RefreshCw className="mr-1 h-4 w-4 animate-spin" />
                      Reindexing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-1 h-4 w-4" />
                      Rebuild Index
                    </>
                  )}
                </Button>
              </div>

              <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                The search index accelerates class tree navigation, entity search, and detail
                lookups by caching ontology structure in PostgreSQL. It is rebuilt automatically
                after imports and edits, but you can trigger a manual rebuild if results seem stale.
              </p>

              {indexStatus ? (
                <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {indexStatus.status === "ready" && (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      )}
                      {indexStatus.status === "indexing" && (
                        <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
                      )}
                      {indexStatus.status === "pending" && (
                        <RefreshCw className="h-4 w-4 text-slate-400" />
                      )}
                      {indexStatus.status === "failed" && (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {indexStatus.status === "ready" && "Index up to date"}
                        {indexStatus.status === "indexing" && "Indexing in progress..."}
                        {indexStatus.status === "pending" && "Index pending"}
                        {indexStatus.status === "failed" && "Index failed"}
                      </span>
                    </div>
                    <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                      {indexStatus.entity_count != null && (
                        <p>{indexStatus.entity_count.toLocaleString()} entities indexed</p>
                      )}
                      {indexStatus.indexed_at && (
                        <p>Last indexed: {new Date(indexStatus.indexed_at).toLocaleString()}</p>
                      )}
                      {indexStatus.commit_hash && (
                        <p className="font-mono">{indexStatus.commit_hash.substring(0, 7)}</p>
                      )}
                    </div>
                  </div>
                  {indexStatus.status === "failed" && indexStatus.error_message && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                      {indexStatus.error_message}
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No index status available. Click &quot;Rebuild Index&quot; to create the search index.
                  </p>
                </div>
              )}
            </section>
          )}

          <section id="pull-requests" className="mb-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-4 flex items-center gap-2">
              <GitPullRequest className="h-5 w-5 text-slate-500" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Pull Request Settings
              </h2>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="pr-approval"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Required Approvals
                </label>
                <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
                  Minimum number of approvals required before a pull request can be merged.
                  Set to 0 to allow merging without approvals.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    id="pr-approval"
                    type="number"
                    min="0"
                    max="10"
                    value={prApprovalRequired}
                    onChange={(e) => setPrApprovalRequired(parseInt(e.target.value, 10) || 0)}
                    className={cn(
                      "w-20 rounded-md border px-3 py-2 text-sm",
                      "border-slate-300 focus:border-primary-500 focus:ring-primary-500",
                      "dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                    )}
                  />
                  <Button
                    onClick={handleSavePrSettings}
                    disabled={isSavingPrSettings}
                    size="sm"
                  >
                    {isSavingPrSettings ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {project.source_file_path && (
            <LintConfigSection
              projectId={projectId}
            />
          )}

          <section id="danger-zone" className="rounded-lg border border-red-200 bg-white p-6 dark:border-red-900/50 dark:bg-slate-800">
            <h2 className="mb-4 text-lg font-semibold text-red-600 dark:text-red-400">
              Danger Zone
            </h2>

            {!showDeleteConfirm ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    Delete this project
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Once deleted, this project cannot be recovered.
                  </p>
                </div>
                <Button
                  variant="danger"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Project
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-900/20">
                <p className="mb-3 font-medium text-red-700 dark:text-red-400">
                  Are you sure you want to delete &quot;{project.name}&quot;?
                </p>
                <p className="mb-3 text-sm text-red-600 dark:text-red-300">
                  This action cannot be undone. Type{" "}
                  <strong>{project.name}</strong> to confirm.
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className={cn(
                    "mb-3 w-full rounded-md border px-3 py-2 text-sm",
                    "border-red-300 focus:border-red-500 focus:ring-red-500",
                    "dark:border-red-800 dark:bg-slate-800 dark:text-slate-100"
                  )}
                  placeholder={project.name}
                  disabled={isDeleting}
                />
                <div className="flex gap-3">
                  <Button
                    variant="danger"
                    onClick={handleDeleteProject}
                    disabled={isDeleting || deleteConfirmText !== project.name}
                  >
                    {isDeleting ? "Deleting..." : "Delete Project"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmText("");
                    }}
                    disabled={isDeleting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {showDiffViewer && diffContent && (
        <NormalizationDiffViewer
          originalContent={diffContent.original}
          normalizedContent={diffContent.normalized}
          onClose={() => {
            setShowDiffViewer(false);
            setDiffContent(null);
          }}
        />
      )}
    </>
  );
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

export function getSeverityColor(severity: string) {
  switch (severity) {
    case "error":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    case "warning":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "info":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300";
  }
}

export function LintConfigSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isRunningLint, setIsRunningLint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [lintLevel, setLintLevel] = useState<LintLevel | null>(2);
  const [enabledRules, setEnabledRules] = useState<Set<string>>(new Set());
  const [hasChanges, setHasChanges] = useState(false);

  const [savedLevel, setSavedLevel] = useState<LintLevel | null>(2);
  const [savedRules, setSavedRules] = useState<Set<string>>(new Set());

  const rulesQuery = useQuery({
    queryKey: ["lintRules"],
    queryFn: () => lintApi.getRules(),
    retry: false,
  });

  const levelsQuery = useQuery({
    queryKey: ["lintLevels"],
    queryFn: () => lintApi.getLevels(),
    retry: false,
  });

  const levelRuleMap = useMemo(() => {
    if (!levelsQuery.data) return new Map<LintLevel, Set<string>>();
    const map = new Map<LintLevel, Set<string>>();
    for (const level of levelsQuery.data.levels) {
      map.set(level.level, new Set(level.rule_ids));
    }
    return map;
  }, [levelsQuery.data]);

  const rules = useMemo(() => {
    if (!rulesQuery.data) return [];
    return [...rulesQuery.data.rules].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
    );
  }, [rulesQuery.data]);

  const configQuery = useQuery({
    queryKey: ["lintConfig", projectId],
    queryFn: () => lintApi.getLintConfig(projectId),
    enabled: rules.length > 0,
    retry: false,
  });

  const statusQuery = useQuery<LintSummary>({
    queryKey: ["lintSummary", projectId],
    queryFn: () => lintApi.getStatus(projectId),
    refetchInterval: (query) => {
      const status = query.state.data?.last_run?.status;
      return status === "pending" || status === "running" ? 2000 : false;
    },
  });

  useEffect(() => {
    if (rulesQuery.isError) {
      setError("Failed to load lint rules");
    } else if (levelsQuery.isError) {
      setError("Failed to load lint levels");
    }
  }, [rulesQuery.isError, levelsQuery.isError]);

  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;

  useEffect(() => {
    if (!configQuery.data && !configQuery.isError) return;
    if (hasChangesRef.current) return;

    if (configQuery.data) {
      const cfg = configQuery.data;
      const level = cfg.lint_level;
      if (level !== null && levelRuleMap.size === 0) return;
      setLintLevel(level);
      setSavedLevel(level);
      if (level === null) {
        const ruleSet = new Set(cfg.enabled_rules ?? []);
        setEnabledRules(ruleSet);
        setSavedRules(ruleSet);
      } else {
        const presetRules = levelRuleMap.get(level) ?? new Set<string>();
        setEnabledRules(presetRules);
        setSavedRules(presetRules);
      }
    } else if (configQuery.isError) {
      setError(
        configQuery.error instanceof Error
          ? configQuery.error.message
          : "Failed to load lint configuration"
      );
    }
  }, [configQuery.data, configQuery.isError, configQuery.error, levelRuleMap]);

  const isLoading = rulesQuery.isLoading || levelsQuery.isLoading || (rules.length > 0 && configQuery.isLoading);

  useEffect(() => {
    if (lintLevel !== savedLevel) {
      setHasChanges(true);
      return;
    }
    if (lintLevel === null) {
      const currentIds = [...enabledRules].sort().join(",");
      const savedIds = [...savedRules].sort().join(",");
      setHasChanges(currentIds !== savedIds);
    } else {
      setHasChanges(false);
    }
  }, [lintLevel, enabledRules, savedLevel, savedRules]);

  const handleLevelChange = (level: LintLevel | null) => {
    setLintLevel(level);
    setError(null);
    setSuccess(null);
    if (level !== null) {
      setEnabledRules(levelRuleMap.get(level) ?? new Set<string>());
    }
  };

  const handleRuleToggle = (ruleId: string) => {
    if (lintLevel !== null) return;
    setError(null);
    setSuccess(null);
    setEnabledRules((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const config: LintConfig =
        lintLevel === null
          ? { lint_level: null, enabled_rules: [...enabledRules] }
          : { lint_level: lintLevel };
      await lintApi.updateLintConfig(projectId, config);
      setSavedLevel(lintLevel);
      setSavedRules(new Set(enabledRules));
      setHasChanges(false);
      setSuccess("Lint configuration saved");
      queryClient.invalidateQueries({ queryKey: ["lintConfig", projectId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save lint configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearResults = async () => {
    setIsClearing(true);
    setError(null);
    setSuccess(null);
    try {
      await lintApi.clearResults(projectId);
      setSuccess("Lint results cleared");
      queryClient.invalidateQueries({ queryKey: ["lintSummary", projectId] });
      queryClient.invalidateQueries({ queryKey: ["lintIssues", projectId] });
      queryClient.invalidateQueries({ queryKey: ["lintRuns", projectId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear lint results");
    } finally {
      setIsClearing(false);
    }
  };

  const handleRunLint = async () => {
    setIsRunningLint(true);
    setError(null);
    setSuccess(null);
    try {
      await lintApi.triggerLint(projectId);
      setSuccess("Lint run started");
      queryClient.invalidateQueries({ queryKey: ["lintSummary", projectId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start lint run");
    } finally {
      setIsRunningLint(false);
    }
  };

  const isCustom = lintLevel === null;
  const lastRunStatus = statusQuery.data?.last_run?.status;
  const hasResultsToClear =
    lastRunStatus === "completed" && (statusQuery.data?.total_issues ?? 0) > 0;
  const isLintInProgress = lastRunStatus === "pending" || lastRunStatus === "running";

  return (
    <section
      id="lint-config"
      className="mb-8 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="mb-4 flex items-center gap-2">
        <Shield className="h-5 w-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Lint Rule Configuration
        </h2>
      </div>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Configure which lint rules are applied during ontology health checks.
        Choose a preset level or customize individual rules.
      </p>

      {statusQuery.data?.last_run && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-600 dark:bg-slate-700/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Last run: {new Date(statusQuery.data.last_run.completed_at || statusQuery.data.last_run.started_at).toLocaleString()}
              {statusQuery.data.last_run.status !== "completed" && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  ({statusQuery.data.last_run.status})
                </span>
              )}
            </span>
            <div className="flex items-center gap-3 text-xs">
              {statusQuery.data.error_count > 0 && (
                <span className="font-medium text-red-600 dark:text-red-400">
                  {statusQuery.data.error_count} error{statusQuery.data.error_count !== 1 && "s"}
                </span>
              )}
              {statusQuery.data.warning_count > 0 && (
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  {statusQuery.data.warning_count} warning{statusQuery.data.warning_count !== 1 && "s"}
                </span>
              )}
              {statusQuery.data.info_count > 0 && (
                <span className="font-medium text-blue-600 dark:text-blue-400">
                  {statusQuery.data.info_count} info
                </span>
              )}
              {statusQuery.data.total_issues === 0 && (
                <span className="font-medium text-green-600 dark:text-green-400">
                  No issues
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex h-16 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Lint Level
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              {(levelsQuery.data?.levels ?? []).map((lvl) => (
                <button
                  key={lvl.level}
                  type="button"
                  onClick={() => handleLevelChange(lvl.level)}
                  aria-pressed={lintLevel === lvl.level}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-all",
                    lintLevel === lvl.level
                      ? "border-primary-500 bg-primary-50 ring-1 ring-primary-500 dark:border-primary-400 dark:bg-primary-900/20"
                      : "border-slate-200 hover:border-slate-300 dark:border-slate-600 dark:hover:border-slate-500"
                  )}
                >
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    Level {lvl.level} — {lvl.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lvl.description} ({lvl.rule_ids.length} rules)
                  </p>
                </button>
              ))}
              <button
                type="button"
                onClick={() => handleLevelChange(null)}
                aria-pressed={lintLevel === null}
                className={cn(
                  "rounded-lg border p-3 text-left transition-all",
                  lintLevel === null
                    ? "border-primary-500 bg-primary-50 ring-1 ring-primary-500 dark:border-primary-400 dark:bg-primary-900/20"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-600 dark:hover:border-slate-500"
                )}
              >
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Custom
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Choose rules individually
                </p>
              </button>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Rules ({enabledRules.size} of {rules.length} enabled)
              </label>
              {isCustom && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEnabledRules(new Set(rules.map((r) => r.rule_id)))}
                    className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                  >
                    Enable all
                  </button>
                  <span className="text-xs text-slate-300 dark:text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={() => setEnabledRules(new Set())}
                    className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                  >
                    Disable all
                  </button>
                </div>
              )}
            </div>
            <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-600">
              {rules.map((rule) => {
                const enabled = enabledRules.has(rule.rule_id);
                return (
                  <div
                    key={rule.rule_id}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
                      enabled
                        ? "bg-slate-50 dark:bg-slate-700/50"
                        : "bg-transparent opacity-60"
                    )}
                  >
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() => handleRuleToggle(rule.rule_id)}
                      disabled={!isCustom}
                      className={cn(
                        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                        enabled
                          ? "bg-primary-600 dark:bg-primary-500"
                          : "bg-slate-300 dark:bg-slate-600",
                        !isCustom && "cursor-not-allowed opacity-60"
                      )}
                      aria-label={`Toggle ${rule.name}`}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                          enabled && "translate-x-4"
                        )}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">
                          {rule.name}
                        </span>
                        <span
                          className={cn(
                            "inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none",
                            getSeverityColor(rule.severity)
                          )}
                        >
                          {rule.severity}
                        </span>
                        {rule.scope && (
                          <span className="inline-flex gap-0.5">
                            {rule.scope.map((s) => (
                              <Tooltip key={s} content={s}>
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[8px] font-bold text-slate-500 dark:border-slate-500 dark:text-slate-400">
                                  {s[0].toUpperCase()}
                                </span>
                              </Tooltip>
                            ))}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {rule.description}
                      </p>
                    </div>
                  </div>
                );
              })}
              {rules.length === 0 && (
                <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                  No lint rules available.
                </p>
              )}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex items-center justify-end gap-3">
            {success && (
              <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
            )}
            {hasResultsToClear ? (
              <Button
                onClick={handleClearResults}
                disabled={isClearing}
                size="sm"
                variant="outline"
              >
                {isClearing ? "Clearing..." : "Clear Results"}
              </Button>
            ) : (
              <Button
                onClick={handleRunLint}
                disabled={isRunningLint || isLintInProgress}
                size="sm"
                variant="outline"
              >
                {isRunningLint || isLintInProgress ? "Running..." : "Run Lint"}
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              size="sm"
            >
              {isSaving ? "Saving..." : "Save Lint Configuration"}
            </Button>
          </div>

        </div>
      )}
    </section>
  );
}
