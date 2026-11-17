import { useState, useRef, useCallback, useEffect } from "react";
import { useDraftStore, draftKey, type AnyDraftEntry } from "@/lib/stores/draftStore";
import { apiErrorMessage } from "@/lib/api/errors";

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
  // The draft for the current entity is read from the store during render (not in an
  // effect), so it is already available on the first render. Panels that have their
  // entity at mount decide on that render whether to seed the form from the draft or
  // from the loaded entity; a draft that only arrived after an effect would be missed.
  const entityKey = entityIri && branch ? draftKey(projectId, branch, entityIri) : null;
  const [restoredDraft, setRestoredDraft] = useState<AnyDraftEntry | null>(
    () => (entityKey ? getDraft(entityKey) ?? null : null),
  );
  const [prevEntityKey, setPrevEntityKey] = useState(entityKey);
  if (entityKey !== prevEntityKey) {
    setPrevEntityKey(entityKey);
    if (entityKey) {
      setRestoredDraft(getDraft(entityKey) ?? null);
      setSaveStatus("idle");
      setSaveError(null);
      setValidationError(null);
    }
  }

  const flushingRef = useRef(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const msg = apiErrorMessage(err, "Failed to save");
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
