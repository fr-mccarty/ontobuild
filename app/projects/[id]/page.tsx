"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import { useParams, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Settings, FileCode, Keyboard, PanelLeftOpen, PanelLeftClose, PanelRightOpen, PanelRightClose, Share2, UserCog } from "lucide-react";
import { Header } from "@/components/layout/header";
import { HomeIconLink, UserSettingsLink } from "@/components/layout/compact-app-links";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AddEntityDialog, type NewEntityInfo } from "@/components/editor/AddEntityDialog";
import { useToast } from "@/lib/context/ToastContext";
import { readSelectionFromSearchParams } from "@/lib/utils/selectionUrl";
import { requestSave } from "@/lib/hooks/useSaveShortcut";
import { StandardEditorLayout } from "@/components/editor/standard/StandardEditorLayout";
import { RevisionHistoryPanel } from "@/components/revision";
import { HealthCheckPanel } from "@/components/editor/HealthCheckPanel";
import { RightSidebar, lintSeverity, LINT_DOT_CLASSES, type LintSeverity } from "@/components/editor/RightSidebar";
import { ToolsPanel } from "@/components/tools/ToolsPanel";
import { AgentPanel } from "@/components/editor/agent/AgentPanel";
import { useAgentEditorSync } from "@/components/editor/agent/useAgentEditorSync";
import { healthQueryKeys, useHealthSummary } from "@/lib/hooks/useHealthSummary";
import { lintQueryKeys } from "@/lib/hooks/useLintSummary";
import type { EntityTab } from "@/components/editor/standard/EntityTabBar";
import type { AgentPageInfo } from "@/lib/agent/pageContext";
import { totalHealthIssues, type AgentHealthSummary } from "@/lib/agent/healthSummary";
import { useEntityCounts } from "@/lib/hooks/useEntityCounts";
import { useSelectionStore } from "@/lib/stores/selectionStore";
import { useQueryClient } from "@tanstack/react-query";
import { BranchProvider, branchQueryKeys } from "@/lib/context/BranchContext";
import { useProjectViewer } from "@/lib/hooks/useProjectViewer";
import { useEditorSidebars } from "@/lib/hooks/useEditorSidebars";
import { useWorkspaceStore } from "@/lib/stores/workspaceStore";
import { RepositoryButton } from "@/components/project/RepositoryButton";
import { RunMenu } from "@/components/workspace/RunMenu";
import { FilesPanel } from "@/components/workspace/FilesPanel";
import { TerminalPanel } from "@/components/workspace/TerminalPanel";
import { revisionsApi } from "@/lib/api/revisions";
import { projectOntologyApi, type ClassUpdatePayload } from "@/lib/api/client";
import { getLocalName } from "@/lib/utils";
import { generateTurtleSnippet } from "@/lib/ontology/turtleSnippetGenerator";
import { parseDeclarations } from "@/lib/ontology/turtleUtils";
import { updateClassInTurtle } from "@/lib/ontology/turtleClassUpdater";
import { updatePropertyInTurtle, type TurtlePropertyUpdateData } from "@/lib/ontology/turtlePropertyUpdater";
import { updateIndividualInTurtle, type TurtleIndividualUpdateData } from "@/lib/ontology/turtleIndividualUpdater";
import { detectPatternFromIriIndex, type IriSuffixPattern } from "@/lib/ontology/iriGeneration";
import { commonPrefixes } from "@/lib/editor/languages/turtle";

import { useKeyboardShortcuts, type ShortcutDefinition } from "@/lib/hooks/useKeyboardShortcuts";
import { KeyboardShortcutDialog } from "@/components/editor/KeyboardShortcutDialog";
import { DeleteImpactAnalysis } from "@/components/editor/DeleteImpactAnalysis";
import { MoreMenu, MORE_MENU_ITEM_CLASSES } from "@/components/editor/MoreMenu";
import { Tooltip } from "@/components/ui/tooltip";
import { OntologyFileMenu, OntologyFilePanel, OntologyLoadError } from "@/components/project/OntologyFile";
import { OntologyLocalChangesNotice } from "@/components/project/OntologyLocalChangesNotice";
import { apiErrorMessage } from "@/lib/api/errors";

const PROJECTS_TOOLTIP = "Projects: return to the list of all projects";

/**
 * "Projects › name › file.ttl ▾": the way back to the project list, the project's title and its
 * ontology file (a menu to switch to another RDF file in the folder or create one).
 */
function ProjectBreadcrumb({
  project,
  ontologyFile,
}: {
  project: { name: string; description?: string | null };
  ontologyFile?: ReactNode;
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Tooltip side="bottom" content={PROJECTS_TOOLTIP}>
        <Link
          href="/"
          className="flex-shrink-0 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Projects
        </Link>
      </Tooltip>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
      <Tooltip side="bottom" content={projectNameTooltip(project)}>
        <h1 aria-current="page" className="min-w-0 truncate text-base font-semibold text-slate-900 dark:text-white">
          {project.name}
        </h1>
      </Tooltip>
      {ontologyFile && (
        <>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
          {ontologyFile}
        </>
      )}
    </nav>
  );
}

/** The Agent button's dot: the worst issue in the Health tab, or null when there's nothing to fix. */
function healthDotSeverity(h: AgentHealthSummary): LintSeverity | null {
  if (h.lint?.errors) return "error";
  if (h.lint?.warnings || h.consistency?.count || h.duplicates?.count) return "warning";
  if (h.lint?.info) return "info";
  return null;
}

function projectNameTooltip(project: { name: string; description?: string | null }): string {
  return project.description
    ? `Project: ${project.name}. ${project.description}`
    : `Project: ${project.name}`;
}

function detectIriSettings(
  sourceContent: string,
  sourceIriIndex: Parameters<typeof detectPatternFromIriIndex>[0],
) {
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

  const namespace: string | undefined = prefixMap.get("") ?? [...internalNamespaces][0];

  let prefix: string | undefined;
  for (const [pfx, ns] of prefixMap) {
    if (ns === namespace && pfx !== "") {
      prefix = pfx;
      break;
    }
  }

  const { pattern, nextNumeric } = detectPatternFromIriIndex(sourceIriIndex, internalNamespaces);
  return { namespace, prefix, pattern, nextNumeric };
}

export default function ProjectEditorPage() {
  const params = useParams();
  const searchParams = useSearchParams();
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
    || (() => { try { return sessionStorage.getItem(`ontobuilder:branch:${projectId}`); } catch { return null; } })()
    || undefined;

  const queryClient = useQueryClient();
  const [activeBranch, setActiveBranch] = useState<string | undefined>(undefined);

  const viewer = useProjectViewer({
    projectId,
    activeBranch,
  });

  const {
    project, isLoading, error,
    openPRCount, lintSummary, normalizationStatus,
    hasOntology,
    nodes, totalClasses, isTreeLoading, treeError,
    selectedIri, loadRootClasses, refreshTree, expandNode, collapseNode, selectNode,
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
  // Below the lg breakpoint only one sidebar shows at a time; from lg up both can (see the hook).
  const { leftOpen, rightOpen: showRightSidebar, setOpen: setSidebarOpen, toggleLeft, toggleRight, closeRight } = useEditorSidebars();
  const openLeft = useCallback(() => setSidebarOpen("left", true), [setSidebarOpen]);
  // "Run as prompt", "Files" and similar actions ask for the right sidebar through the workspace store.
  const rightOpenRequest = useWorkspaceStore((s) => s.rightOpenRequest);
  const handledRightOpenRequest = useRef(rightOpenRequest);
  useEffect(() => {
    if (rightOpenRequest === handledRightOpenRequest.current) return;
    handledRightOpenRequest.current = rightOpenRequest;
    if (!showRightSidebar) toggleRight();
  }, [rightOpenRequest, showRightSidebar, toggleRight]);
  const [leftTab, setLeftTab] = useState<EntityTab>("classes");
  /** The centre panel shows the selected class's relationship graph (opened from the More menu). */
  const [showGraph, setShowGraph] = useState(false);
  const selectionIri = useSelectionStore((s) => s.iri);
  const selectionType = useSelectionStore((s) => s.type);
  const entityNavigationRef = useRef<((iri: string, type?: string) => void) | null>(null);
  const entityRemovalRef = useRef<((iris: string[]) => void) | null>(null);

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
  const [iriDetectionPending, setIriDetectionPending] = useState(true);

  const [detailRefreshKey, setDetailRefreshKey] = useState(0);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetIri, setDeleteTargetIri] = useState<string | null>(null);
  const [deleteTargetLabel, setDeleteTargetLabel] = useState<string>("");
  const [deleteImpactAcknowledged, setDeleteImpactAcknowledged] = useState(true);

  const toast = useToast();

  const [shortcutDialogOpen, setShortcutDialogOpen] = useState(false);

  // Detect the ontology's namespace, prefix and IRI pattern once the source is indexed,
  // and again after each edit marks the detection as pending. Adjusting state while
  // rendering avoids an extra effect pass.
  if (iriDetectionPending && sourceIriIndex.size > 0 && sourceContent) {
    setIriDetectionPending(false);
    const detected = detectIriSettings(sourceContent, sourceIriIndex);
    if (detected.namespace) setOntologyNamespace(detected.namespace);
    if (detected.prefix !== undefined) setOntologyPrefix(detected.prefix);
    setIriPattern(detected.pattern);
    if (detected.nextNumeric !== undefined) setNextNumeric(detected.nextNumeric);
  }

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
      if (!projectId || !activeBranch) return;

      let base: string;
      if (sourceContent) {
        base = sourceContent;
      } else {
        try {
          const response = await revisionsApi.getFileAtVersion(
            projectId,
            activeBranch,
            project?.git_ontology_path
          );
          base = response.content;
        } catch {
          toast.error("Couldn't load the ontology to add the entity");
          return;
        }
      }
      const snippet = generateTurtleSnippet({
        iri: entity.iri,
        label: entity.label,
        entityType: entity.entityType,
        parentIri: entity.parentIri,
        ontologyPrefix,
        ontologyNamespace,
        prefixes: parseDeclarations(base).prefixes,
      });
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
          activeBranch,
        );
      } catch (err) {
        toast.error(`Couldn't add "${entity.label}"`, apiErrorMessage(err));
        return;
      }

      setSourceContent(newContent);
      toast.success(`Added "${entity.label}"`);

      if (entity.entityType === "class") {
        addOptimisticNode(entity.iri, entity.label, entity.parentIri);
      }
      setDetailRefreshKey((k) => k + 1);
      setSourceIriIndex(new Map());
      setIriDetectionPending(true);
      queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId) });
    },
    [ontologyPrefix, ontologyNamespace, addOptimisticNode, sourceContent, projectId, activeBranch, project, toast, setSourceContent, setSourceIriIndex, queryClient],
  );

  const handleCopyIri = useCallback(async (iri: string) => {
    try {
      await navigator.clipboard.writeText(iri);
      toast.success("Copied the IRI");
    } catch {
      toast.error("Couldn't copy the IRI");
    }
  }, [toast]);

  const handleDeleteClass = useCallback((iri: string, label: string) => {
    setDeleteTargetIri(iri);
    setDeleteTargetLabel(label);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTargetIri) return;

    removeOptimisticNode(deleteTargetIri);

    try {
      await projectOntologyApi.deleteClass(
        projectId,
        deleteTargetIri,
        `Delete class ${deleteTargetLabel}`,
        activeBranch
      );
      toast.success(`Deleted "${deleteTargetLabel}"`);
      setSourceContent("");
      loadRootClasses();
      queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId) });
    } catch (err) {
      toast.error(`Couldn't delete "${deleteTargetLabel}"`, apiErrorMessage(err));
      loadRootClasses();
    }
  }, [deleteTargetIri, deleteTargetLabel, projectId, activeBranch, removeOptimisticNode, toast, loadRootClasses, queryClient, setSourceContent]);

  const handleUpdateClass = useCallback(async (classIri: string, data: ClassUpdatePayload) => {
    if (!activeBranch) {
      throw new Error("No branch selected");
    }

    let source = sourceContent;
    if (!source) {
      const response = await revisionsApi.getFileAtVersion(
        projectId,
        activeBranch,
        project?.git_ontology_path,
      );
      source = response.content;
    }

    let previousParents: string[] | null = null;
    try {
      const before = await projectOntologyApi.getClassDetail(projectId, classIri, activeBranch);
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
    setIriDetectionPending(true);
    queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId) });
  }, [projectId, activeBranch, project, sourceContent, toast, updateNodeLabel, queryClient, setSourceContent, setSourceIriIndex, loadRootClasses, navigateToNode]);

  const handleUpdateProperty = useCallback(async (propertyIri: string, data: TurtlePropertyUpdateData) => {
    if (!activeBranch) {
      throw new Error("No branch selected");
    }

    let source = sourceContent;
    if (!source) {
      const response = await revisionsApi.getFileAtVersion(
        projectId,
        activeBranch,
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
      activeBranch,
    );

    setSourceContent(modifiedSource);
    toast.success(`Updated "${label}"`);
    setDetailRefreshKey((k) => k + 1);
    setSourceIriIndex(new Map());
    setIriDetectionPending(true);
    queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId) });
  }, [projectId, activeBranch, project, sourceContent, toast, queryClient, setSourceContent, setSourceIriIndex]);

  const handleUpdateIndividual = useCallback(async (individualIri: string, data: TurtleIndividualUpdateData) => {
    if (!activeBranch) {
      throw new Error("No branch selected");
    }

    let source = sourceContent;
    if (!source) {
      const response = await revisionsApi.getFileAtVersion(
        projectId,
        activeBranch,
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
      activeBranch,
    );

    setSourceContent(modifiedSource);
    toast.success(`Updated "${label}"`);
    setDetailRefreshKey((k) => k + 1);
    setSourceIriIndex(new Map());
    setIriDetectionPending(true);
    queryClient.invalidateQueries({ queryKey: branchQueryKeys.list(projectId) });
  }, [projectId, activeBranch, project, sourceContent, toast, queryClient, setSourceContent, setSourceIriIndex]);

  const handleReparentClass = useCallback(async (
    classIri: string,
    _oldParentIris: string[],
    newParentIris: string[],
    mode: "move" | "add",
  ) => {
    const detail = await projectOntologyApi.getClassDetail(projectId, classIri, activeBranch);

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
  }, [projectId, activeBranch, handleUpdateClass]);

  const handleBranchChange = useCallback((branchName: string) => {
    setActiveBranch(branchName);
    resetSourceState();
    // The branch notifier also calls this with the initial branch on every mount, so leave
    // the URL alone when it already names the branch. Otherwise update it in place: a
    // router.replace() would fetch the page from the server, and when that fetch fails Next
    // falls back to a full reload, which remounts the page and loops.
    const next = new URLSearchParams(window.location.search);
    if (next.get("branch") === branchName) return;
    next.set("branch", branchName);
    window.history.replaceState(null, "", `${pathname}?${next.toString()}`);
  }, [pathname, resetSourceState]);

  // Keep the editor in step with the agent: refresh after its changes, select on request.
  // (useAgentEditorSync reads these callbacks through a ref, so they need no memoization.)
  const reloadSourceAfterAgent = async () => {
    if (!activeBranch) {
      resetSourceState();
      return;
    }
    try {
      const response = await revisionsApi.getFileAtVersion(
        projectId,
        activeBranch,
        project?.git_ontology_path,
      );
      // Same path as the editor's own saves: new source, re-index, re-detect IRI settings.
      setSourceContent(response.content);
      setSourceIriIndex(new Map());
      setIriDetectionPending(true);
    } catch {
      resetSourceState();
    }
  };

  // Imports and GitHub pulls change ontology.ttl outside the editor. The editor saves by rewriting
  // its cached source, so reload it (and the tree) or the next save would undo those changes.
  const reloadOntologyFromServer = () => {
    void reloadSourceAfterAgent();
    void refreshTree();
    setDetailRefreshKey((k) => k + 1);
  };

  const agentSync = useAgentEditorSync({
    projectId,
    activeBranch,
    refreshTree,
    reloadSource: reloadSourceAfterAgent,
    refreshDetail: () => setDetailRefreshKey((k) => k + 1),
    entityNavigationRef,
    entityRemovalRef,
    navigateToNode,
  });

  const { data: healthSummary = null } = useHealthSummary(projectId, activeBranch);
  const refreshHealthSummaries = () => {
    void queryClient.invalidateQueries({ queryKey: healthQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: lintQueryKeys.summary(projectId) });
  };

  // The project switched to another ontology file (here, in settings or by the agent): what the
  // editor holds belongs to the old file. Drop the source, selection and tree, and refetch the
  // project's queries. The entity panels remount through their key.
  const ontologyPath = project ? (project.source_file_path ? (project.git_ontology_path ?? null) : null) : undefined;
  const [shownOntologyPath, setShownOntologyPath] = useState(ontologyPath);
  if (ontologyPath !== undefined && ontologyPath !== shownOntologyPath) {
    setShownOntologyPath(ontologyPath);
    if (shownOntologyPath !== undefined) {
      setIriDetectionPending(true);
      setDetailRefreshKey((k) => k + 1);
    }
  }
  const shownOntologyPathRef = useRef(ontologyPath);
  useEffect(() => {
    const previous = shownOntologyPathRef.current;
    if (ontologyPath === undefined) return;
    shownOntologyPathRef.current = ontologyPath;
    if (previous === undefined || previous === ontologyPath) return;
    useSelectionStore.getState().clear();
    resetSourceState();
    void loadRootClasses();
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes(projectId) });
    void queryClient.invalidateQueries({ queryKey: healthQueryKeys.all });
  }, [ontologyPath, projectId, queryClient, resetSourceState, loadRootClasses]);

  const agentPageInfo = useMemo((): AgentPageInfo => ({
    projectId,
    health: healthSummary,
    projectName: project?.name,
    branch: activeBranch,
    ontologyFile: ontologyPath,
    leftTab,
    selectedEntity: selectionIri && selectionType
      ? {
          iri: selectionIri,
          type: selectionType,
          label: selectionType === "class" && selectedNodeFallback?.iri === selectionIri ? selectedNodeFallback.label : null,
        }
      : null,
  }), [projectId, project?.name, activeBranch, ontologyPath, leftTab, selectionIri, selectionType, selectedNodeFallback, healthSummary]);

  // Until the health summary loads, fall back to the lint counts the sidebar already has.
  const healthIssueCount = healthSummary ? totalHealthIssues(healthSummary) : (lintSummary?.total_issues ?? 0);
  const agentDotSeverity = healthSummary ? healthDotSeverity(healthSummary) : lintSeverity(lintSummary);
  const { data: entityCountsData } = useEntityCounts(projectId, activeBranch, agentSync.entityListRefreshKey);
  const entityCounts = useMemo(() => {
    const counts: Partial<Record<EntityTab, number>> = {};
    if (!isTreeLoading) counts.classes = totalClasses;
    if (entityCountsData) {
      counts.properties = entityCountsData.properties;
      counts.individuals = entityCountsData.individuals;
    }
    return counts;
  }, [isTreeLoading, totalClasses, entityCountsData]);
  const showNormalize = !!normalizationStatus?.needs_normalization;
  // With normalization recommended, land on the Normalization card, where the warning and its action are.
  const canShowGraph = leftTab === "classes" && !!selectedIri;
  const settingsHref = `/projects/${projectId}/settings${activeBranch ? `?branch=${encodeURIComponent(activeBranch)}` : ""}${
    showNormalize ? "#normalization" : ""
  }`;

  const keyboardShortcuts = useMemo((): ShortcutDefinition[] => [
    {
      id: "save",
      key: "s",
      modifiers: { ctrl: true },
      description: "Save",
      category: "Editing",
      action: () => {
        // Blur first so the focused field records its value, then the panel being edited commits.
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        requestSave();
      },
      global: true,
      ignoreWhenEditorFocused: true,
    },
    {
      id: "add-entity",
      key: "n",
      modifiers: { ctrl: true },
      description: "Add new entity",
      category: "Editing",
      action: () => handleAddEntity(),
      global: true,
    },
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
          closeRight();
        }
      },
      global: true,
      ignoreWhenEditorFocused: false,
    },
  ], [handleAddEntity, shortcutDialogOpen, showHistory, showRightSidebar, closeRight]);

  useKeyboardShortcuts(keyboardShortcuts);

  if (isLoading) {
    // No main header: the editor brings its own top row once loaded, so showing one now would only flash.
    return (
      <>
        <main id="main-content" className="min-h-dvh bg-slate-50 dark:bg-slate-900">
          <div className="flex h-dvh items-center justify-center">
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

  if (!hasOntology) {
    return (
      <>
        <main id="main-content" className="min-h-dvh bg-slate-100 dark:bg-slate-900">
          <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <HomeIconLink />
                <ProjectBreadcrumb project={project} />
              </div>
              <div className="flex items-center gap-1">
              <UserSettingsLink />
              <Tooltip side="bottom" content="Project settings: settings for this project only (ontology file, imports, GitHub, normalization, lint rules)">
                <Link href={`/projects/${projectId}/settings`} aria-label="Project settings">
                  <Button variant="ghost" size="sm" tabIndex={-1} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                    <Settings className="h-4 w-4" />
                  </Button>
                </Link>
              </Tooltip>
              </div>
            </div>
          </div>
          <div className="flex min-h-[calc(100dvh-3.5rem)] justify-center overflow-y-auto px-4 py-12">
            <div className="w-full max-w-xl">
              <div className="text-center">
                <FileCode className="mx-auto h-16 w-16 text-slate-400" />
                <h2 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">No Ontology File</h2>
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                  This project doesn&apos;t have an ontology file yet.
                </p>
              </div>
              <OntologyFilePanel
                className="mt-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
                projectId={projectId}
                branch={resumeBranchParam}
                projectName={project.name}
                currentIri={project.ontology_iri}
                intro={
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Choose an RDF file from the project folder to use as the project&apos;s ontology, or create a new, empty
                    ontology. The project edits one ontology file at a time; you can switch later from the menu next to the
                    project name.
                  </p>
                }
              />
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <BranchProvider projectId={projectId} initialBranch={initialBranch}>
      {/* No main header here: the editor's own top row carries the home icon, and user settings is in the More menu. Fills the window; the panes below share the rest so nothing spills past the bottom. */}
      <main id="main-content" className="flex h-dvh flex-col overflow-hidden bg-slate-100 dark:bg-slate-900">
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-2 py-3 sm:px-4 dark:border-slate-700 dark:bg-slate-800">
          {/* One line at every width: rarely used controls live in the ⋮ More menu. */}
          <div data-testid="editor-sub-header" className="flex flex-nowrap items-center justify-between gap-2 sm:gap-4">
            <div className="flex min-w-0 flex-nowrap items-center gap-2 sm:gap-4">
              <HomeIconLink />
              <Tooltip
                side="bottom"
                content={
                  leftOpen
                    ? "Hide the entity tree: the classes, properties and individuals list"
                    : "Show the entity tree: browse classes, properties and individuals"
                }
              >
                <Button
                  variant={leftOpen ? "secondary" : "ghost"}
                  size="sm"
                  onClick={toggleLeft}
                  aria-label="Entity tree"
                  aria-pressed={leftOpen}
                  className="-my-1 flex-shrink-0 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  {leftOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                </Button>
              </Tooltip>
              <ProjectBreadcrumb
                project={project}
                ontologyFile={
                  <OntologyFileMenu
                    projectId={projectId}
                    branch={activeBranch}
                    enabled={!!activeBranch}
                    activePath={ontologyPath}
                    projectName={project.name}
                    currentIri={project.ontology_iri}
                  />
                }
              />
            </div>
            <div className="ml-auto flex flex-shrink-0 flex-nowrap items-center justify-end gap-1 sm:gap-2">
              <RunMenu projectId={projectId} />
              <RepositoryButton
                projectId={projectId}
                onBranchChange={handleBranchChange}
                onPulled={reloadOntologyFromServer}
                historyOpen={showHistory}
                onToggleHistory={() => setShowHistory(!showHistory)}
                openPRCount={openPRCount}
              />

              <Tooltip
                side="bottom"
                content={`Project settings: project details, imports, GitHub, normalization, lint rules and pull requests${
                  showNormalize ? ". Normalization recommended: the ontology file isn't in canonical Turtle format" : ""
                }`}
              >
                <Link href={settingsHref} aria-label="Project settings" className="hidden sm:inline-flex">
                  <Button variant="ghost" size="sm" tabIndex={-1} className="relative text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                    <Settings className="h-4 w-4" />
                    {showNormalize && (
                      <span
                        data-testid="settings-normalize-dot"
                        className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-800"
                      />
                    )}
                  </Button>
                </Link>
              </Tooltip>

              <MoreMenu>
                {(closeMenu) => (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      aria-keyshortcuts="?"
                      className={MORE_MENU_ITEM_CLASSES}
                      onClick={() => {
                        setShortcutDialogOpen(true);
                        closeMenu();
                      }}
                    >
                      <Keyboard className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="flex-1">Keyboard shortcuts</span>
                      <kbd className="text-xs text-slate-400" aria-hidden>?</kbd>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canShowGraph}
                      className={`${MORE_MENU_ITEM_CLASSES} disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`}
                      onClick={() => {
                        setShowGraph(true);
                        closeMenu();
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="flex-1">Relationship graph</span>
                      {!canShowGraph && <span className="text-xs text-slate-400" aria-hidden>Select a class</span>}
                    </button>
                    <Link
                      href={settingsHref}
                      role="menuitem"
                      className={`${MORE_MENU_ITEM_CLASSES} sm:hidden`}
                      onClick={closeMenu}
                    >
                      <Settings className="h-3.5 w-3.5 flex-shrink-0" />
                      Project settings
                      {showNormalize && <span className="ml-auto h-2 w-2 rounded-full bg-amber-500" aria-label="normalization recommended" role="img" />}
                    </Link>
                    <Link href="/settings" role="menuitem" className={MORE_MENU_ITEM_CLASSES} onClick={closeMenu}>
                      <UserCog className="h-3.5 w-3.5 flex-shrink-0" />
                      User settings
                    </Link>
                  </>
                )}
              </MoreMenu>
              <Tooltip
                side="bottom"
                content={
                  showRightSidebar
                    ? "Hide the side panel (shortcut: Esc)"
                    : `Show the side panel: Agent, Health, Files and Tools${
                        healthIssueCount > 0 ? ` (${healthIssueCount} health issue${healthIssueCount === 1 ? "" : "s"})` : ""
                      }`
                }
              >
                <Button
                  variant={showRightSidebar ? "secondary" : "ghost"}
                  size="sm"
                  onClick={toggleRight}
                  aria-label={
                    !showRightSidebar && healthIssueCount > 0 ? `Side panel (${healthIssueCount} health issues)` : "Side panel"
                  }
                  aria-pressed={showRightSidebar}
                  className="relative -my-1 flex-shrink-0 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  {showRightSidebar ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                  {!showRightSidebar && agentDotSeverity && (
                    <span
                      data-testid="right-sidebar-lint-dot"
                      className={`absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-white dark:ring-slate-800 ${LINT_DOT_CLASSES[agentDotSeverity]}`}
                    />
                  )}
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>

        <OntologyLocalChangesNotice
          projectId={projectId}
          activeBranch={activeBranch}
          onCommitted={() => {
            reloadOntologyFromServer();
            void queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes(projectId) });
          }}
        />

        <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1">
          <div className="flex-1 flex overflow-hidden">
            <StandardEditorLayout
              key={ontologyPath ?? ""}
              projectId={projectId}
              activeBranch={activeBranch}
              canEdit
              entityNavigationRef={entityNavigationRef}
              entityRemovalRef={entityRemovalRef}
              entityListRefreshKey={agentSync.entityListRefreshKey}
              entityCounts={entityCounts}
              detailEpoch={agentSync.detailEpoch}
              nodes={nodes}
              isTreeLoading={isTreeLoading}
              treeError={treeError}
              renderTreeError={(message) => (
                <OntologyLoadError
                  message={message}
                  projectId={projectId}
                  branch={activeBranch}
                  enabled={!!activeBranch}
                  projectName={project.name}
                  currentIri={project.ontology_iri}
                />
              )}
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
              treePanelOpen={leftOpen}
              onRequestTreePanel={openLeft}
              showGraph={showGraph}
              onShowGraphChange={setShowGraph}
            />
          </div>

          {showRightSidebar && (
            <RightSidebar
              onClose={closeRight}
              lintSummary={lintSummary}
              agent={
                <AgentPanel
                  pageInfo={agentPageInfo}
                  onProjectChanged={agentSync.onProjectChanged}
                  onOntologyChanged={agentSync.onOntologyChanged}
                  onUiAction={agentSync.onUiAction}
                />
              }
              files={(isActive) => <FilesPanel projectId={projectId} isActive={isActive} />}
              tools={(isActive) => <ToolsPanel projectId={projectId} isActive={isActive} />}
              health={(isActive) => (
                <div className="min-h-0 flex-1">
                  <HealthCheckPanel
                    key={`${agentSync.sidePanelsRefreshKey}:${ontologyPath ?? ""}`}
                    projectId={projectId}
                    branch={activeBranch}
                    isOpen={isActive}
                    embedded
                    onClose={closeRight}
                    onNavigateToClass={(iri, subjectType) => {
                      if (entityNavigationRef.current) {
                        entityNavigationRef.current(iri, subjectType);
                      } else {
                        navigateToNode(iri);
                      }
                    }}
                    canRunLint
                    onResultsChanged={refreshHealthSummaries}
                  />
                </div>
              )}
            />
          )}

          <RevisionHistoryPanel
            projectId={projectId}
            isOpen={showHistory}
            onClose={() => setShowHistory(false)}
            refreshKey={agentSync.sidePanelsRefreshKey}
          />
        </div>
        <TerminalPanel projectId={projectId} />
        </div>
      </main>

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
