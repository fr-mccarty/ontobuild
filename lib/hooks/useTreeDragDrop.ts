"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { DragStartEvent, DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import type { ClassTreeNode } from "@/lib/ontology/types";

export type DragMode = "move" | "add";

export interface DragState {
  draggedIri: string | null;
  draggedLabel: string | null;
  dropTargetIri: string | null;
  isValidDropTarget: boolean;
  isDragActive: boolean;
  dragMode: DragMode;
}

export interface UndoAction {
  classIri: string;
  classLabel: string;
  oldParentIris: string[];
  newParentIris: string[];
}

interface UseTreeDragDropOptions {
  nodes: ClassTreeNode[];
  canEdit: boolean;
  editingIri?: string | null;
  expandNode: (iri: string) => void;
  onReparent: (
    classIri: string,
    oldParentIris: string[],
    newParentIris: string[],
    mode: DragMode,
  ) => Promise<void>;
  onAnnounce?: (message: string) => void;
}

interface UseTreeDragDropReturn {
  dragState: DragState;
  undoAction: UndoAction | null;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: () => void;
  handleUndo: () => void;
  clearUndo: () => void;
  handleDragEnterNode: (iri: string) => void;
  handleDragLeaveNode: () => void;
}

function findNode(nodes: ClassTreeNode[], iri: string): ClassTreeNode | null {
  for (const node of nodes) {
    if (node.iri === iri) return node;
    if (node.children.length > 0) {
      const found = findNode(node.children, iri);
      if (found) return found;
    }
  }
  return null;
}

function isDescendantOf(
  nodes: ClassTreeNode[],
  ancestorIri: string,
  candidateDescendantIri: string,
): boolean {
  const ancestorNode = findNode(nodes, ancestorIri);
  if (!ancestorNode) return false;
  return isInSubtree(ancestorNode.children, candidateDescendantIri);
}

function isInSubtree(children: ClassTreeNode[], targetIri: string): boolean {
  for (const child of children) {
    if (child.iri === targetIri) return true;
    if (child.children.length > 0 && isInSubtree(child.children, targetIri)) {
      return true;
    }
  }
  return false;
}

function findParentIri(
  nodes: ClassTreeNode[],
  targetIri: string,
  parentIri: string | null = null,
): string | null {
  for (const node of nodes) {
    if (node.iri === targetIri) return parentIri;
    if (node.children.length > 0) {
      const found = findParentIri(node.children, targetIri, node.iri);
      if (found !== null) return found;
    }
  }
  return null;
}

export function useTreeDragDrop({
  nodes,
  canEdit,
  editingIri,
  expandNode,
  onReparent,
  onAnnounce,
}: UseTreeDragDropOptions): UseTreeDragDropReturn {
  const [dragState, setDragState] = useState<DragState>({
    draggedIri: null,
    draggedLabel: null,
    dropTargetIri: null,
    isValidDropTarget: false,
    isDragActive: false,
    dragMode: "move",
  });

  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);

  const altKeyRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && dragState.isDragActive) {
        altKeyRef.current = true;
        setDragState((prev) => ({ ...prev, dragMode: "add" }));
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey && altKeyRef.current) {
        altKeyRef.current = false;
        if (dragState.isDragActive) {
          setDragState((prev) => ({ ...prev, dragMode: "move" }));
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [dragState.isDragActive]);

  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpandIriRef = useRef<string | null>(null);

  const cancelAutoExpand = useCallback(() => {
    if (autoExpandTimerRef.current) {
      clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
    autoExpandIriRef.current = null;
  }, []);

  const handleDragEnterNode = useCallback(
    (iri: string) => {
      if (!dragState.isDragActive) return;
      cancelAutoExpand();

      const node = findNode(nodes, iri);
      if (node && node.hasChildren && !node.isExpanded) {
        autoExpandIriRef.current = iri;
        autoExpandTimerRef.current = setTimeout(() => {
          expandNode(iri);
          autoExpandTimerRef.current = null;
          autoExpandIriRef.current = null;
        }, 800);
      }
    },
    [dragState.isDragActive, nodes, expandNode, cancelAutoExpand],
  );

  const handleDragLeaveNode = useCallback(() => {
    cancelAutoExpand();
  }, [cancelAutoExpand]);

  const validateDrop = useCallback(
    (draggedIri: string, targetIri: string | null): boolean => {
      if (!canEdit) return false;
      if (!targetIri) return false;

      if (draggedIri === targetIri) return false;

      if (editingIri && editingIri === draggedIri) return false;

      if (isDescendantOf(nodes, draggedIri, targetIri)) return false;

      const currentParent = findParentIri(nodes, draggedIri);
      if (currentParent === targetIri) return false;

      return true;
    },
    [canEdit, editingIri, nodes],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (!canEdit) return;

      const iri = event.active.id as string;
      const node = findNode(nodes, iri);

      if (editingIri && editingIri === iri) return;

      setDragState({
        draggedIri: iri,
        draggedLabel: node?.label ?? iri,
        dropTargetIri: null,
        isValidDropTarget: false,
        isDragActive: true,
        dragMode: altKeyRef.current ? "add" : "move",
      });
    },
    [canEdit, nodes, editingIri],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const targetIri = event.over?.id as string | null;
      const draggedIri = dragState.draggedIri;
      if (!draggedIri) return;

      const isValid = validateDrop(draggedIri, targetIri);

      setDragState((prev) => ({
        ...prev,
        dropTargetIri: targetIri,
        isValidDropTarget: isValid,
      }));
    },
    [dragState.draggedIri, validateDrop],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      cancelAutoExpand();

      const draggedIri = dragState.draggedIri;
      const targetId = event.over?.id as string | null;

      if (!draggedIri || !targetId) {
        setDragState({
          draggedIri: null,
          draggedLabel: null,
          dropTargetIri: null,
          isValidDropTarget: false,
          isDragActive: false,
          dragMode: "move",
        });
        return;
      }

      const isRootDrop = targetId === "root-drop-zone";
      const targetIri = isRootDrop ? null : targetId;

      if (!isRootDrop && !validateDrop(draggedIri, targetIri)) {
        setDragState({
          draggedIri: null,
          draggedLabel: null,
          dropTargetIri: null,
          isValidDropTarget: false,
          isDragActive: false,
          dragMode: "move",
        });
        return;
      }

      const currentTreeParent = findParentIri(nodes, draggedIri);
      const draggedNode = findNode(nodes, draggedIri);
      const mode = dragState.dragMode;

      if (isRootDrop && currentTreeParent === null) {
        setDragState({
          draggedIri: null,
          draggedLabel: null,
          dropTargetIri: null,
          isValidDropTarget: false,
          isDragActive: false,
          dragMode: "move",
        });
        return;
      }

      const oldParentIris = currentTreeParent ? [currentTreeParent] : [];
      const newParentIris = targetIri ? [targetIri] : [];

      setDragState({
        draggedIri: null,
        draggedLabel: null,
        dropTargetIri: null,
        isValidDropTarget: false,
        isDragActive: false,
        dragMode: "move",
      });

      const undoInfo: UndoAction = {
        classIri: draggedIri,
        classLabel: draggedNode?.label ?? draggedIri,
        oldParentIris,
        newParentIris,
      };
      setUndoAction(undoInfo);

      try {
        await onReparent(draggedIri, oldParentIris, newParentIris, mode);
        const targetNode = targetIri ? findNode(nodes, targetIri) : null;
        const targetLabel = targetNode?.label ?? (targetIri ? "root" : "root");
        onAnnounce?.(`Moved ${undoInfo.classLabel} under ${targetLabel}`);
      } catch {
        setUndoAction(null);
      }
    },
    [dragState.draggedIri, dragState.dragMode, nodes, validateDrop, cancelAutoExpand, onReparent, onAnnounce],
  );

  const handleDragCancel = useCallback(() => {
    cancelAutoExpand();
    setDragState({
      draggedIri: null,
      draggedLabel: null,
      dropTargetIri: null,
      isValidDropTarget: false,
      isDragActive: false,
      dragMode: "move",
    });
  }, [cancelAutoExpand]);

  const handleUndo = useCallback(() => {
    if (!undoAction) return;
    const { classIri, oldParentIris, newParentIris } = undoAction;
    setUndoAction(null);
    onReparent(classIri, newParentIris, oldParentIris, "move").catch(() => {
    });
  }, [undoAction, onReparent]);

  const clearUndo = useCallback(() => {
    setUndoAction(null);
  }, []);

  return {
    dragState,
    undoAction,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    handleUndo,
    clearUndo,
    handleDragEnterNode,
    handleDragLeaveNode,
  };
}
