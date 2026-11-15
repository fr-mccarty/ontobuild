"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { projectOntologyApi, type OWLClassTreeNode as ApiTreeNode } from "@/lib/api/client";
import type { ClassTreeNode } from "@/lib/ontology/types";

interface UseOntologyTreeOptions {
  projectId: string;
  accessToken?: string;
  branchKey?: string;
}

interface ReparentSnapshot {
  previousNodes: ClassTreeNode[];
}

interface UseOntologyTreeReturn {
  nodes: ClassTreeNode[];
  totalClasses: number;
  isLoading: boolean;
  error: string | null;
  selectedIri: string | null;
  loadRootClasses: () => Promise<void>;
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

function apiNodeToTreeNode(apiNode: ApiTreeNode): ClassTreeNode {
  return {
    iri: apiNode.iri,
    label: apiNode.label,
    children: [],
    isExpanded: false,
    isLoading: false,
    hasChildren: apiNode.child_count > 0,
  };
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
  accessToken,
  branchKey,
}: UseOntologyTreeOptions): UseOntologyTreeReturn {
  const [nodes, setNodes] = useState<ClassTreeNode[]>([]);
  const nodesRef = useRef<ClassTreeNode[]>([]);
  nodesRef.current = nodes;
  const [totalClasses, setTotalClasses] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIri, setSelectedIri] = useState<string | null>(null);

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
      const response = await projectOntologyApi.getRootClasses(projectId, accessToken, branchKey);
      setNodes(response.nodes.map(apiNodeToTreeNode));
      setTotalClasses(response.total_classes);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load ontology tree";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, accessToken, branchKey]);

  const expandNode = useCallback(
    async (iri: string) => {
      setNodes((prev) =>
        updateNodeInTree(prev, iri, (node) => ({
          ...node,
          isLoading: true,
        }))
      );

      try {
        const response = await projectOntologyApi.getClassChildren(projectId, iri, accessToken, branchKey);
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
    [projectId, accessToken, branchKey]
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
        const response = await projectOntologyApi.getClassAncestors(projectId, iri, accessToken, branchKey);
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
    [projectId, accessToken, branchKey, expandNode]
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

  return {
    nodes,
    totalClasses,
    isLoading,
    error,
    selectedIri,
    loadRootClasses,
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
