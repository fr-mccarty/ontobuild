export type SelectableEntityType = "class" | "property" | "individual";

interface Selection {
  iri: string;
  type: SelectableEntityType;
}

export const SELECTION_PARAM_BY_TYPE: Readonly<Record<SelectableEntityType, string>> = Object.freeze({
  class: "classIri",
  property: "propertyIri",
  individual: "individualIri",
});

const SELECTION_TYPES_IN_PRIORITY: readonly SelectableEntityType[] = ["class", "property", "individual"];

export function readSelectionFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): Selection | null {
  for (const type of SELECTION_TYPES_IN_PRIORITY) {
    const iri = searchParams.get(SELECTION_PARAM_BY_TYPE[type]);
    if (iri) return { iri, type };
  }
  return null;
}

export function buildSelectionQuery(selection: Selection | null): string {
  if (!selection || !selection.iri) return "";
  const key = SELECTION_PARAM_BY_TYPE[selection.type];
  return `?${key}=${encodeURIComponent(selection.iri)}`;
}
