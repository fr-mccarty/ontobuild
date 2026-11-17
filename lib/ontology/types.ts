export interface ClassTreeNode {
  iri: string;
  label: string;
  children: ClassTreeNode[];
  isExpanded: boolean;
  isLoading: boolean;
  hasChildren: boolean;
  /** Set for a class from an imported ontology (owl:imports): that ontology's IRI. Read-only. */
  importedFrom?: string;
  /** Project name or title of the ontology the class is imported from. */
  importedFromLabel?: string | null;
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
  /** Set for a class from an imported ontology (owl:imports): that ontology's IRI. Read-only. */
  importedFrom?: string;
  importedFromLabel?: string | null;
}

/**
 * Fields the API adds to tree nodes, class details and search results for classes that come
 * from an imported ontology.
 */
export interface ImportedMarker {
  imported_from?: string;
  imported_from_label?: string | null;
}

/** Display text for where an imported class comes from. */
export function importedFromText(marker: { importedFrom?: string; importedFromLabel?: string | null }): string | null {
  if (!marker.importedFrom) return null;
  return marker.importedFromLabel ? `${marker.importedFromLabel} (${marker.importedFrom})` : marker.importedFrom;
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
    ...(node.importedFrom ? { importedFrom: node.importedFrom, importedFromLabel: node.importedFromLabel } : {}),
  }));
}
