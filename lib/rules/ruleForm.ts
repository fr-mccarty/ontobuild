import { getLocalName } from "@/lib/utils";
import type { Rule, RuleInput, RuleSeverity, RuleValue } from "@/lib/api/rules";

export interface RuleFormState {
  propertyIri: string | null;
  minCount: string;
  maxCount: string;
  valueClassIri: string | null;
  valueDatatypeIri: string;
  allowedValues: RuleValue[];
  pattern: string;
  minLength: string;
  maxLength: string;
  closed: boolean;
  severity: RuleSeverity;
  label: string;
  message: string;
}

export const XSD = "http://www.w3.org/2001/XMLSchema#";

export const COMMON_DATATYPES = [
  "string",
  "integer",
  "decimal",
  "boolean",
  "date",
  "dateTime",
  "anyURI",
].map((name) => `${XSD}${name}`);

export function emptyRuleForm(): RuleFormState {
  return {
    propertyIri: null,
    minCount: "",
    maxCount: "",
    valueClassIri: null,
    valueDatatypeIri: "",
    allowedValues: [],
    pattern: "",
    minLength: "",
    maxLength: "",
    closed: false,
    severity: "error",
    label: "",
    message: "",
  };
}

function text(n: number | null): string {
  return n === null ? "" : String(n);
}

export function ruleToForm(rule: Rule): RuleFormState {
  return {
    propertyIri: rule.property_iri,
    minCount: text(rule.min_count),
    maxCount: text(rule.max_count),
    valueClassIri: rule.value_class_iri,
    valueDatatypeIri: rule.value_datatype_iri ?? "",
    allowedValues: rule.allowed_values ? rule.allowed_values.map((v) => ({ ...v })) : [],
    pattern: rule.pattern ?? "",
    minLength: text(rule.min_length),
    maxLength: text(rule.max_length),
    closed: rule.closed,
    severity: rule.severity,
    label: rule.label ?? "",
    message: rule.message ?? "",
  };
}

function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** A whole replacement: every empty field is left out, which removes it from the rule. */
export function formToInput(appliesToIri: string, form: RuleFormState): RuleInput {
  const input: RuleInput = { applies_to_iri: appliesToIri, closed: form.closed, severity: form.severity };
  if (form.propertyIri) input.property_iri = form.propertyIri;
  const minCount = wholeNumber(form.minCount);
  if (minCount !== null) input.min_count = minCount;
  const maxCount = wholeNumber(form.maxCount);
  if (maxCount !== null) input.max_count = maxCount;
  if (form.valueClassIri) input.value_class_iri = form.valueClassIri;
  if (form.valueDatatypeIri) input.value_datatype_iri = form.valueDatatypeIri;
  const allowed = form.allowedValues.filter((v) => v.value.trim() !== "");
  if (allowed.length) input.allowed_values = allowed;
  if (form.pattern) input.pattern = form.pattern;
  const minLength = wholeNumber(form.minLength);
  if (minLength !== null) input.min_length = minLength;
  const maxLength = wholeNumber(form.maxLength);
  if (maxLength !== null) input.max_length = maxLength;
  if (form.label.trim()) input.label = form.label.trim();
  if (form.message.trim()) input.message = form.message.trim();
  return input;
}

/** The constraints a rule sets, as short phrases for a list row. */
export function ruleConstraintParts(rule: Rule): string[] {
  const parts: string[] = [];
  if (rule.min_count !== null) parts.push(`at least ${rule.min_count}`);
  if (rule.max_count !== null) parts.push(`at most ${rule.max_count}`);
  if (rule.value_class_iri) parts.push(`of class ${getLocalName(rule.value_class_iri)}`);
  if (rule.value_datatype_iri) parts.push(`datatype ${getLocalName(rule.value_datatype_iri)}`);
  if (rule.allowed_values) parts.push(`one of ${rule.allowed_values.map((v) => getLocalName(v.value)).join(", ")}`);
  if (rule.pattern) parts.push(`matches ${rule.pattern}`);
  if (rule.min_length !== null) parts.push(`length at least ${rule.min_length}`);
  if (rule.max_length !== null) parts.push(`length at most ${rule.max_length}`);
  if (rule.closed) parts.push("closed");
  return parts;
}
