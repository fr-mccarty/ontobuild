"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  ExternalLink,
  AlertTriangle,
  Info,
  Tag,
  MessageSquare,
  BookOpen,
  ArrowUp,
  FileText,
  XCircle,
  Clock,
  Copy,
  Plus,
  Trash2,
  Equal,
  Ban,
  ArrowDown,
  Star,
  Tags,
  EyeOff,
  Lightbulb,
  StickyNote,
  Hash,
  Link2,
} from "lucide-react";
import { IndividualIcon } from "@/components/editor/shared/IndividualIcon";
import { DisclosureSection } from "@/components/editor/shared/Disclosure";
import { projectOntologyApi, type OWLClassDetail, type ClassUpdatePayload, type AnnotationUpdate } from "@/lib/api/client";
import type { LocalizedString } from "@/lib/api/client";
import { lintApi, type LintIssue } from "@/lib/api/lint";
import { cn, getLocalName, getPreferredLabel } from "@/lib/utils";
import { EntityTypeIcon } from "@/components/editor/shared/EntityTypeIcon";
import { ParentClassPicker } from "@/components/editor/ParentClassPicker";
import { AnnotationRow } from "@/components/editor/standard/AnnotationRow";
import { COMMENT_ROWS } from "@/components/editor/standard/commentRows";
import { sectionHelp } from "@/lib/editor/sectionHelp";
import { InlineAnnotationAdder } from "@/components/editor/standard/InlineAnnotationAdder";
import { RelationshipSection, type RelationshipGroup, type RelationshipTarget } from "@/components/editor/standard/RelationshipSection";
import { LABEL_IRI, COMMENT_IRI, DEFINITION_IRI, RELATIONSHIP_PROPERTY_IRIS, SEE_ALSO_IRI, getAnnotationPropertyInfo } from "@/lib/ontology/annotationProperties";
import { AutoSaveAffordanceBar } from "@/components/editor/AutoSaveAffordanceBar";
import { CrossReferencesPanel } from "@/components/editor/CrossReferencesPanel";
import { EntityHistoryTab } from "@/components/editor/EntityHistoryTab";
import { useAutoSave } from "@/lib/hooks/useAutoSave";
import { useToast } from "@/lib/context/ToastContext";
import { Tooltip } from "@/components/ui/tooltip";
import type { ImportedMarker } from "@/lib/ontology/types";
import { useSaveShortcut } from "@/lib/hooks/useSaveShortcut";
import { ClassRulesSection } from "@/components/editor/rules/ClassRulesSection";

export function ensureTrailingEmpty(arr: LocalizedString[]): LocalizedString[] {
  if (arr.length === 0 || arr[arr.length - 1].value.trim() !== "") {
    return [...arr, { value: "" }];
  }
  return arr;
}

export interface TreeNodeFallback {
  label: string;
  iri: string;
  parentIri?: string;
  parentLabel?: string;
}

interface ClassDetailPanelProps {
  projectId: string;
  classIri: string | null;
  branch?: string;
  onNavigateToClass?: (iri: string) => void;
  onCopyIri?: (iri: string) => void;
  selectedNodeFallback?: TreeNodeFallback | null;
  canEdit?: boolean;
  onUpdateClass?: (classIri: string, data: ClassUpdatePayload) => Promise<void>;
  onAddIndividual?: (classIri: string) => void;
  onNavigateToIndividual?: (iri: string) => void;
  refreshKey?: number;
  headerActions?: ReactNode;
  onRulesChanged?: () => void | Promise<void>;
}

export function ClassDetailPanel({
  projectId,
  classIri,
  branch,
  onNavigateToClass,
  onCopyIri,
  selectedNodeFallback,
  canEdit,
  onUpdateClass,
  onAddIndividual,
  onNavigateToIndividual,
  refreshKey,
  headerActions,
  onRulesChanged,
}: ClassDetailPanelProps) {
  const [classDetail, setClassDetail] = useState<OWLClassDetail | null>(null);
  // A class from an imported ontology (owl:imports) is shown read-only.
  const importedMarker = classDetail as (OWLClassDetail & ImportedMarker) | null;
  const importedFrom = importedMarker?.imported_from;
  const editable = !!canEdit && !importedFrom;
  const [classIssues, setClassIssues] = useState<LintIssue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedTargetLabels, setResolvedTargetLabels] = useState<Record<string, string>>({});

  const [isEditing, setIsEditing] = useState(false);

  const [editLabels, setEditLabels] = useState<LocalizedString[]>([]);
  const [editComments, setEditComments] = useState<LocalizedString[]>([]);
  const [editParentIris, setEditParentIris] = useState<string[]>([]);
  const [editParentLabels, setEditParentLabels] = useState<Record<string, string>>({});
  const [editAnnotations, setEditAnnotations] = useState<AnnotationUpdate[]>([]);
  const [editRelationships, setEditRelationships] = useState<RelationshipGroup[]>([]);
  const [showParentPicker, setShowParentPicker] = useState(false);

  const editInitializedRef = useRef(false);

  const toast = useToast();

  const {
    saveStatus,
    saveError,
    validationError,
    triggerSave,
    flushToGit,
    discardDraft,
    editStateRef,
    restoredDraft,
    clearRestoredDraft,
  } = useAutoSave({
    projectId,
    branch: branch || "main",
    classIri,
    classDetail,
    canEdit: editable && !!onUpdateClass,
    onUpdateClass,
    onError: (msg) => toast.error("Couldn't save your changes", msg),
  });

  useEffect(() => {
    if (!isEditing) return;
    editStateRef.current = {
      labels: editLabels,
      comments: editComments,
      parentIris: editParentIris,
      parentLabels: editParentLabels,
      annotations: editAnnotations,
      relationships: editRelationships,
    };
  }, [isEditing, editLabels, editComments, editParentIris, editParentLabels, editAnnotations, editRelationships, editStateRef]);

  useEffect(() => {
    if (!isEditing) {
      editStateRef.current = null;
    }
  }, [isEditing, editStateRef]);

  const flushToGitRef = useRef(flushToGit);
  useEffect(() => {
    flushToGitRef.current = flushToGit;
  }, [flushToGit]);
  useEffect(() => {
    return () => {
      flushToGitRef.current();
    };
  }, []);

  const initEditState = useCallback((detail: OWLClassDetail) => {
    setEditLabels(detail.labels.length > 0 ? detail.labels.map((l) => ({ ...l })) : [{ value: "" }]);
    setEditComments(ensureTrailingEmpty(detail.comments.map((c) => ({ ...c }))));
    setEditParentIris([...detail.parent_iris]);
    setEditParentLabels({ ...detail.parent_labels });

    const allAnnotations = detail.annotations || [];
    const regularAnnotations: AnnotationUpdate[] = [];
    const relationships: RelationshipGroup[] = [];

    for (const a of allAnnotations) {
      if (RELATIONSHIP_PROPERTY_IRIS.has(a.property_iri)) {
        const propInfo = getAnnotationPropertyInfo(a.property_iri);
        relationships.push({
          property_iri: a.property_iri,
          property_label: propInfo.displayLabel,
          targets: a.values
            .filter((v) => v.value.trim())
            .map((v) => ({ iri: v.value, label: resolvedTargetLabels[v.value] || getLocalName(v.value) })),
        });
      } else {
        regularAnnotations.push({
          property_iri: a.property_iri,
          values: ensureTrailingEmpty(a.values.map((v) => ({ ...v }))),
        });
      }
    }

    if (!regularAnnotations.find((a) => a.property_iri === DEFINITION_IRI)) {
      regularAnnotations.unshift({ property_iri: DEFINITION_IRI, values: [{ value: "" }] });
    }

    if (relationships.length === 0) {
      relationships.push({ property_iri: SEE_ALSO_IRI, property_label: "See Also", targets: [] });
    }

    setEditAnnotations(regularAnnotations);
    setEditRelationships(relationships);
  }, [resolvedTargetLabels]);

  const enterEditMode = useCallback(() => {
    if (!classDetail) return;
    initEditState(classDetail);
    editInitializedRef.current = true;
    setIsEditing(true);
  }, [classDetail, initEditState]);

  const cancelEditMode = useCallback(() => {
    discardDraft();
    editStateRef.current = null;
    if (classDetail) {
      initEditState(classDetail);
    }
    setShowParentPicker(false);
  }, [classDetail, discardDraft, initEditState, editStateRef]);

  const flushDraftToGit = useCallback(async () => {
    triggerSave();
    await flushToGit();
  }, [triggerSave, flushToGit]);
  useSaveShortcut(isEditing, flushDraftToGit);

  useEffect(() => {
    if (isEditing || editInitializedRef.current) return;
    if (!editable || !onUpdateClass || !classDetail) return;

    if (restoredDraft && classIri) {
      setEditLabels(restoredDraft.labels.length > 0 ? restoredDraft.labels : [{ value: "" }]);
      setEditComments(ensureTrailingEmpty(restoredDraft.comments));
      setEditParentIris(restoredDraft.parentIris);
      setEditParentLabels(restoredDraft.parentLabels);
      setEditAnnotations(restoredDraft.annotations);
      setEditRelationships(restoredDraft.relationships);
      editInitializedRef.current = true;
      setIsEditing(true);
      clearRestoredDraft();
      return;
    }

    enterEditMode();
  }, [classDetail, editable, restoredDraft, classIri, clearRestoredDraft, onUpdateClass, isEditing, enterEditMode]);

  useEffect(() => {
    if (!classIri) {
      setClassDetail(null);
      setClassIssues([]);
      return;
    }

    let cancelled = false;
    const fetchClassData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [detail, issuesResponse] = await Promise.all([
          projectOntologyApi.getClassDetail(projectId, classIri, branch),
          lintApi.getIssues(projectId, { subject_iri: classIri, limit: 50 }).catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setClassDetail(detail);
        setClassIssues(issuesResponse.items);
      } catch (err) {
        if (cancelled) return;
        const is404 = err instanceof Error &&
          (err.message.includes("Class not found") || err.message.includes("404"));

        if (is404 && selectedNodeFallback?.iri === classIri) {
          setError(null);
        } else if (is404) {
          const localName = getLocalName(classIri);
          setError(`Could not load "${localName}" as an OWL Class, or a Property, or an Individual.`);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load class details");
        }
        setClassDetail(null);
        setClassIssues([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchClassData();
    return () => {
      cancelled = true;
    };
  }, [projectId, classIri, branch, selectedNodeFallback, refreshKey]);

  useEffect(() => {
    if (!classDetail?.annotations) return;

    const targetIris: string[] = [];
    for (const a of classDetail.annotations) {
      if (RELATIONSHIP_PROPERTY_IRIS.has(a.property_iri)) {
        for (const v of a.values) {
          if (v.value.trim() && !resolvedTargetLabels[v.value]) {
            targetIris.push(v.value);
          }
        }
      }
    }

    if (targetIris.length === 0) return;

    let cancelled = false;
    const resolveLabels = async () => {
      const newLabels: Record<string, string> = {};
      await Promise.all(
        targetIris.map(async (iri) => {
          try {
            const detail = await projectOntologyApi.getClassDetail(projectId, iri, branch);
            const label = getPreferredLabel(detail.labels);
            if (label) { newLabels[iri] = label; return; }
          } catch {
          }
          try {
            const localName = getLocalName(iri);
            const searchResult = await projectOntologyApi.searchEntities(projectId, localName, branch);
            const match = searchResult.results.find((r) => r.iri === iri);
            if (match?.label) newLabels[iri] = match.label;
          } catch {
          }
        }),
      );
      if (!cancelled && Object.keys(newLabels).length > 0) {
        setResolvedTargetLabels((prev) => ({ ...prev, ...newLabels }));
      }
    };

    resolveLabels();
    return () => { cancelled = true; };
  }, [classDetail, projectId, branch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isEditing || Object.keys(resolvedTargetLabels).length === 0) return;
    setEditRelationships((prev) =>
      prev.map((g) => ({
        ...g,
        targets: g.targets.map((t) => {
          const resolved = resolvedTargetLabels[t.iri];
          return resolved && resolved !== t.label ? { ...t, label: resolved } : t;
        }),
      })),
    );
  }, [resolvedTargetLabels, isEditing]);

  const updateLabel = useCallback((index: number, newVal: string) => {
    setEditLabels((prev) => prev.map((l, i) => (i === index ? { ...l, value: newVal } : l)));
  }, []);

  const removeLabel = useCallback((index: number) => {
    setEditLabels((prev) => prev.filter((_, i) => i !== index));
    requestAnimationFrame(() => triggerSave());
  }, [triggerSave]);

  const updateComment = useCallback((index: number, newVal: string) => {
    setEditComments((prev) => {
      const updated = prev.map((c, i) => (i === index ? { ...c, value: newVal } : c));
      return ensureTrailingEmpty(updated);
    });
  }, []);

  const removeComment = useCallback((index: number) => {
    setEditComments((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return ensureTrailingEmpty(updated);
    });
    requestAnimationFrame(() => triggerSave());
  }, [triggerSave]);

  const addParent = useCallback((iri: string, label: string) => {
    setEditParentIris((prev) => [...prev, iri]);
    setEditParentLabels((prev) => ({ ...prev, [iri]: label }));
    requestAnimationFrame(() => triggerSave());
  }, [triggerSave]);

  const removeParent = useCallback((iri: string) => {
    setEditParentIris((prev) => prev.filter((p) => p !== iri));
    requestAnimationFrame(() => triggerSave());
  }, [triggerSave]);

  const updateAnnotationValue = useCallback(
    (propertyIri: string, valueIdx: number, newVal: string) => {
      setEditAnnotations((prev) =>
        prev.map((a) => {
          if (a.property_iri !== propertyIri) return a;
          const updated = a.values.map((v, vi) => (vi === valueIdx ? { ...v, value: newVal } : v));
          return { ...a, values: ensureTrailingEmpty(updated) };
        })
      );
    },
    []
  );

  const removeAnnotationValue = useCallback(
    (propertyIri: string, valueIdx: number) => {
      setEditAnnotations((prev) =>
        prev.map((a) => {
          if (a.property_iri !== propertyIri) return a;
          const filtered = a.values.filter((_, vi) => vi !== valueIdx);
          return { ...a, values: ensureTrailingEmpty(filtered) };
        })
      );
      requestAnimationFrame(() => triggerSave());
    },
    [triggerSave]
  );

  const addRelationshipTarget = useCallback((groupIdx: number, target: RelationshipTarget) => {
    setEditRelationships((prev) =>
      prev.map((g, i) =>
        i === groupIdx ? { ...g, targets: [...g.targets, target] } : g
      )
    );
    requestAnimationFrame(() => triggerSave());
  }, [triggerSave]);

  const removeRelationshipTarget = useCallback((groupIdx: number, targetIdx: number) => {
    setEditRelationships((prev) =>
      prev.map((g, i) =>
        i === groupIdx ? { ...g, targets: g.targets.filter((_, ti) => ti !== targetIdx) } : g
      )
    );
    requestAnimationFrame(() => triggerSave());
  }, [triggerSave]);

  const changeRelationshipProperty = useCallback((groupIdx: number, newIri: string, newLabel: string) => {
    setEditRelationships((prev) =>
      prev.map((g, i) =>
        i === groupIdx ? { ...g, property_iri: newIri, property_label: newLabel } : g
      )
    );
    requestAnimationFrame(() => triggerSave());
  }, [triggerSave]);

  const addRelationshipGroup = useCallback(() => {
    setEditRelationships((prev) => [
      ...prev,
      { property_iri: SEE_ALSO_IRI, property_label: "See Also", targets: [] },
    ]);
  }, []);

  if (!classIri) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <Info className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            Select a class from the tree to view its details
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center dark:border-red-900/50 dark:bg-red-900/20">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
          <p className="mt-2 text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!classDetail && selectedNodeFallback?.iri === classIri) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="border-b border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center">
              <EntityTypeIcon type="class" className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {selectedNodeFallback.label}
                <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                  <Clock className="mr-1 h-3 w-3" />
                  Unsaved
                </span>
              </h2>
              <Tooltip content={classIri}>
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                  {classIri}
                </p>
              </Tooltip>
            </div>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <Section title="Primary Label" tooltip="rdfs:label" icon={<Tag className="h-4 w-4" />}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-700 dark:text-slate-300">{selectedNodeFallback.label}</span>
            </div>
          </Section>
          {selectedNodeFallback.parentIri && (
            <Section title="Parent Class(es)" tooltip="rdfs:subClassOf" icon={<ArrowUp className="h-4 w-4" />}>
              <IriLink
                iri={selectedNodeFallback.parentIri}
                label={selectedNodeFallback.parentLabel}
                onClick={onNavigateToClass}
              />
            </Section>
          )}
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/10">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              This entity has not been saved yet. Save your changes to persist it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!classDetail) {
    return null;
  }

  const displayLabel = getPreferredLabel(classDetail.labels) || getLocalName(classDetail.iri);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="shrink-0 border-b border-slate-200 p-4 dark:border-slate-700">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center">
              <EntityTypeIcon type="class" className="h-7 w-7" />
            </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                {displayLabel}
                {classDetail.deprecated && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    Deprecated
                  </span>
                )}
              </h2>
              <div className="flex shrink-0 items-center gap-2">
                {isEditing && (
                  <AutoSaveAffordanceBar
                    status={saveStatus}
                    error={saveError}
                    validationError={validationError}
                    onRetry={() => flushToGit()}
                    onManualSave={flushDraftToGit}
                    onCancel={cancelEditMode}
                  />
                )}
                {headerActions}
              </div>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Tooltip content={classDetail.iri}>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {classDetail.iri}
                </p>
              </Tooltip>
              {onCopyIri && (
                <Tooltip content="Copy IRI">
                  <button
                    onClick={() => onCopyIri(classDetail.iri)}
                    className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                    aria-label="Copy IRI"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>

      {importedFrom && (
        <div
          className="flex shrink-0 items-start gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
          role="note"
          data-testid="imported-class-note"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Imported from{" "}
            <span className="font-medium">{importedMarker?.imported_from_label || importedFrom}</span>
            {importedMarker?.imported_from_label && <span className="text-slate-400"> ({importedFrom})</span>}
            . It is read-only here; edit it in its own ontology.
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">

        <div className="p-4 space-y-3">
          {classIssues.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/10">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                Health Issues ({classIssues.length})
              </h3>
              <div className="space-y-2">
                {classIssues.map((issue) => (
                  <IssueItem key={issue.id} issue={issue} />
                ))}
              </div>
            </div>
          )}

          {isEditing ? (
            <Section title="Primary Label" tooltip="rdfs:label" icon={<Tag className="h-4 w-4" />}>
              <div className="space-y-2">
                {editLabels.map((label, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={label.value}
                      onChange={(e) => updateLabel(index, e.target.value)}
                      onBlur={() => triggerSave()}
                      placeholder="Label text"
                      className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-hidden focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                    />
                    {editLabels.length > 1 ? (
                      <Tooltip content="Remove label">
                        <button
                          onClick={() => removeLabel(index)}
                          className="rounded-sm p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                          aria-label="Remove label"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                    ) : (
                      <div className="rounded-sm p-1">
                        <div className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          ) : classDetail.labels.length > 0 ? (
            <Section title="Primary Label" tooltip="rdfs:label" icon={<Tag className="h-4 w-4" />}>
              <div className="space-y-1">
                {classDetail.labels.map((label, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="text-sm text-slate-700 dark:text-slate-300">{label.value}</span>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {(() => {
            const defAnnotation = isEditing
              ? editAnnotations.find((a) => a.property_iri === DEFINITION_IRI)
              : classDetail.annotations?.find((a) => a.property_iri === DEFINITION_IRI);

            if (isEditing) {
              const defValues = defAnnotation?.values || [];
              return (
                <Section title="Definition" tooltip="skos:definition" icon={<BookOpen className="h-4 w-4" />}>
                  <div className="space-y-2">
                    {defValues.map((val, vIdx) => {
                      const isGhost = vIdx === defValues.length - 1 && val.value.trim() === "";
                      return (
                        <AnnotationRow
                          key={vIdx}
                          propertyIri={DEFINITION_IRI}
                          value={val.value}
                          onValueChange={(v) => updateAnnotationValue(DEFINITION_IRI, vIdx, v)}
                          onRemove={isGhost ? undefined : () => removeAnnotationValue(DEFINITION_IRI, vIdx)}
                          onBlur={() => triggerSave()}
                          showPropertyLabel={false}
                          placeholder={isGhost ? (defValues.length > 1 ? "Add another definition" : "Add a definition") : undefined}
                        />
                      );
                    })}
                  </div>
                </Section>
              );
            }

            if (defAnnotation && defAnnotation.values.length > 0) {
              return (
                <Section title="Definition" tooltip="skos:definition" icon={<BookOpen className="h-4 w-4" />}>
                  <div className="space-y-1">
                    {defAnnotation.values.map((val, vIndex) => (
                      <div key={vIndex} className="flex items-start gap-2">
                        <span className="text-sm text-slate-700 dark:text-slate-300">{val.value}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              );
            }

            return null;
          })()}

          {isEditing ? (
            <Section title="Comment(s)" tooltip="rdfs:comment" icon={<MessageSquare className="h-4 w-4" />}>
              <div className="space-y-2">
                {editComments.map((comment, index) => {
                  const isGhost = index === editComments.length - 1 && comment.value.trim() === "";
                  return (
                    <div key={index} className="flex items-start gap-2">
                      <textarea
                        value={comment.value}
                        onChange={(e) => updateComment(index, e.target.value)}
                        onBlur={() => triggerSave()}
                        placeholder={isGhost ? (editComments.length > 1 ? "Add another comment" : "Add a comment") : ""}
                        rows={isGhost && editComments.length > 1 ? 1 : COMMENT_ROWS}
                        className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-hidden focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                      />
                      {!isGhost ? (
                        <Tooltip content="Remove comment">
                          <button
                            onClick={() => removeComment(index)}
                            className="mt-1 shrink-0 rounded-sm p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                            aria-label="Remove comment"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                      ) : (
                        <div className="mt-1 shrink-0 rounded-sm p-1">
                          <div className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          ) : classDetail.comments.length > 0 ? (
            <Section title="Comment(s)" tooltip="rdfs:comment" icon={<MessageSquare className="h-4 w-4" />}>
              <div className="space-y-1">
                {classDetail.comments.map((comment, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className="text-sm text-slate-700 dark:text-slate-300">{comment.value}</span>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {(() => {
            const annotationGroups = (isEditing ? editAnnotations : classDetail.annotations || [])
              .filter((a) => a.property_iri !== DEFINITION_IRI && !RELATIONSHIP_PROPERTY_IRIS.has(a.property_iri) && a.values.length > 0);

            return (
              <>
                {annotationGroups.map((annotation) => {
                  const propInfo = getAnnotationPropertyInfo(annotation.property_iri);
                  const icon = getAnnotationIcon(annotation.property_iri);

                  if (isEditing) {
                    return (
                      <Section key={annotation.property_iri} title={propInfo.displayLabel} tooltip={propInfo.curie} icon={icon}>
                        <div className="space-y-2">
                          {annotation.values.map((val, vIdx) => {
                            const isGhost = vIdx === annotation.values.length - 1 && val.value.trim() === "";
                            return (
                              <AnnotationRow
                                key={vIdx}
                                propertyIri={annotation.property_iri}
                                value={val.value}
                                onValueChange={(v) => updateAnnotationValue(annotation.property_iri, vIdx, v)}
                                onRemove={isGhost ? undefined : () => removeAnnotationValue(annotation.property_iri, vIdx)}
                                onBlur={() => triggerSave()}
                                showPropertyLabel={false}
                                placeholder={isGhost ? `Add another ${propInfo.displayLabel}` : undefined}
                              />
                            );
                          })}
                        </div>
                      </Section>
                    );
                  }

                  return (
                    <Section key={annotation.property_iri} title={propInfo.displayLabel} tooltip={propInfo.curie} icon={icon}>
                      <div className="space-y-1">
                        {annotation.values.map((val, vIdx) => (
                          <div key={vIdx} className="flex items-center gap-2">
                            <span className="text-sm text-slate-700 dark:text-slate-300">{val.value}</span>
                          </div>
                        ))}
                      </div>
                    </Section>
                  );
                })}

                {isEditing && (
                  <InlineAnnotationAdder
                    excludeIris={[
                      LABEL_IRI, COMMENT_IRI, DEFINITION_IRI,
                      ...Array.from(RELATIONSHIP_PROPERTY_IRIS),
                      ...editAnnotations.map((a) => a.property_iri),
                    ]}
                    onAdd={(propertyIri, value) => {
                      setEditAnnotations((prev) => {
                        const existing = prev.find((a) => a.property_iri === propertyIri);
                        if (existing) {
                          return prev.map((a) =>
                            a.property_iri === propertyIri
                              ? { ...a, values: ensureTrailingEmpty([...a.values, { value }]) }
                              : a
                          );
                        }
                        return [
                          ...prev,
                          { property_iri: propertyIri, values: ensureTrailingEmpty([{ value }]) },
                        ];
                      });
                      requestAnimationFrame(() => triggerSave());
                    }}
                  />
                )}
              </>
            );
          })()}

          {isEditing ? (
            <Section title="Parent Class(es)" tooltip="rdfs:subClassOf" icon={<ArrowUp className="h-4 w-4" />}>
              <div className="space-y-2">
                {editParentIris.map((parentIri) => (
                  <div key={parentIri} className="flex items-center gap-2">
                    <EntityTypeIcon type="class" className="h-4 w-4" />
                    {onNavigateToClass ? (
                      <Tooltip content={`Show ${editParentLabels[parentIri] || getLocalName(parentIri)} in the tree`}>
                        <button
                          type="button"
                          onClick={() => onNavigateToClass(parentIri)}
                          className="flex-1 truncate text-left text-sm text-slate-700 hover:text-primary-600 hover:underline dark:text-slate-300 dark:hover:text-primary-400"
                        >
                          {editParentLabels[parentIri] || getLocalName(parentIri)}
                        </button>
                      </Tooltip>
                    ) : (
                      <Tooltip content={parentIri}>
                        <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-300">
                          {editParentLabels[parentIri] || getLocalName(parentIri)}
                        </span>
                      </Tooltip>
                    )}
                    <Tooltip content="Remove parent">
                      <button
                        onClick={() => removeParent(parentIri)}
                        className="rounded-sm p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        aria-label="Remove parent"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                ))}
                {showParentPicker ? (
                  <div className="mt-1">
                    <ParentClassPicker
                      projectId={projectId}
                      branch={branch}
                      excludeIris={[classDetail.iri, ...editParentIris]}
                      onSelect={addParent}
                      onClose={() => setShowParentPicker(false)}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setShowParentPicker(true)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
                  >
                    <Plus className="h-3 w-3" />
                    Add parent
                  </button>
                )}
              </div>
            </Section>
          ) : classDetail.parent_iris.length > 0 ? (
            <Section title="Parent Class(es)" tooltip="rdfs:subClassOf" icon={<ArrowUp className="h-4 w-4" />}>
              <div className="space-y-1">
                {classDetail.parent_iris.map((parentIri) => (
                  <IriLink
                    key={parentIri}
                    iri={parentIri}
                    label={classDetail.parent_labels?.[parentIri]}
                    onClick={onNavigateToClass}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          {(() => {
            const readRelationships: RelationshipGroup[] = isEditing
              ? editRelationships
              : (classDetail.annotations || [])
                  .filter((a) => RELATIONSHIP_PROPERTY_IRIS.has(a.property_iri))
                  .map((a) => {
                    const propInfo = getAnnotationPropertyInfo(a.property_iri);
                    return {
                      property_iri: a.property_iri,
                      property_label: propInfo.displayLabel,
                      targets: a.values
                        .filter((v) => v.value.trim())
                        .map((v) => ({ iri: v.value, label: resolvedTargetLabels[v.value] || getLocalName(v.value) })),
                    };
                  });

            const hasRelationships = readRelationships.some((g) => g.targets.length > 0);
            if (!isEditing && !hasRelationships) return null;

            return (
              <Section title="Relationship(s)" icon={<Link2 className="h-4 w-4" />}>
                <RelationshipSection
                  groups={readRelationships}
                  isEditing={isEditing}
                  projectId={projectId}
                  branch={branch}
                  onAddTarget={addRelationshipTarget}
                  onRemoveTarget={removeRelationshipTarget}
                  onChangeProperty={changeRelationshipProperty}
                  onAddGroup={addRelationshipGroup}
                  onNavigateToClass={onNavigateToClass}
                  onSaveNeeded={() => triggerSave()}
                />
              </Section>
            );
          })()}

          <DisclosureSection
            testId="subclasses-section"
            icon={<ArrowDown className="h-4 w-4" />}
            title="Subclasses"
            count={classDetail.child_count}
            tooltip={sectionHelp("Subclasses")}
            key={`subclasses:${classIri}`}
            defaultOpen
            openable={!!onNavigateToClass && !!classDetail.subclasses?.length}
          >
            <EntityLinkList items={classDetail.subclasses ?? []} onNavigate={onNavigateToClass} />
          </DisclosureSection>

          <DisclosureSection
            testId="individuals-section"
            icon={<IndividualIcon className="h-4 w-4" tooltip={false} />}
            title="Individuals"
            count={classDetail.instance_count ?? classDetail.instances?.length ?? 0}
            tooltip={sectionHelp("Individuals")}
            key={`instances:${classIri}`}
            defaultOpen
            openable={!!onNavigateToIndividual && !!classDetail.instances?.length}
            aside={
              canEdit && onAddIndividual ? (
                <button
                  type="button"
                  onClick={() => onAddIndividual(classIri)}
                  className="inline-flex items-center gap-1 pt-0.5 text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add individual
                </button>
              ) : undefined
            }
          >
            <EntityLinkList items={classDetail.instances ?? []} onNavigate={onNavigateToIndividual} icon={<IndividualIcon className="h-3.5 w-3.5" />} />
          </DisclosureSection>

          <ClassRulesSection
            projectId={projectId}
            classIri={classIri}
            classLabel={getPreferredLabel(classDetail.labels) || getLocalName(classIri)}
            branch={branch}
            canEdit={editable}
            onRulesChanged={onRulesChanged}
            onNavigateToClass={onNavigateToClass}
            onNavigateToEntity={(iri) => onNavigateToIndividual?.(iri)}
          />

          <CrossReferencesPanel
            projectId={projectId}
            entityIri={classIri}
            branch={branch}
            onNavigateToClass={onNavigateToClass}
          />

          <EntityHistoryTab
            projectId={projectId}
            entityIri={classIri}
            branch={branch}
          />

          {classDetail.equivalent_iris && classDetail.equivalent_iris.length > 0 && (
            <Section title="Equivalent Classes" tooltip="owl:equivalentClass" icon={<Equal className="h-4 w-4" />}>
              <div className="space-y-1">
                {classDetail.equivalent_iris.map((iri) => (
                  <IriLink key={iri} iri={iri} onClick={onNavigateToClass} />
                ))}
              </div>
            </Section>
          )}

          {classDetail.disjoint_iris && classDetail.disjoint_iris.length > 0 && (
            <Section title="Disjoint With" tooltip="owl:disjointWith" icon={<Ban className="h-4 w-4" />}>
              <div className="space-y-1">
                {classDetail.disjoint_iris.map((iri) => (
                  <IriLink key={iri} iri={iri} onClick={onNavigateToClass} />
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

    </div>
  );
}

const ANNOTATION_ICON_MAP: Record<string, React.ReactNode> = {
  "http://www.w3.org/2004/02/skos/core#prefLabel": <Star className="h-4 w-4" />,
  "http://www.w3.org/2004/02/skos/core#altLabel": <Tags className="h-4 w-4" />,
  "http://www.w3.org/2004/02/skos/core#hiddenLabel": <EyeOff className="h-4 w-4" />,
  "http://www.w3.org/2004/02/skos/core#example": <Lightbulb className="h-4 w-4" />,
  "http://www.w3.org/2004/02/skos/core#scopeNote": <StickyNote className="h-4 w-4" />,
  "http://www.w3.org/2004/02/skos/core#editorialNote": <StickyNote className="h-4 w-4" />,
  "http://www.w3.org/2004/02/skos/core#historyNote": <StickyNote className="h-4 w-4" />,
  "http://www.w3.org/2004/02/skos/core#changeNote": <StickyNote className="h-4 w-4" />,
  "http://www.w3.org/2004/02/skos/core#notation": <Hash className="h-4 w-4" />,
  "http://www.w3.org/2000/01/rdf-schema#seeAlso": <ExternalLink className="h-4 w-4" />,
  "http://www.w3.org/2000/01/rdf-schema#isDefinedBy": <Link2 className="h-4 w-4" />,
};

/** Entities by label, each linking to its own page in the editor. */
function EntityLinkList({ items, onNavigate, icon }: { items: { iri: string; label: string }[]; onNavigate?: (iri: string) => void; icon?: React.ReactNode }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.iri} className={icon ? "flex items-center gap-1.5" : undefined}>
          {icon}
          <Tooltip content={item.iri}>
            <button
              type="button"
              onClick={() => onNavigate?.(item.iri)}
              className="text-sm text-primary-600 hover:underline dark:text-primary-400"
            >
              {item.label}
            </button>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

function getAnnotationIcon(propertyIri: string): React.ReactNode {
  return ANNOTATION_ICON_MAP[propertyIri] || <FileText className="h-4 w-4" />;
}

interface SectionProps {
  title: string;
  tooltip?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

function Section({ title, tooltip, icon, children }: SectionProps) {
  return (
    <div className="flex gap-4">
      <Tooltip content={sectionHelp(title, tooltip)}>
        <div className="w-40 shrink-0 flex items-start gap-1.5 pt-1">
          {icon && <span className="text-slate-400 dark:text-slate-500">{icon}</span>}
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{title}</span>
        </div>
      </Tooltip>
      <div className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}

interface IriLinkProps {
  iri: string;
  label?: string;
  onClick?: (iri: string) => void;
}

function IriLink({ iri, label, onClick }: IriLinkProps) {
  const displayLabel = label || getLocalName(iri);

  return (
    <Tooltip content={iri}>
      <span className="inline-flex">
        <button
          onClick={() => onClick?.(iri)}
          className={cn(
            "flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-400 dark:hover:text-primary-300",
            !onClick && "cursor-default hover:no-underline"
          )}
          disabled={!onClick}
        >
          <EntityTypeIcon type="class" className="h-4 w-4" />
          {displayLabel}
          <ExternalLink className="h-3 w-3 opacity-50" />
        </button>
      </span>
    </Tooltip>
  );
}

interface IssueItemProps {
  issue: LintIssue;
}

const issueIcons = {
  error: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
  info: <Info className="h-3.5 w-3.5 text-blue-500" />,
};

const issueColors = {
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

function IssueItem({ issue }: IssueItemProps) {
  return (
    <div className={cn("rounded-md px-2.5 py-1.5 text-xs", issueColors[issue.issue_type])}>
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 shrink-0">{issueIcons[issue.issue_type]}</span>
        <div>
          <span className="font-medium">{issue.rule_id}:</span>{" "}
          <span>{issue.message}</span>
        </div>
      </div>
    </div>
  );
}
