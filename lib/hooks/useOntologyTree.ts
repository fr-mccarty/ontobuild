"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { projectOntologyApi, type OWLClassTreeNode as ApiTreeNode } from "@/lib/api/client";
import type { ClassTreeNode, ImportedMarker } from "@/lib/ontology/types";

/** Fired (on window) after something outside the editor's own forms changes the ontology's imports. */
export const IMPORTS_CHANGED_EVENT = "ontokit:imports-changed";

export interface ImportsChangedDetail {
  projectId: string;
  branch?: string;
}

interface UseOntologyTreeOptions {
  projectId: string;
  branchKey?: string;
}

interface ReparentSnapshot {
  previousNodes: ClassTreeNode[];
}

export interface RefreshTreeOptions {
  /** Classes known to be deleted; the selection clears if it is one of them. */
  removedIris?: string[];
}

interface UseOntologyTreeReturn {
  nodes: ClassTreeNode[];
  totalClasses: number;
  isLoading: boolean;
  error: string | null;
  selectedIri: string | null;
  loadRootClasses: () => Promise<void>;
  refreshTree: (options?: RefreshTreeOptions) => Promise<void>;
  expandNode: (iri: string) => Promise<void>;
  collapseNode: (iri: string) => void;
  selectNode: (iri: string) => void;
  navigateToNode: (iri: string) => Promise<void>;
  addOptimisticNode: (iri: string, label: string, parentIri?: string) => void;
  removeOptimisticNode: (iri: string) => void;
  updateNodeLabel: (iri: string, newLabel: string) => void;
  collapseAll: () => void;
  collapseOneLevel: () => void;
  expandOneLevel: () => Promise<void>;
  expandAllFully: () => Promise<void>;
  hasExpandableNodes: boolean;
  hasExpandedNodes: boolean;
  isExpandingAll: boolean;
  reparentOptimistic: (iri: string, oldParentIri: string | null, newParentIri: string | null) => ReparentSnapshot;
  rollbackReparent: (snapshot: ReparentSnapshot) => void;
}

function apiNodeToTreeNode(apiNode: ApiTreeNode & ImportedMarker): ClassTreeNode {
  return {
    iri: apiNode.iri,
    label: apiNode.label,
    children: [],
    isExpanded: false,
    isLoading: false,
    hasChildren: apiNode.child_count > 0,
    ...(apiNode.imported_from
      ? { importedFrom: apiNode.imported_from, importedFromLabel: apiNode.imported_from_label ?? null }
      : {}),
  };
}

function collectExpanded(nodes: ClassTreeNode[], out = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.isExpanded) {
      out.add(node.iri);
      collectExpanded(node.children, out);
    }
  }
  return out;
}

/** True when the node is rendered: it is a root, or every ancestor on its path is expanded. */
function isVisibleInTree(nodes: ClassTreeNode[], iri: string): boolean {
  for (const node of nodes) {
    if (node.iri === iri) return true;
    if (node.isExpanded && isVisibleInTree(node.children, iri)) return true;
  }
  return false;
}

function updateNodeInTree(
  nodes: ClassTreeNode[],
  iri: string,
  updater: (node: ClassTreeNode) => ClassTreeNode
): ClassTreeNode[] {
  return nodes.map((node) => {
    if (node.iri === iri) {
      return updater(node);
    }
    if (node.children.length > 0) {
      return {
        ...node,
        children: updateNodeInTree(node.children, iri, updater),
      };
    }
    return node;
  });
}

export function useOntologyTree({
  projectId,
  branchKey,
}: UseOntologyTreeOptions): UseOntologyTreeReturn {
  const [nodes, setNodes] = useState<ClassTreeNode[]>([]);
  const nodesRef = useRef<ClassTreeNode[]>([]);
  nodesRef.current = nodes;
  const [totalClasses, setTotalClasses] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIri, setSelectedIri] = useState<string | null>(null);
  const selectedIriRef = useRef<string | null>(null);
  selectedIriRef.current = selectedIri;
  const refreshGenRef = useRef(0);

  useEffect(() => {
    setNodes([]);
    setTotalClasses(0);
    setSelectedIri(null);
    setError(null);
  }, [branchKey]);

  const loadRootClasses = useCallback(async () => {
    if (!projectId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await projectOntologyApi.getRootClasses(projectId, branchKey);
      setNodes(response.nodes.map(apiNodeToTreeNode));
      setTotalClasses(response.total_classes);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load ontology tree";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, branchKey]);

  const expandNode = useCallback(
    async (iri: string) => {
      setNodes((prev) =>
        updateNodeInTree(prev, iri, (node) => ({
          ...node,
          isLoading: true,
        }))
      );

      try {
        const response = await projectOntologyApi.getClassChildren(projectId, iri, branchKey);
        const children = response.nodes.map(apiNodeToTreeNode);

        setNodes((prev) =>
          updateNodeInTree(prev, iri, (node) => ({
            ...node,
            children,
            isExpanded: true,
            isLoading: false,
          }))
        );
      } catch (err) {
        setNodes((prev) =>
          updateNodeInTree(prev, iri, (node) => ({
            ...node,
            isLoading: false,
          }))
        );
        console.error("Failed to expand node:", err);
      }
    },
    [projectId, branchKey]
  );

  // Reload the tree from the server in place: roots, every expanded subtree, labels and the
  // class count, keeping which nodes are expanded and which class is selected. Used after
  // something outside the tree (the agent) changes the ontology.
  const refreshTree = useCallback(
    async (options: RefreshTreeOptions = {}) => {
      if (!projectId) return;
      const gen = ++refreshGenRef.current;
      const before = nodesRef.current;
      const expanded = collectExpanded(before);
      const removed = new Set(options.removedIris ?? []);

      const fill = async (items: ClassTreeNode[], path: Set<string>): Promise<ClassTreeNode[]> =>
        Promise.all(
          items.map(async (node) => {
            if (!expanded.has(node.iri) || !node.hasChildren || path.has(node.iri)) return node;
            try {
              const response = await projectOntologyApi.getClassChildren(projectId, node.iri, branchKey);
              const childPath = new Set(path).add(node.iri);
              const children = await fill(response.nodes.map(apiNodeToTreeNode), childPath);
              return { ...node, children, isExpanded: true };
            } catch (err) {
              console.error("Failed to refresh node:", err);
              return node;
            }
          }),
        );

      let roots: ClassTreeNode[];
      let total: number;
      try {
        const response = await projectOntologyApi.getRootClasses(projectId, branchKey);
        roots = await fill(response.nodes.map(apiNodeToTreeNode), new Set());
        total = response.total_classes;
      } catch (err) {
        console.error("Failed to refresh ontology tree:", err);
        return;
      }
      if (gen !== refreshGenRef.current) return;

      setNodes(roots);
      setTotalClasses(total);
      setError(null);

      const selected = selectedIriRef.current;
      if (!selected) return;
      if (removed.has(selected)) {
        setSelectedIri(null);
        return;
      }
      // The selected class was on screen but is not any more: it moved under a collapsed
      // parent, or it is gone. Reveal it at its new place, or clear the selection.
      if (!isVisibleInTree(before, selected) || isVisibleInTree(roots, selected)) return;
      try {
        const response = await projectOntologyApi.getClassAncestors(projectId, selected, branchKey);
        if (gen !== refreshGenRef.current) return;
        for (const ancestor of response.nodes) {
          await expandNode(ancestor.iri);
        }
      } catch {
        if (gen === refreshGenRef.current && selectedIriRef.current === selected) setSelectedIri(null);
      }
    },
    [projectId, branchKey, expandNode],
  );

  const collapseNode = useCallback((iri: string) => {
    setNodes((prev) =>
      updateNodeInTree(prev, iri, (node) => ({
        ...node,
        isExpanded: false,
      }))
    );
  }, []);

  const selectNode = useCallback((iri: string) => {
    setSelectedIri(iri);
  }, []);

  const navigateToNode = useCallback(
    async (iri: string) => {
      try {
        const response = await projectOntologyApi.getClassAncestors(projectId, iri, branchKey);
        const ancestorNodes = response.nodes;

        for (const ancestor of ancestorNodes) {
          await expandNode(ancestor.iri);
        }

        setSelectedIri(iri);
      } catch (err) {
        console.error("Failed to navigate to node:", err);
        setSelectedIri(iri);
      }
    },
    [projectId, branchKey, expandNode]
  );

  const addOptimisticNode = useCallback(
    (iri: string, label: string, parentIri?: string) => {
      const newNode: ClassTreeNode = {
        iri,
        label,
        children: [],
        isExpanded: false,
        isLoading: false,
        hasChildren: false,
      };

      if (parentIri) {
        setNodes((prev) =>
          updateNodeInTree(prev, parentIri, (parent) => ({
            ...parent,
            children: [...parent.children, newNode],
            hasChildren: true,
            isExpanded: true,
          }))
        );
      } else {
        setNodes((prev) => [...prev, newNode]);
      }

      setTotalClasses((prev) => prev + 1);
      setSelectedIri(iri);
    },
    []
  );

  const removeOptimisticNode = useCallback(
    (iri: string) => {
      const filterNodes = (items: ClassTreeNode[]): ClassTreeNode[] =>
        items
          .filter((node) => node.iri !== iri)
          .map((node) =>
            node.children.length > 0
              ? { ...node, children: filterNodes(node.children) }
              : node
          );

      setNodes((prev) => filterNodes(prev));
      setTotalClasses((prev) => Math.max(0, prev - 1));
      setSelectedIri((prev) => (prev === iri ? null : prev));
    },
    []
  );

  const updateNodeLabel = useCallback(
    (iri: string, newLabel: string) => {
      setNodes((prev) =>
        updateNodeInTree(prev, iri, (node) => ({
          ...node,
          label: newLabel,
        }))
      );
    },
    []
  );

  const collapseAll = useCallback(() => {
    const collapseTree = (items: ClassTreeNode[]): ClassTreeNode[] =>
      items.map((node) => ({
        ...node,
        isExpanded: false,
        children: node.children.length > 0 ? collapseTree(node.children) : node.children,
      }));
    setNodes((prev) => collapseTree(prev));
  }, []);

  const collapseOneLevel = useCallback(() => {
    setNodes((prev) => {
      const collapse = (items: ClassTreeNode[]): ClassTreeNode[] =>
        items.map((node) => {
          if (!node.isExpanded) return node;
          const hasExpandedChild = node.children.some((c) => c.isExpanded);
          if (!hasExpandedChild) return { ...node, isExpanded: false };
          return { ...node, children: collapse(node.children) };
        });
      return collapse(prev);
    });
  }, []);

  const collectUnexpanded = useCallback((items: ClassTreeNode[]): string[] => {
    const result: string[] = [];
    for (const node of items) {
      if ((node.hasChildren || node.children.length > 0) && !node.isExpanded) {
        result.push(node.iri);
      }
      if (node.isExpanded && node.children.length > 0) {
        result.push(...collectUnexpanded(node.children));
      }
    }
    return result;
  }, []);

  const expandOneLevel = useCallback(async () => {
    const irisToExpand = collectUnexpanded(nodes);
    await Promise.all(irisToExpand.map((iri) => expandNode(iri)));
  }, [nodes, expandNode, collectUnexpanded]);

  const [isExpandingAll, setIsExpandingAll] = useState(false);

  const expandAllFully = useCallback(async () => {
    const MAX_ROUNDS = 20;
    const MAX_NODES = 500;
    setIsExpandingAll(true);
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const frontier = await new Promise<string[]>((resolve) => {
          setNodes((currentNodes) => {
            const countVisible = (items: ClassTreeNode[]): number => {
              let count = items.length;
              for (const node of items) {
                if (node.isExpanded && node.children.length > 0) {
                  count += countVisible(node.children);
                }
              }
              return count;
            };
            if (countVisible(currentNodes) >= MAX_NODES) {
              resolve([]);
              return currentNodes;
            }
            resolve(collectUnexpanded(currentNodes));
            return currentNodes;
          });
        });
        if (frontier.length === 0) break;
        await Promise.all(frontier.map((iri) => expandNode(iri)));
      }
    } finally {
      setIsExpandingAll(false);
    }
  }, [expandNode, collectUnexpanded]);

  const hasExpandableNodes = useMemo(() => {
    const check = (items: ClassTreeNode[]): boolean => {
      for (const node of items) {
        if ((node.hasChildren || node.children.length > 0) && !node.isExpanded) return true;
        if (node.isExpanded && node.children.length > 0 && check(node.children)) return true;
      }
      return false;
    };
    return check(nodes);
  }, [nodes]);

  const hasExpandedNodes = useMemo(() => {
    return nodes.some((node) => node.isExpanded);
  }, [nodes]);

  const reparentOptimistic = useCallback(
    (iri: string, oldParentIri: string | null, newParentIri: string | null): ReparentSnapshot => {
      const snapshot: ReparentSnapshot = { previousNodes: nodesRef.current };

      setNodes((prev) => {

        const findAndClone = (items: ClassTreeNode[]): ClassTreeNode | null => {
          for (const node of items) {
            if (node.iri === iri) return { ...node };
            if (node.children.length > 0) {
              const found = findAndClone(node.children);
              if (found) return found;
            }
          }
          return null;
        };

        const movingNode = findAndClone(prev);
        if (!movingNode) return prev;

        const removeFromTree = (items: ClassTreeNode[]): ClassTreeNode[] => {
          const filtered = items.filter((n) => n.iri !== iri);
          return filtered.map((n) => {
            if (n.children.length > 0) {
              const newChildren = removeFromTree(n.children);
              const lostChild = n.children.length !== newChildren.length;
              return {
                ...n,
                children: newChildren,
                hasChildren: newChildren.length > 0 || (n.hasChildren && !lostChild),
              };
            }
            return n;
          });
        };

        let result = removeFromTree(prev);

        if (newParentIri) {
          result = updateNodeInTree(result, newParentIri, (parent) => ({
            ...parent,
            children: [...parent.children, movingNode],
            hasChildren: true,
            isExpanded: true,
          }));
        } else {
          result = [...result, movingNode];
        }

        return result;
      });

      return snapshot;
    },
    [],
  );

  const rollbackReparent = useCallback((snapshot: ReparentSnapshot) => {
    setNodes(snapshot.previousNodes);
  }, []);

  useEffect(() => {
    loadRootClasses();
  }, [loadRootClasses]);

  // Imports added or removed (the Imports dialog) change which classes the tree shows.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onImportsChanged = (e: Event) => {
      const detail = (e as CustomEvent<ImportsChangedDetail>).detail;
      if (!detail || detail.projectId !== projectId) return;
      if (detail.branch && branchKey && detail.branch !== branchKey) return;
      void refreshTree();
    };
    window.addEventListener(IMPORTS_CHANGED_EVENT, onImportsChanged);
    return () => window.removeEventListener(IMPORTS_CHANGED_EVENT, onImportsChanged);
  }, [projectId, branchKey, refreshTree]);

  return {
    nodes,
    totalClasses,
    isLoading,
    error,
    selectedIri,
    loadRootClasses,
    refreshTree,
    expandNode,
    collapseNode,
    selectNode,
    navigateToNode,
    addOptimisticNode,
    removeOptimisticNode,
    updateNodeLabel,
    collapseAll,
    collapseOneLevel,
    expandOneLevel,
    expandAllFully,
    hasExpandableNodes,
    hasExpandedNodes,
    isExpandingAll,
    reparentOptimistic,
    rollbackReparent,
  };
}
