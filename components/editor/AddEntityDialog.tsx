"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  type EntityType,
  type IriSuffixPattern,
  labelToLocalName,
  uuidToBase62,
} from "@/lib/ontology/iriGeneration";

export interface NewEntityInfo {
  iri: string;
  label: string;
  entityType: EntityType;
  parentIri?: string;
}

interface AddEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (entity: NewEntityInfo) => void;
  iriPattern: IriSuffixPattern;
  nextNumeric?: number;
  ontologyNamespace: string;
  parentIri?: string;
  parentLabel?: string;
  initialType?: EntityType;
}

const ENTITY_TYPE_OPTIONS: { value: EntityType; label: string }[] = [
  { value: "class", label: "Class" },
  { value: "objectProperty", label: "Object Property" },
  { value: "dataProperty", label: "Data Property" },
  { value: "annotationProperty", label: "Annotation Property" },
  { value: "individual", label: "Individual" },
];

export function AddEntityDialog({
  open,
  onOpenChange,
  onConfirm,
  iriPattern,
  nextNumeric,
  ontologyNamespace,
  parentIri,
  parentLabel,
  initialType,
}: AddEntityDialogProps) {
  // Each time the dialog opens, bump `formSession` to remount the form with fresh state
  // (adjusting state during render rather than resetting it in an effect). Prop changes
  // while it stays open (e.g. a background refetch bumping `nextNumeric`) do not remount
  // it: the form derives whatever the user has not touched from the current props, so
  // what they typed is kept.
  const [prevOpen, setPrevOpen] = useState(open);
  const [formSession, setFormSession] = useState(0);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setFormSession((n) => n + 1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <AddEntityForm
          key={formSession}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          iriPattern={iriPattern}
          nextNumeric={nextNumeric}
          ontologyNamespace={ontologyNamespace}
          parentIri={parentIri}
          parentLabel={parentLabel}
          initialType={initialType}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddEntityForm({
  onOpenChange,
  onConfirm,
  iriPattern,
  nextNumeric,
  ontologyNamespace,
  parentIri,
  parentLabel,
  initialType,
}: Omit<AddEntityDialogProps, "open">) {
  // Only what the user has entered is state; every untouched field is derived from the
  // current props during render, so it follows them if they change while the dialog is open.
  const [label, setLabel] = useState("");
  const [chosenType, setChosenType] = useState<EntityType | null>(null);
  const [editedIri, setEditedIri] = useState<string | null>(null);
  // Generated once per form session so a uuid IRI does not change under the user.
  const [uuidSuffix] = useState(uuidToBase62);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const defaultType: EntityType =
    parentIri && initialType !== "individual" ? "class" : initialType ?? "class";
  // Under a parent only Class and Individual are offered, so a different earlier choice
  // falls back to the default.
  const entityType: EntityType =
    chosenType && (!parentIri || chosenType === "class" || chosenType === "individual")
      ? chosenType
      : defaultType;

  const generatedIri =
    iriPattern === "uuid"
      ? ontologyNamespace + uuidSuffix
      : iriPattern === "numeric"
        ? ontologyNamespace + String(nextNumeric ?? 1)
        : label.trim()
          ? ontologyNamespace + labelToLocalName(label)
          : ontologyNamespace + "...";
  const iri = editedIri ?? generatedIri;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedLabel = label.trim();
    const trimmedIri = iri.trim();
    if (!trimmedLabel || !trimmedIri) return;

    onConfirm({
      iri: trimmedIri,
      label: trimmedLabel,
      entityType,
      parentIri,
    });
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const parentDisplayName = parentLabel || (parentIri
    ? parentIri.includes("#")
      ? parentIri.split("#").pop()
      : parentIri.split("/").pop()
    : null);

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add Entity
        </DialogTitle>
        <DialogDescription asChild>
          <p>
            {parentIri ? (
              <>
                {entityType === "individual" ? "Create a new individual of" : "Create a new subclass of"}{" "}
                <span className="inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                  {parentDisplayName}
                </span>
              </>
            ) : (
              "Create a new entity in this ontology"
            )}
          </p>
        </DialogDescription>
      </DialogHeader>

      <div className="my-4 space-y-4">
        <div>
          <label
            htmlFor="entity-label"
            className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Label
          </label>
          <input
            ref={inputRef}
            id="entity-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g., Privileged Altar"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-primary-500 focus:outline-hidden focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
            autoComplete="off"
          />
        </div>

        <div>
          <label
            htmlFor="entity-type"
            className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Type
          </label>
          <select
            id="entity-type"
            value={entityType}
            onChange={(e) => setChosenType(e.target.value as EntityType)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-hidden focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          >
            {ENTITY_TYPE_OPTIONS.filter(
              (opt) => !parentIri || opt.value === "class" || opt.value === "individual",
            ).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {parentIri && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Class creates a subclass; Individual creates an instance of this class.
            </p>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            {showAdvanced ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Advanced
          </button>
          {showAdvanced && (
            <div className="mt-2">
              <label
                htmlFor="entity-iri"
                className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                IRI
              </label>
              <input
                id="entity-iri"
                type="text"
                value={iri}
                onChange={(e) => setEditedIri(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs placeholder:text-slate-400 focus:border-primary-500 focus:outline-hidden focus:ring-1 focus:ring-primary-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {iriPattern === "uuid" && "Auto-generated UUID-based IRI"}
                {iriPattern === "numeric" && `Sequential numeric IRI (next: ${nextNumeric ?? 1})`}
                {iriPattern === "named" && "Derived from label"}
              </p>
            </div>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!label.trim()}>
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}
