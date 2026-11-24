"use client";

import { useState } from "react";
import { Plus, Trash2, X, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ParentClassPicker } from "@/components/editor/ParentClassPicker";
import { apiErrorMessage } from "@/lib/api/errors";
import { rulesApi, type Rule, type RuleSeverity, type RuleValue } from "@/lib/api/rules";
import { COMMON_DATATYPES, emptyRuleForm, formToInput, ruleToForm, type RuleFormState } from "@/lib/rules/ruleForm";
import { getLocalName } from "@/lib/utils";

const INPUT_CLASSES =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-hidden focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder:text-slate-500";

interface RuleFormDialogProps {
  projectId: string;
  branch?: string;
  classIri: string;
  classLabel: string;
  rule?: Rule;
  onClose: () => void;
  onSaved: () => void;
}

export function RuleFormDialog({ projectId, branch, classIri, classLabel, rule, onClose, onSaved }: RuleFormDialogProps) {
  const [form, setForm] = useState<RuleFormState>(() => (rule ? ruleToForm(rule) : emptyRuleForm()));
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<"property" | "value-class" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const set = <K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const nameOf = (iri: string) => labels[iri] ?? getLocalName(iri);

  const setAllowedValue = (index: number, next: Partial<RuleValue>) =>
    set(
      "allowedValues",
      form.allowedValues.map((v, i) => {
        if (i !== index) return v;
        const merged = { ...v, ...next };
        if (merged.type === "iri") delete merged.datatype;
        return merged;
      }),
    );

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const input = formToInput(classIri, form);
      if (rule) await rulesApi.replace(projectId, rule.iri, input, branch);
      else await rulesApi.create(projectId, input, branch);
      onSaved();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't save the rule"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="rule-form">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit rule" : "Add rule"}</DialogTitle>
          <DialogDescription>Instances of {classLabel} must follow this rule.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Property" hint="Leave out only for a closed rule.">
            {form.propertyIri && (
              <div className="mb-1 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <span>{nameOf(form.propertyIri)}</span>
                <button
                  type="button"
                  onClick={() => set("propertyIri", null)}
                  aria-label="Remove property"
                  className="rounded-sm p-0.5 text-slate-400 hover:text-red-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {picker === "property" ? (
              <ParentClassPicker
                projectId={projectId}
                branch={branch}
                entityType="property"
                excludeIris={[]}
                onSelect={(iri, label) => {
                  set("propertyIri", iri);
                  setLabels((prev) => ({ ...prev, [iri]: label }));
                }}
                onClose={() => setPicker(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setPicker("property")}
                className="text-xs text-primary-600 hover:underline dark:text-primary-400"
              >
                {form.propertyIri ? "Change property" : "Choose property"}
              </button>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Min count">
              <input type="number" min={0} aria-label="Min count" value={form.minCount} onChange={(e) => set("minCount", e.target.value)} className={INPUT_CLASSES} />
            </Field>
            <Field label="Max count">
              <input type="number" min={0} aria-label="Max count" value={form.maxCount} onChange={(e) => set("maxCount", e.target.value)} className={INPUT_CLASSES} />
            </Field>
          </div>

          <Field label="Value class" hint="Each value must be an instance of this class.">
            {form.valueClassIri && (
              <div className="mb-1 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <span>{nameOf(form.valueClassIri)}</span>
                <button
                  type="button"
                  onClick={() => set("valueClassIri", null)}
                  aria-label="Remove value class"
                  className="rounded-sm p-0.5 text-slate-400 hover:text-red-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {picker === "value-class" ? (
              <ParentClassPicker
                projectId={projectId}
                branch={branch}
                excludeIris={[]}
                onSelect={(iri, label) => {
                  set("valueClassIri", iri);
                  setLabels((prev) => ({ ...prev, [iri]: label }));
                }}
                onClose={() => setPicker(null)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setPicker("value-class")}
                className="text-xs text-primary-600 hover:underline dark:text-primary-400"
              >
                {form.valueClassIri ? "Change class" : "Choose class"}
              </button>
            )}
          </Field>

          <Field label="Datatype" hint="Each value must be a literal of this datatype.">
            <select
              aria-label="Datatype"
              value={form.valueDatatypeIri}
              onChange={(e) => set("valueDatatypeIri", e.target.value)}
              className={INPUT_CLASSES}
            >
              <option value="">Any</option>
              {form.valueDatatypeIri && !COMMON_DATATYPES.includes(form.valueDatatypeIri) && (
                <option value={form.valueDatatypeIri}>{getLocalName(form.valueDatatypeIri)}</option>
              )}
              {COMMON_DATATYPES.map((iri) => (
                <option key={iri} value={iri}>
                  xsd:{getLocalName(iri)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Allowed values" hint="The only values the property may have.">
            <div className="space-y-2">
              {form.allowedValues.map((v, index) => (
                <div key={index} className="flex items-center gap-2">
                  <select
                    value={v.type}
                    onChange={(e) => setAllowedValue(index, { type: e.target.value as RuleValue["type"] })}
                    aria-label="Allowed value type"
                    className={`${INPUT_CLASSES} w-28 shrink-0`}
                  >
                    <option value="literal">Literal</option>
                    <option value="iri">IRI</option>
                  </select>
                  <input
                    value={v.value}
                    onChange={(e) => setAllowedValue(index, { value: e.target.value })}
                    aria-label="Allowed value"
                    className={INPUT_CLASSES}
                  />
                  <button
                    type="button"
                    onClick={() => set("allowedValues", form.allowedValues.filter((_, i) => i !== index))}
                    aria-label="Remove allowed value"
                    className="shrink-0 rounded-sm p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => set("allowedValues", [...form.allowedValues, { value: "", type: "literal" }])}
                className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline dark:text-primary-400"
              >
                <Plus className="h-3 w-3" />
                Add value
              </button>
            </div>
          </Field>

          <Field label="Pattern" hint="A regular expression each value must match.">
            <input aria-label="Pattern" value={form.pattern} onChange={(e) => set("pattern", e.target.value)} className={`${INPUT_CLASSES} font-mono`} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Min length">
              <input type="number" min={0} aria-label="Min length" value={form.minLength} onChange={(e) => set("minLength", e.target.value)} className={INPUT_CLASSES} />
            </Field>
            <Field label="Max length">
              <input type="number" min={0} aria-label="Max length" value={form.maxLength} onChange={(e) => set("maxLength", e.target.value)} className={INPUT_CLASSES} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.closed}
              onChange={(e) => set("closed", e.target.checked)}
              className="h-4 w-4 rounded-sm border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            Closed: instances may use only the properties that have a rule for this class
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Severity">
              <select
                aria-label="Severity"
                value={form.severity}
                onChange={(e) => set("severity", e.target.value as RuleSeverity)}
                className={INPUT_CLASSES}
              >
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </Field>
            <Field label="Name">
              <input aria-label="Name" value={form.label} onChange={(e) => set("label", e.target.value)} className={INPUT_CLASSES} />
            </Field>
          </div>

          <Field label="Message" hint="Shown for each violation. Without one, a plain message is written.">
            <input aria-label="Message" value={form.message} onChange={(e) => set("message", e.target.value)} className={INPUT_CLASSES} />
          </Field>
        </div>

        {error && (
          <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save rule"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}
