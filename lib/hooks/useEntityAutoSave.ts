import { useState, useRef, useCallback, useEffect } from "react";
import { useDraftStore, draftKey, type AnyDraftEntry } from "@/lib/stores/draftStore";

export type SaveStatus = "idle" | "draft" | "saving" | "saved" | "error";

interface UseEntityAutoSaveOptions {
  projectId: string;
  branch: string;
  entityIri: string | null;
  canEdit: boolean;
  onFlush?: (iri: string) => Promise<void>;
  onError?: (msg: string) => void;
  buildDraftEntry: () => AnyDraftEntry | null;
  validate?: () => string | null;
}

export interface UseEntityAutoSaveReturn {
  saveStatus: SaveStatus;
  saveError: string | null;
  validationError: string | null;
  triggerSave: () => void;
  flushToGit: () => Promise<boolean>;
  discardDraft: () => void;
  restoredDraft: AnyDraftEntry | null;
  clearRestoredDraft: () => void;
}

export function useEntityAutoSave({
  projectId,
  branch,
  entityIri,
  canEdit,
  onFlush,
  onError,
  buildDraftEntry,
  validate,
}: UseEntityAutoSaveOptions): UseEntityAutoSaveReturn {
  const { setDraft, clearDraft, getDraft } = useDraftStore();
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;
  const buildDraftEntryRef = useRef(buildDraftEntry);
  buildDraftEntryRef.current = buildDraftEntry;
  const validateRef = useRef(validate);
  validateRef.current = validate;

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [restoredDraft, setRestoredDraft] = useState<AnyDraftEntry | null>(null);

  const flushingRef = useRef(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!entityIri || !branch) return;
    const key = draftKey(projectId, branch, entityIri);
    const draft = getDraft(key);
    if (draft) {
      setRestoredDraft(draft);
    } else {
      setRestoredDraft(null);
    }
    setSaveStatus("idle");
    setSaveError(null);
    setValidationError(null);
  }, [entityIri, branch, projectId, getDraft]);

  const clearRestoredDraft = useCallback(() => {
    setRestoredDraft(null);
  }, []);

  const discardDraft = useCallback(() => {
    if (!entityIri || !branch) return;
    const key = draftKey(projectId, branch, entityIri);
    clearDraft(key);
    setSaveStatus("idle");
    setSaveError(null);
    setValidationError(null);
    setRestoredDraft(null);
  }, [entityIri, branch, projectId, clearDraft]);

  const triggerSave = useCallback(() => {
    if (!entityIri || !branch || !canEdit) return;

    const error = validateRef.current?.();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    const entry = buildDraftEntryRef.current();
    if (!entry) return;

    const key = draftKey(projectId, branch, entityIri);
    setDraft(key, entry);
    setSaveStatus("draft");
    setSaveError(null);

    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, [entityIri, branch, projectId, canEdit, setDraft]);

  const flushToGit = useCallback(async (): Promise<boolean> => {
    if (flushingRef.current) return false;
    if (!entityIri || !branch || !canEdit || !onFlushRef.current) return false;

    const error = validateRef.current?.();
    if (error) {
      setValidationError(error);
      return false;
    }
    setValidationError(null);

    const key = draftKey(projectId, branch, entityIri);
    const draft = getDraft(key);
    if (!draft) return false;

    flushingRef.current = true;
    setSaveStatus("saving");
    setSaveError(null);

    try {
      await onFlushRef.current(entityIri);
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
  }, [entityIri, branch, projectId, canEdit, getDraft, clearDraft]);

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
    restoredDraft,
    clearRestoredDraft,
  };
}
