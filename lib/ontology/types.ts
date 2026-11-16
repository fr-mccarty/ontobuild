export interface ClassTreeNode {
  iri: string;
  label: string;
  children: ClassTreeNode[];
  isExpanded: boolean;
  isLoading: boolean;
  hasChildren: boolean;
}

export interface EntityTreeNode {
  iri: string;
  label: string;
  children: EntityTreeNode[];
  isExpanded: boolean;
  isLoading: boolean;
  hasChildren: boolean;
  entityType?: "class" | "property" | "individual";
  isGroupHeader?: boolean;
  deprecated?: boolean;
  isSearchMatch?: boolean;
}

export function classTreeNodesToEntityNodes(
  nodes: ClassTreeNode[],
): EntityTreeNode[] {
  return nodes.map((node) => ({
    iri: node.iri,
    label: node.label,
    children: classTreeNodesToEntityNodes(node.children),
    isExpanded: node.isExpanded,
    isLoading: node.isLoading,
    hasChildren: node.hasChildren,
    entityType: "class" as const,
  }));
}
