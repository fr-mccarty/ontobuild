"use client";

import { ShieldAlert } from "lucide-react";
import { DisclosureSection } from "@/components/editor/shared/Disclosure";
import { RuleViolationList } from "@/components/editor/rules/RuleViolationList";
import { useRuleViolations } from "@/lib/hooks/useRules";
import { sectionHelp } from "@/lib/editor/sectionHelp";

interface EntityViolationsSectionProps {
  projectId: string;
  entityIri: string;
  branch?: string;
}

export function EntityViolationsSection({ projectId, entityIri, branch }: EntityViolationsSectionProps) {
  const { data } = useRuleViolations(projectId, branch, { entityIri });
  const violations = data?.violations ?? [];
  if (violations.length === 0) return null;
  return (
    <DisclosureSection
      testId="rule-violations-section"
      icon={<ShieldAlert className="h-4 w-4" />}
      title="Rule Violations"
      count={violations.length}
      tooltip={sectionHelp("Rule Violations")}
      key={`rule-violations:${entityIri}`}
      defaultOpen
    >
      <RuleViolationList violations={violations} showFocus={false} />
    </DisclosureSection>
  );
}
