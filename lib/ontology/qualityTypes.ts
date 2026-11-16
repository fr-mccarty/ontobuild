export type ConsistencySeverity = "error" | "warning" | "info";

export type ConsistencyRuleId =
  | "orphan_class"
  | "cycle_detect"
  | "unused_property"
  | "missing_label"
  | "missing_comment"
  | "orphan_individual"
  | "empty_domain"
  | "empty_range"
  | "duplicate_label"
  | "deprecated_parent"
  | "dangling_ref"
  | "multi_root";

/** Entity types used by consistency issues and duplicate detection. */
export type QualityEntityType = "class" | "property" | "individual";

export interface ConsistencyIssue {
  rule_id: ConsistencyRuleId;
  severity: ConsistencySeverity;
  entity_iri: string;
  /** "ontology" is used for ontology-wide issues (multi_root), whose entity_iri is "". */
  entity_type: QualityEntityType | "unknown" | "ontology";
  message: string;
  details: Record<string, unknown> | null;
}

export interface ConsistencyCheckResult {
  project_id: string;
  branch: string;
  issues: ConsistencyIssue[];
  checked_at: string;
  duration_ms: number;
}

/** GET /quality/issues: checked_at and duration_ms are null when no check has run on the branch. */
export interface LatestConsistencyResult extends Omit<ConsistencyCheckResult, "checked_at" | "duration_ms"> {
  checked_at: string | null;
  duration_ms: number | null;
}

export type ReferenceContext =
  | "parent_iris"
  | "domain_iris"
  | "range_iris"
  | "type_iris"
  | "equivalent_iris"
  | "disjoint_iris"
  | "some_values_from"
  | "annotation_value"
  | "see_also"
  | "inverse_of";

export interface CrossReference {
  source_iri: string;
  source_type: string;
  source_label?: string;
  reference_context: ReferenceContext;
}

export interface CrossReferenceGroup {
  context: ReferenceContext;
  context_label: string;
  references: CrossReference[];
}

export interface CrossReferencesResponse {
  target_iri: string;
  total: number;
  groups: CrossReferenceGroup[];
}

export interface DuplicateCluster {
  entities: Array<{
    iri: string;
    label: string;
    entity_type: QualityEntityType;
  }>;
  similarity: number;
}

export interface DuplicateDetectionResult {
  clusters: DuplicateCluster[];
  threshold: number;
  checked_at: string;
}

/** GET /quality/duplicates/latest: threshold and checked_at are null when no detection has run on the branch. */
export interface LatestDuplicateResult extends Omit<DuplicateDetectionResult, "threshold" | "checked_at"> {
  threshold: number | null;
  checked_at: string | null;
}

export interface QualityJobPendingResponse {
  job_id: string;
  status: "pending";
}
