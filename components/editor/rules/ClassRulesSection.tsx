"use client";

import { useState } from "react";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { DisclosureSection } from "@/components/editor/shared/Disclosure";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { RuleFormDialog } from "@/components/editor/rules/RuleFormDialog";
import { RuleViolationList } from "@/components/editor/rules/RuleViolationList";
import { rulesApi, type Rule, type RuleSeverity } from "@/lib/api/rules";
import { useClassRules, useRefreshAfterRuleChange, useRuleViolations } from "@/lib/hooks/useRules";
import { ruleConstraintParts } from "@/lib/rules/ruleForm";
import { sectionHelp } from "@/lib/editor/sectionHelp";
import { cn, getLocalName } from "@/lib/utils";

const severityBadge: Record<RuleSeverity, string> = {
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

interface ClassRulesSectionProps {
  projectId: string;
  classIri: string;
  classLabel: string;
  branch?: string;
  canEdit: boolean;
  onRulesChanged?: () => void | Promise<void>;
  onNavigateToClass?: (iri: string) => void;
  onNavigateToEntity?: (iri: string, entityType: string) => void;
}

export function ClassRulesSection({
  projectId,
  classIri,
  classLabel,
  branch,
  canEdit,
  onRulesChanged,
  onNavigateToClass,
  onNavigateToEntity,
}: ClassRulesSectionProps) {
  const rules = useClassRules(projectId, classIri, branch);
  const violations = useRuleViolations(projectId, branch, { classIri });
  const refresh = useRefreshAfterRuleChange(projectId);
  const [formRule, setFormRule] = useState<Rule | "new" | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<Rule | null>(null);

  const handleChanged = async () => {
    refresh();
    await onRulesChanged?.();
  };

  const handleDelete = async () => {
    if (!ruleToDelete) return;
    await rulesApi.remove(projectId, ruleToDelete.iri, branch);
    await handleChanged();
  };

  const list = rules.data ?? [];
  const found = violations.data?.violations ?? [];

  return (
    <>
      <DisclosureSection
        testId="rules-section"
        icon={<ShieldCheck className="h-4 w-4" />}
        title="Rules"
        count={rules.data ? list.length : null}
        tooltip={sectionHelp("Rules")}
        key={`rules:${classIri}`}
        defaultOpen
        openable={list.length > 0}
        aside={
          canEdit ? (
            <button
              type="button"
              onClick={() => setFormRule("new")}
              className="inline-flex items-center gap-1 pt-0.5 text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Add rule
            </button>
          ) : undefined
        }
      >
        <div className="space-y-3">
          {rules.error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              Couldn&apos;t load the rules
            </p>
          )}
          <ul className="space-y-2">
            {list.map((rule) => (
              <RuleRow
                key={rule.iri}
                rule={rule}
                classIri={classIri}
                canEdit={canEdit}
                onEdit={() => setFormRule(rule)}
                onDelete={() => setRuleToDelete(rule)}
                onNavigateToClass={onNavigateToClass}
              />
            ))}
          </ul>
          {found.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Violations ({found.length}){violations.data?.stale ? " from an older commit" : ""}
              </p>
              <RuleViolationList violations={found} onNavigate={onNavigateToEntity} />
            </div>
          )}
        </div>
      </DisclosureSection>

      {formRule && (
        <RuleFormDialog
          projectId={projectId}
          branch={branch}
          classIri={classIri}
          classLabel={classLabel}
          rule={formRule === "new" ? undefined : formRule}
          onClose={() => setFormRule(null)}
          onSaved={handleChanged}
        />
      )}

      <ConfirmDialog
        open={!!ruleToDelete}
        onOpenChange={(open) => !open && setRuleToDelete(null)}
        onConfirm={handleDelete}
        title="Delete rule"
        description={`Delete "${ruleToDelete ? ruleName(ruleToDelete) : ""}"? This is committed like any other edit.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </>
  );
}

function ruleName(rule: Rule): string {
  return rule.label || rule.message || getLocalName(rule.iri);
}

interface RuleRowProps {
  rule: Rule;
  classIri: string;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onNavigateToClass?: (iri: string) => void;
}

function RuleRow({ rule, classIri, canEdit, onEdit, onDelete, onNavigateToClass }: RuleRowProps) {
  const inherited = rule.applies_to_iri !== classIri;
  const editable = canEdit && !rule.read_only && !inherited;
  const parts = ruleConstraintParts(rule);
  return (
    <li className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700" data-testid="rule-row">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-sm px-1.5 py-0.5 text-xs font-medium", severityBadge[rule.severity])}>
              {rule.severity}
            </span>
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{ruleName(rule)}</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {rule.property_iri ? (
              <Tooltip content={rule.property_iri}>
                <span className="font-medium">{getLocalName(rule.property_iri)}</span>
              </Tooltip>
            ) : (
              <span className="font-medium">any property</span>
            )}
            {parts.length > 0 && <span>: {parts.join(", ")}</span>}
          </p>
          {(inherited || rule.imported_from) && (
            <p className="text-xs text-slate-400 dark:text-slate-500" data-testid="rule-origin">
              {inherited && (
                <>
                  Inherited from{" "}
                  <button
                    type="button"
                    onClick={() => onNavigateToClass?.(rule.applies_to_iri)}
                    className="text-primary-600 hover:underline dark:text-primary-400"
                  >
                    {getLocalName(rule.applies_to_iri)}
                  </button>
                </>
              )}
              {inherited && rule.imported_from && " · "}
              {rule.imported_from && <>Imported from {rule.imported_from}, read-only</>}
            </p>
          )}
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip content="Edit rule">
              <button
                type="button"
                onClick={onEdit}
                aria-label="Edit rule"
                className="rounded-sm p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="Delete rule">
              <button
                type="button"
                onClick={onDelete}
                aria-label="Delete rule"
                className="rounded-sm p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </li>
  );
}
