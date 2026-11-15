"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSession } from "@/lib/localUser";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Settings, FileCode, RefreshCw, Keyboard, LayoutDashboard, PanelRightOpen, PanelRightClose } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AddEntityDialog, type NewEntityInfo } from "@/components/editor/AddEntityDialog";
import { useToast } from "@/lib/context/ToastContext";
import { readSelectionFromSearchParams } from "@/lib/utils/selectionUrl";
import { StandardEditorLayout } from "@/components/editor/standard/StandardEditorLayout";
import { BranchSelector, RevisionHistoryPanel, HistoryButton } from "@/components/revision";
import { HealthCheckPanel } from "@/components/editor/HealthCheckPanel";
import { RightSidebar, lintSeverity, LINT_DOT_CLASSES } from "@/components/editor/RightSidebar";
import { AgentPanel } from "@/components/editor/agent/AgentPanel";
import type { EntityTab } from "@/components/editor/standard/EntityTabBar";
import type { AgentPageInfo } from "@/lib/agent/pageContext";
import { useSelectionStore } from "@/lib/stores/selectionStore";
import { useQueryClient } from "@tanstack/react-query";
import { BranchProvider, branchQueryKeys } from "@/lib/context/BranchContext";
import { useProjectViewer } from "@/lib/hooks/useProjectViewer";
import { revisionsApi } from "@/lib/api/revisions";
import { projectOntologyApi, type ClassUpdatePayload } from "@/lib/api/client";
import { getLocalName } from "@/lib/utils";
import { generateTurtleSnippet } from "@/lib/ontology/turtleSnippetGenerator";
import { updateClassInTurtle } from "@/lib/ontology/turtleClassUpdater";
import { updatePropertyInTurtle, type TurtlePropertyUpdateData } from "@/lib/ontology/turtlePropertyUpdater";
import { updateIndividualInTurtle, type TurtleIndividualUpdateData } from "@/lib/ontology/turtleIndividualUpdater";
import { detectPatternFromIriIndex, type IriSuffixPattern } from "@/lib/ontology/iriGeneration";
import { commonPrefixes } from "@/lib/editor/languages/turtle";

import { useKeyboardShortcuts, type ShortcutDefinition } from "@/lib/hooks/useKeyboardShortcuts";
import { KeyboardShortcutDialog } from "@/components/editor/KeyboardShortcutDialog";
import { DeleteImpactAnalysis } from "@/components/editor/DeleteImpactAnalysis";
import { ShareButton } from "@/components/editor/ShareButton";
import { Tooltip } from "@/components/ui/tooltip";

export default function ProjectEditorPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const projectId = params.id as string;
  const resumeBranchParam = searchParams.get("branch") || undefined;
  const searchParamsString = searchParams.toString();
  const initialSelection = useMemo(
    () => readSelectionFromSearchParams(new URLSearchParams(searchParamsString)),
    [searchParamsString],
  );
  const consumedSelectionRef = useRef<string | null>(null);
  const initialBranch = resumeBranchParam
    || (() => { try { return sessionStorage.getItem(`ontokit:branch:${projectId}`); } catch { return null; } })()
    || undefined;

  const queryClient = useQueryClient();
  const [activeBranch, setActiveBranch] = useState<string | undefined>(undefined);

  const viewer = useProjectViewer({
    projectId,
    accessToken: session?.accessToken,
    sessionStatus: status,
    activeBranch,
  });

  const {
    project, isLoading, error,
    openPRCount, lintSummary, normalizationStatus,
    canManage, canEdit,
    hasValidAccess, hasOntology,
    nodes, totalClasses, isTreeLoading, treeError,
    selectedIri, loadRootClasses, expandNode, collapseNode, selectNode,
    navigateToNode, addOptimisticNode, removeOptimisticNode, updateNodeLabel,
    collapseAll, collapseOneLevel, expandOneLevel, expandAllFully,
    hasExpandableNodes, hasExpandedNodes, isExpandingAll,
    reparentOptimistic, rollbackReparent,
    selectedNodeFallback,
    sourceContent, setSourceContent,
    sourceIriIndex, setSourceIriIndex,
    resetSourceState,
  } = viewer;

  const [showHistory, setShowHistory] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [leftTab, setLeftTab] = useState<EntityTab>("classes");
  const selectionIri = useSelectionStore((s) => s.iri);
  const selectionType = useSelectionStore((s) => s.type);
  const entityNavigationRef = useRef<((iri: string, type?: string) => void) | null>(null);

  useEffect(() => {
    if (!initialSelection) return;
    const key = `${initialSelection.type}:${initialSelection.iri}`;
    if (consumedSelectionRef.current === key) return;

    if (initialSelection.type === "class") {
      if (isTreeLoading || !nodes.length) return;
      if (selectedIri === initialSelection.iri) {
        consumedSelectionRef.current = key;
        return;
      }
      let cancelled = false;
      navigateToNode(initialSelection.iri)
        .then(() => {
          if (!cancelled) consumedSelectionRef.current = key;
        })
        .catch((err) => {
          if (!cancelled) console.error("Failed to restore selection from URL:", err);
        });
      return () => {
        cancelled = true;
      };
    }
    if (isLoading) return;
    if (!entityNavigationRef.current) return;
    entityNavigationRef.current(initialSelection.iri, initialSelection.type);
    consumedSelectionRef.current = key;
  }, [initialSelection, isTreeLoading, nodes.length, selectedIri, navigateToNode, isLoading]);

  const [addEntityDialogOpen, setAddEntityDialogOpen] = useState(false);
  const [addEntityInitialType, setAddEntityInitialType] = useState<"individual" | undefined>(undefined);
  const [addEntityParentIri, setAddEntityParentIri] = useState<string | undefined>(undefined);
  const [addEntityParentLabel, setAddEntityParentLabel] = useState<string | undefined>(undefined);

  const [iriPattern, setIriPattern] = useState<IriSuffixPattern>("uuid");
  const [nextNumeric, setNextNumeric] = useState<number | undefined>(undefined);
  const [ontologyNamespace, setOntologyNamespace] = useState("http://example.org/ont#");
  const [ontologyPrefix, setOntologyPrefix] = useState<string | undefined>(undefined);
  const iriPatternDetectedRef = useRef(false);

  const [detailRefreshKey, setDetailRefreshKey] = useState(0);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetIri, setDeleteTargetIri] = useState<string | null>(null);
  const [deleteTargetLabel, setDeleteTargetLabel] = useState<string>("");
  const [deleteImpactAcknowledged, setDeleteImpactAcknowledged] = useState(true);

  const toast = useToast();

  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);

  useEffect(() => {
    if (iriPatternDetectedRef.current || sourceIriIndex.size === 0 || !sourceContent) return;
    iriPatternDetectedRef.current = true;

    const internalNamespaces = new Set<string>();
    const prefixMap = new Map<string, string>();
    const externalNamespaces = new Set(commonPrefixes.map((p) => p.namespace));

    for (const line of sourceContent.split("\n")) {
      const baseMatch = line.match(/@base\s+<([^>]+)>/i);
      if (baseMatch) {
        internalNamespaces.add(baseMatch[1]);
      }
      const prefixMatch = line.match(/@?prefix\s+(\w*):\s*<([^>]+)>/i);
      if (prefixMatch) {
        const [, pfx, ns] = prefixMatch;
        prefixMap.set(pfx, ns);
        if (!externalNamespaces.has(ns)) {
          internalNamespaces.add(ns);
        }
      }
    }

    const defaultNs = prefixMap.get("") ?? [...internalNamespaces][0];
    if (defaultNs) {
      setOntologyNamespace(defaultNs);
    }

    for (const [pfx, ns] of prefixMap) {
      if (ns === defaultNs && pfx !== "") {
        setOntologyPrefix(pfx);
        break;
      }
    }

    const result = detectPatternFromIriIndex(sourceIriIndex, internalNamespaces);
    setIriPattern(result.pattern);
    if (result.nextNumeric !== undefined) {
      setNextNumeric(result.nextNumeric);
    }
  }, [sourceIriIndex, sourceContent]);

  const handleAddEntity = useCallback((parentIri?: string, entityType?: "individual") => {
    setAddEntityParentIri(parentIri);
    setAddEntityInitialType(entityType);
    if (parentIri) {
      const findLabel = (items: typeof nodes): string | undefined => {
        for (const node of items) {
          if (node.iri === parentIri) return node.label;
          const found = findLabel(node.children);
          if (found) return found;
        }
        return undefined;
      };
      setAddEntityParentLabel(findLabel(nodes));
    } else {
      setAddEntityParentLabel(undefined);
    }
    setAddEntityDialogOpen(true);
  }, [nodes]);

  const handleEntityConfirm = useCallback(
    async (entity: NewEntityInfo) => {
      if (!canEdit) return;
      const snippet = generateTurtleSnippet({
        iri: entity.iri,
        label: entity.label,
        entityType: entity.entityType,
        parentIri: entity.parentIri,
        ontologyPrefix,
        ontologyNamespace,
      });

      if (!projectId || !session?.accessToken || !activeBranch) return;

      let base: string;
      if (sourceContent) {
        base = sourceContent;
      } else {
        try {
          const response = await revisionsApi.getFileAtVersion(
            projectId,
            activeBranch,
            session.accessToken,
            project?.git_ontology_path
          );
          base = response.content;
        } catch {
          toast.error("Failed to load source before adding entity");
          return;
        }
      }
      const newContent = base + snippet;

      const typeLabel: Record<string, string> = {
        class: "class",
        objectProperty: "object property",
        dataProperty: "data property",
        annotationProperty: "annotation property",
        individual: "individual",
      };
      try {
        await projectOntologyApi.saveSource(
          projectId,
          newContent,
          `Add ${typeLabel[entity.entityType] ?? entity.entityType} ${entity.label}`,
          session.accessToken,
          activeBranch,
        );
      } catch (err) {
        toast.error(err instanceof Error ? `Failed to save: ${err.message}` : "Failed to save new entity");
        return;
      }

      setSourceContent(newContent);
      toast.success(`Added "${entity.label}"`);

      if (entity.entityType === "class") {
        addOptimisticNode(entity.iri, entity.label, entity.parentIri);
      }
      setDetailRefreshKey((k) => k + 1);
      setSourceIriIndex(new Map());
      iriPatternDetectedRef.current = false;
      queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId, session?.accessToken) });
    },
    [canEdit, ontologyPrefix, ontologyNamespace, addOptimisticNode, sourceContent, projectId, session, activeBranch, project, toast, setSourceContent, setSourceIriIndex, queryClient],
  );

  const handleCopyIri = useCallback(async (iri: string) => {
    try {
      await navigator.clipboard.writeText(iri);
      toast.success("IRI copied to clipboard");
    } catch {
      toast.error("Failed to copy IRI");
    }
  }, [toast]);

  const handleDeleteClass = useCallback((iri: string, label: string) => {
    setDeleteTargetIri(iri);
    setDeleteTargetLabel(label);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTargetIri || !session?.accessToken) return;

    removeOptimisticNode(deleteTargetIri);

    try {
      await projectOntologyApi.deleteClass(
        projectId,
        deleteTargetIri,
        `Delete class ${deleteTargetLabel}`,
        session.accessToken,
        activeBranch
      );
      toast.success(`Deleted "${deleteTargetLabel}"`);
      setSourceContent("");
      loadRootClasses();
      queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId, session?.accessToken) });
    } catch (err) {
      toast.error(
        "Failed to delete class",
        err instanceof Error ? err.message : "Unknown error"
      );
      loadRootClasses();
    }
  }, [deleteTargetIri, deleteTargetLabel, session, projectId, activeBranch, removeOptimisticNode, toast, loadRootClasses, queryClient, setSourceContent]);

  const handleUpdateClass = useCallback(async (classIri: string, data: ClassUpdatePayload) => {
    if (!session?.accessToken) {
      throw new Error("Not authenticated");
    }
    if (!activeBranch) {
      throw new Error("No branch selected");
    }

    let source = sourceContent;
    if (!source) {
      const response = await revisionsApi.getFileAtVersion(
        projectId,
        activeBranch,
        session.accessToken,
        project?.git_ontology_path,
      );
      source = response.content;
    }

    let previousParents: string[] | null = null;
    try {
      const before = await projectOntologyApi.getClassDetail(projectId, classIri, session.accessToken, activeBranch);
      previousParents = before.parent_iris;
    } catch {
      previousParents = null;
    }

    const modifiedSource = updateClassInTurtle(source, classIri, data);

    const label = data.labels[0]?.value || getLocalName(classIri);
    const commitMessage = `Update class ${label}`;

    await projectOntologyApi.saveSource(
      projectId,
      modifiedSource,
      commitMessage,
      session.accessToken,
      activeBranch,
    );

    setSourceContent(modifiedSource);
    toast.success(`Updated "${label}"`);

    updateNodeLabel(classIri, label);
    setDetailRefreshKey((k) => k + 1);

    const sameParents = previousParents !== null &&
      previousParents.length === data.parent_iris.length &&
      previousParents.every((p) => data.parent_iris.includes(p));
    if (!sameParents) {
      await loadRootClasses();
      await navigateToNode(classIri);
    }

    setSourceIriIndex(new Map());
    iriPatternDetectedRef.current = false;
    queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId, session?.accessToken) });
  }, [session, projectId, activeBranch, project, sourceContent, toast, updateNodeLabel, queryClient, setSourceContent, setSourceIriIndex, loadRootClasses, navigateToNode]);

  const handleUpdateProperty = useCallback(async (propertyIri: string, data: TurtlePropertyUpdateData) => {
    if (!session?.accessToken) {
      throw new Error("Not authenticated");
    }
    if (!activeBranch) {
      throw new Error("No branch selected");
    }

    let source = sourceContent;
    if (!source) {
      const response = await revisionsApi.getFileAtVersion(
        projectId,
        activeBranch,
        session.accessToken,
        project?.git_ontology_path,
      );
      source = response.content;
    }

    const modifiedSource = updatePropertyInTurtle(source, propertyIri, data);
    const label = data.labels[0]?.value || getLocalName(propertyIri);
    const commitMessage = `Update property ${label}`;

    await projectOntologyApi.saveSource(
      projectId,
      modifiedSource,
      commitMessage,
      session.accessToken,
      activeBranch,
    );

    setSourceContent(modifiedSource);
    toast.success(`Updated "${label}"`);
    setDetailRefreshKey((k) => k + 1);
    setSourceIriIndex(new Map());
    iriPatternDetectedRef.current = false;
    queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId, session?.accessToken) });
  }, [session, projectId, activeBranch, project, sourceContent, toast, queryClient, setSourceContent, setSourceIriIndex]);

  const handleUpdateIndividual = useCallback(async (individualIri: string, data: TurtleIndividualUpdateData) => {
    if (!session?.accessToken) {
      throw new Error("Not authenticated");
    }
    if (!activeBranch) {
      throw new Error("No branch selected");
    }

    let source = sourceContent;
    if (!source) {
      const response = await revisionsApi.getFileAtVersion(
        projectId,
        activeBranch,
        session.accessToken,
        project?.git_ontology_path,
      );
      source = response.content;
    }

    const modifiedSource = updateIndividualInTurtle(source, individualIri, data);
    const label = data.labels[0]?.value || getLocalName(individualIri);
    const commitMessage = `Update individual ${label}`;

    await projectOntologyApi.saveSource(
      projectId,
      modifiedSource,
      commitMessage,
      session.accessToken,
      activeBranch,
    );

    setSourceContent(modifiedSource);
    toast.success(`Updated "${label}"`);
    setDetailRefreshKey((k) => k + 1);
    setSourceIriIndex(new Map());
    iriPatternDetectedRef.current = false;
    queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId, session?.accessToken) });
  }, [session, projectId, activeBranch, project, sourceContent, toast, queryClient, setSourceContent, setSourceIriIndex]);

  const handleReparentClass = useCallback(async (
    classIri: string,
    _oldParentIris: string[],
    newParentIris: string[],
    mode: "move" | "add",
  ) => {
    if (!session?.accessToken) throw new Error("Not authenticated");

    const detail = await projectOntologyApi.getClassDetail(projectId, classIri, session.accessToken, activeBranch);

    let updatedParentIris: string[];
    if (newParentIris.length === 0) {
      updatedParentIris = [];
    } else if (mode === "add") {
      const parentSet = new Set(detail.parent_iris);
      for (const iri of newParentIris) parentSet.add(iri);
      updatedParentIris = [...parentSet];
    } else {
      const oldTreeParent = _oldParentIris[0] || null;
      if (oldTreeParent && detail.parent_iris.includes(oldTreeParent)) {
        updatedParentIris = detail.parent_iris.map((p) =>
          p === oldTreeParent ? newParentIris[0] : p,
        );
      } else {
        updatedParentIris = [...detail.parent_iris, ...newParentIris];
      }
      updatedParentIris = [...new Set(updatedParentIris)];
    }

    const payload: ClassUpdatePayload = {
      labels: detail.labels,
      comments: detail.comments,
      parent_iris: updatedParentIris,
      annotations: detail.annotations.map((a) => ({
        property_iri: a.property_iri,
        values: a.values,
      })),
      deprecated: detail.deprecated,
      equivalent_iris: detail.equivalent_iris ?? undefined,
      disjoint_iris: detail.disjoint_iris ?? undefined,
    };

    await handleUpdateClass(classIri, payload);
  }, [session, projectId, activeBranch, handleUpdateClass]);

  const handleBranchChange = useCallback((branchName: string) => {
    setActiveBranch(branchName);
    resetSourceState();
    const next = new URLSearchParams(searchParamsString);
    next.set("branch", branchName);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, router, resetSourceState, searchParamsString]);

  const projectChangedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshAfterAgentRef = useRef<() => void>(() => {});
  useEffect(() => {
    refreshAfterAgentRef.current = () => {
      resetSourceState();
      loadRootClasses();
      setDetailRefreshKey((k) => k + 1);
      iriPatternDetectedRef.current = false;
      queryClient.invalidateQueries();
    };
  });
  useEffect(() => () => {
    if (projectChangedTimerRef.current) clearTimeout(projectChangedTimerRef.current);
  }, []);
  const handleAgentProjectChanged = useCallback(() => {
    if (projectChangedTimerRef.current) clearTimeout(projectChangedTimerRef.current);
    projectChangedTimerRef.current = setTimeout(() => {
      projectChangedTimerRef.current = null;
      refreshAfterAgentRef.current();
    }, 300);
  }, []);

  const agentPageInfo = useMemo((): AgentPageInfo => ({
    projectId,
    projectName: project?.name,
    branch: activeBranch,
    leftTab,
    selectedEntity: selectionIri && selectionType
      ? {
          iri: selectionIri,
          type: selectionType,
          label: selectionType === "class" && selectedNodeFallback?.iri === selectionIri ? selectedNodeFallback.label : null,
        }
      : null,
  }), [projectId, project?.name, activeBranch, leftTab, selectionIri, selectionType, selectedNodeFallback]);

  const lintDotSeverity = lintSeverity(lintSummary);

  const keyboardShortcuts = useMemo((): ShortcutDefinition[] => [
    {
      id: "save",
      key: "s",
      modifiers: { ctrl: true },
      description: "Save / flush draft",
      category: "Editing",
      action: () => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      },
      global: true,
      ignoreWhenEditorFocused: true,
    },
    ...(canEdit ? [{
      id: "add-entity",
      key: "n",
      modifiers: { ctrl: true },
      description: "Add new entity",
      category: "Editing",
      action: () => handleAddEntity(),
      global: true,
    }] : []),
    {
      id: "help",
      key: "?",
      description: "Show keyboard shortcuts",
      category: "General",
      action: () => setShortcutDialogOpen(true),
    },
    {
      id: "escape",
      key: "Escape",
      description: "Close topmost overlay",
      category: "General",
      action: () => {
        if (shortcutDialogOpen) {
          setShortcutDialogOpen(false);
        } else if (showHistory) {
          setShowHistory(false);
        } else if (showRightSidebar) {
          setShowRightSidebar(false);
        }
      },
      global: true,
      ignoreWhenEditorFocused: false,
    },
  ], [handleAddEntity, shortcutDialogOpen, showHistory, showRightSidebar, canEdit]);

  useKeyboardShortcuts(keyboardShortcuts);

  if (isLoading || status === "loading") {
    return (
      <>
        <Header />
        <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
          <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        </main>
      </>
    );
  }

  if (error || !project) {
    return (
      <>
        <Header />
        <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
          <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
            <Link
              href="/"
              className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to projects
            </Link>
            <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/50 dark:bg-red-900/20">
              <h2 className="text-xl font-semibold text-red-700 dark:text-red-400">
                {error || "Project not found"}
              </h2>
              <div className="mt-4 flex items-center justify-center gap-3">
                <Link href="/">
                  <Button variant="outline">Back to Projects</Button>
                </Link>
              </div>
            </div>
          </div>
        </main>
      </>
    );
  }

  if (status === "unauthenticated" || (project && !canEdit)) {
    router.replace("/");
    return (
      <>
        <Header />
        <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
          <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        </main>
      </>
    );
  }

  if (!hasOntology) {
    return (
      <>
        <Header />
        <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-100 dark:bg-slate-900">
          <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link
                  href="/"
                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Link>
                <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
                <h1 className="font-semibold text-slate-900 dark:text-white">{project.name}</h1>
              </div>
              {canManage && (
                <Tooltip side="bottom" content="Project settings: settings for this project only (ontology import, normalization, lint rules)">
                  <Link href={`/projects/${projectId}/settings`} aria-label="Project settings">
                    <Button variant="ghost" size="sm" tabIndex={-1} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </Link>
                </Tooltip>
              )}
            </div>
          </div>
          <div className="flex h-[calc(100vh-4rem-3.5rem)] items-center justify-center">
            <div className="text-center">
              <FileCode className="mx-auto h-16 w-16 text-slate-400" />
              <h2 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">No Ontology File</h2>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                This project doesn&apos;t have an ontology file yet.
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-500">
                Import an ontology file from the project settings.
              </p>
              <Link href={`/projects/${projectId}/settings`} className="mt-6 inline-block">
                <Button variant="outline">Go to Settings</Button>
              </Link>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <BranchProvider projectId={projectId} accessToken={session?.accessToken} initialBranch={initialBranch}>
      <Header />
      <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-100 dark:bg-slate-900">
        <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-4">
              <Link
                href="/"
                className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
              <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
              <h1 className="font-semibold text-slate-900 dark:text-white">{project.name}</h1>
              <span className="text-sm text-slate-500 dark:text-slate-400">{totalClasses} classes</span>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <BranchSelector onBranchChange={handleBranchChange} canCreateBranch={canEdit} readOnly={!hasValidAccess} />

              <ShareButton
                projectId={projectId}
                selectedIri={selectedIri}
                selectedLabel={selectedNodeFallback?.label}
                openPRCount={openPRCount}
              />

              <HistoryButton onClick={() => setShowHistory(!showHistory)} isOpen={showHistory} />

              {hasValidAccess && normalizationStatus?.needs_normalization && (
                <Tooltip side="bottom" content="Ontology normalization recommended">
                  <Link href={`/projects/${projectId}/settings#normalization`} aria-label="Normalize ontology">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span className="hidden sm:inline">Normalize</span>
                    </Button>
                  </Link>
                </Tooltip>
              )}

              <Tooltip side="bottom" content="Project dashboard">
                <Link href={`/projects/${projectId}/dashboard`}>
                  <Button variant="ghost" size="sm" aria-label="Project dashboard" className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                    <LayoutDashboard className="h-4 w-4" />
                  </Button>
                </Link>
              </Tooltip>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShortcutDialogOpen(true)}
                aria-label="Keyboard shortcuts"
              >
                <Keyboard className="h-4 w-4" />
              </Button>

              {canManage && (
                <Tooltip side="bottom" content="Project settings: settings for this project only (ontology import, normalization, lint rules)">
                  <Link href={`/projects/${projectId}/settings`} aria-label="Project settings">
                    <Button variant="ghost" size="sm" tabIndex={-1} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </Link>
                </Tooltip>
              )}

              <Tooltip side="bottom" content="Agent and health panel">
                <Button
                  variant={showRightSidebar ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setShowRightSidebar((v) => !v)}
                  aria-label={
                    !showRightSidebar && lintSummary && lintSummary.total_issues > 0
                      ? `Agent and health panel (${lintSummary.total_issues} lint issues)`
                      : "Agent and health panel"
                  }
                  aria-pressed={showRightSidebar}
                  className="relative text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  {showRightSidebar ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                  {!showRightSidebar && lintDotSeverity && (
                    <span
                      data-testid="right-sidebar-lint-dot"
                      className={`absolute right-1.5 top-1 h-2 w-2 rounded-full ring-2 ring-white dark:ring-slate-800 ${LINT_DOT_CLASSES[lintDotSeverity]}`}
                    />
                  )}
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="relative flex h-[calc(100vh-4rem-3.5rem)]">
          <div className="flex-1 flex overflow-hidden">
            <StandardEditorLayout
              projectId={projectId}
              accessToken={session?.accessToken}
              activeBranch={activeBranch}
              canEdit={!!canEdit}
              entityNavigationRef={entityNavigationRef}
              nodes={nodes}
              isTreeLoading={isTreeLoading}
              treeError={treeError}
              selectedIri={selectedIri}
              selectNode={selectNode}
              expandNode={expandNode}
              collapseNode={collapseNode}
              expandOneLevel={expandOneLevel}
              expandAllFully={expandAllFully}
              collapseAll={collapseAll}
              collapseOneLevel={collapseOneLevel}
              hasExpandableNodes={hasExpandableNodes}
              hasExpandedNodes={hasExpandedNodes}
              isExpandingAll={isExpandingAll}
              navigateToNode={navigateToNode}
              onAddEntity={handleAddEntity}
              onDeleteClass={handleDeleteClass}
              onCopyIri={handleCopyIri}
              selectedNodeFallback={selectedNodeFallback}
              onUpdateClass={handleUpdateClass}
              detailRefreshKey={detailRefreshKey}
              sourceContent={sourceContent}
              onUpdateProperty={handleUpdateProperty}
              onUpdateIndividual={handleUpdateIndividual}
              onReparentClass={handleReparentClass}
              reparentOptimistic={reparentOptimistic}
              rollbackReparent={rollbackReparent}
              onActiveTabChange={setLeftTab}
            />
          </div>

          {showRightSidebar && (
            <RightSidebar
              onClose={() => setShowRightSidebar(false)}
              lintSummary={lintSummary}
              agent={
                <AgentPanel pageInfo={agentPageInfo} onProjectChanged={handleAgentProjectChanged} />
              }
              health={(isActive) => (
                <div className="min-h-0 flex-1">
                  <HealthCheckPanel
                    projectId={projectId}
                    accessToken={session?.accessToken}
                    branch={activeBranch}
                    isOpen={isActive}
                    embedded
                    onClose={() => setShowRightSidebar(false)}
                    onNavigateToClass={(iri, subjectType) => {
                      if (entityNavigationRef.current) {
                        entityNavigationRef.current(iri, subjectType);
                      } else {
                        navigateToNode(iri);
                      }
                    }}
                    canRunLint={!!canManage}
                  />
                </div>
              )}
            />
          )}

          <RevisionHistoryPanel
            projectId={projectId}
            accessToken={session?.accessToken}
            isOpen={showHistory}
            onClose={() => setShowHistory(false)}
          />
        </div>
      </main>

      {canEdit && (
        <AddEntityDialog
          open={addEntityDialogOpen}
          onOpenChange={setAddEntityDialogOpen}
          onConfirm={handleEntityConfirm}
          iriPattern={iriPattern}
          nextNumeric={nextNumeric}
          ontologyNamespace={ontologyNamespace}
          parentIri={addEntityParentIri}
          parentLabel={addEntityParentLabel}
          initialType={addEntityInitialType}
        />
      )}

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setDeleteImpactAcknowledged(true);
        }}
        onConfirm={handleDeleteConfirm}
        title="Delete Class"
        description={`Are you sure you want to delete "${deleteTargetLabel}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        confirmDisabled={!deleteImpactAcknowledged}
      >
        <DeleteImpactAnalysis
          projectId={projectId}
          entityIri={deleteTargetIri}
          accessToken={session?.accessToken}
          branch={activeBranch}
          onAcknowledge={setDeleteImpactAcknowledged}
        />
      </ConfirmDialog>

      <KeyboardShortcutDialog
        open={shortcutDialogOpen}
        onOpenChange={setShortcutDialogOpen}
        shortcuts={keyboardShortcuts}
      />
    </BranchProvider>
  );
}
