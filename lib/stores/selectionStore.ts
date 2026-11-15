import { create } from "zustand";

import type { SelectableEntityType } from "@/lib/utils/selectionUrl";

interface SelectionState {
  iri: string | null;
  type: SelectableEntityType | null;
  setSelection: (iri: string | null, type: SelectableEntityType | null) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  iri: null,
  type: null,
  setSelection: (iri, type) => set({ iri, type }),
  clear: () => set({ iri: null, type: null }),
}));
