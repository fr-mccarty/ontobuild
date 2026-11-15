import { useState, useRef, useCallback, useEffect } from "react";
import { useDraftStore, draftKey, type DraftEntry } from "@/lib/stores/draftStore";
import type { LocalizedString, AnnotationUpdate, ClassUpdatePayload } from "@/lib/api/client";
import type { RelationshipGroup } from "@/components/editor/standard/RelationshipSection";
import type { OWLClassDetail } from "@/lib/api/client";

export type SaveStatus = "idle" | "draft" | "saving" | "saved" | "error";

interface UseAutoSaveOptions {
  projectId: string;
  branch: string;
  classIri: string | null;
  classDetail: OWLClassDetail | null;
  canEdit: boolean;
  onUpdateClass?: (classIri: string, data: ClassUpdatePayload) => Promise<void>;
  onError?: (msg: string) => void;
}

interface EditState {
  labels: LocalizedString[];
  comments: LocalizedString[];
  parentIris: string[];
  parentLabels: Record<string, string>;
  annotations: AnnotationUpdate[];
  relationships: RelationshipGroup[];
}

export interface UseAutoSaveReturn {
  saveStatus: SaveStatus;
  saveError: string | null;
  validationError: string | null;
  triggerSave: () => void;
  flushToGit: () => Promise<boolean>;
  discardDraft: () => void;
  editStateRef: React.MutableRefObject<EditState | null>;
  classDetailRef: React.MutableRefObject<OWLClassDetail | null>;
  restoredDraft: DraftEntry | null;
  clearRestoredDraft: () => void;
}

export function useAutoSave({
  projectId,
  branch,
  classIri,
  classDetail,
  canEdit,
  onUpdateClass,
  onError,
}: UseAutoSaveOptions): UseAutoSaveReturn {
  const { setDraft, clearDraft, getDraft } = useDraftStore();
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [restoredDraft, setRestoredDraft] = useState<DraftEntry | null>(null);

  const editStateRef = useRef<EditState | null>(null);
  const classDetailRef = useRef<OWLClassDetail | null>(null);
  const flushingRef = useRef(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    classDetailRef.current = classDetail;
  }, [classDetail]);

  useEffect(() => {
    if (!classIri || !branch) return;
    const key = draftKey(projectId, branch, classIri);
    const draft = getDraft(key);
    if (draft && (!draft.entityType || draft.entityType === "class")) {
      setRestoredDraft(draft as DraftEntry);
    } else {
      setRestoredDraft(null);
    }
    setSaveStatus("idle");
    setSaveError(null);
    setValidationError(null);
  }, [classIri, branch, projectId, getDraft]);

  const clearRestoredDraft = useCallback(() => {
    setRestoredDraft(null);
  }, []);

  const discardDraft = useCallback(() => {
    if (!classIri || !branch) return;
    const key = draftKey(projectId, branch, classIri);
    clearDraft(key);
    setSaveStatus("idle");
    setSaveError(null);
    setValidationError(null);
    setRestoredDraft(null);
    editStateRef.current = null;
  }, [classIri, branch, projectId, clearDraft, editStateRef]);

  const triggerSave = useCallback(() => {
    if (!classIri || !branch || !canEdit) return;
    const state = editStateRef.current;
    if (!state) return;

    const validLabels = state.labels.filter((l) => l.value.trim());
    if (validLabels.length === 0) {
      setValidationError("At least one label is required");
      return;
    }
    setValidationError(null);

    const key = draftKey(projectId, branch, classIri);
    const entry: DraftEntry = {
      labels: state.labels,
      comments: state.comments,
      parentIris: state.parentIris,
      parentLabels: state.parentLabels,
      annotations: state.annotations,
      relationships: state.relationships,
      updatedAt: Date.now(),
    };
    setDraft(key, entry);
    setSaveStatus("draft");
    setSaveError(null);

    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, [classIri, branch, projectId, canEdit, setDraft]);

  const flushToGit = useCallback(async (): Promise<boolean> => {
    if (flushingRef.current) return false;
    if (!classIri || !branch || !canEdit || !onUpdateClass) return false;

    const state = editStateRef.current;
    if (state && state.labels.every((l) => !l.value.trim())) {
      setValidationError("At least one label is required");
      return false;
    }
    setValidationError(null);

    const key = draftKey(projectId, branch, classIri);
    const rawDraft = getDraft(key);
    if (!rawDraft) return false;
    if (rawDraft.entityType && rawDraft.entityType !== "class") return false;
    const draft = rawDraft as DraftEntry;

    const detail = classDetailRef.current;

    flushingRef.current = true;
    setSaveStatus("saving");
    setSaveError(null);

    try {
      const cleanAnnotations = draft.annotations
        .map((a) => ({
          ...a,
          values: a.values.filter((v) => v.value.trim()),
        }))
        .filter((a) => a.values.length > 0);

      const relationshipAnnotations: AnnotationUpdate[] = draft.relationships
        .filter((g) => g.targets.length > 0)
        .map((g) => ({
          property_iri: g.property_iri,
          values: g.targets.map((t) => ({ value: t.iri })),
        }));

      const validLabels = draft.labels.filter((l) => l.value.trim());

      const payload: ClassUpdatePayload = {
        labels: validLabels,
        comments: draft.comments.filter((c) => c.value.trim()),
        parent_iris: draft.parentIris,
        annotations: [...cleanAnnotations, ...relationshipAnnotations],
        deprecated: detail?.deprecated,
        equivalent_iris: detail?.equivalent_iris ?? undefined,
        disjoint_iris: detail?.disjoint_iris ?? undefined,
      };

      await onUpdateClass(classIri, payload);
      clearDraft(key);
      setSaveStatus("saved");

      savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setSaveStatus("error");
      setSaveError(msg);
      onErrorRef.current?.(msg);
      return false;
    } finally {
      flushingRef.current = false;
    }
  }, [classIri, branch, projectId, canEdit, onUpdateClass, getDraft, clearDraft]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  return {
    saveStatus,
    saveError,
    validationError,
    triggerSave,
    flushToGit,
    discardDraft,
    editStateRef,
    classDetailRef,
    restoredDraft,
    clearRestoredDraft,
  };
}
