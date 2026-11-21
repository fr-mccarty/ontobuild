import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePreference = "light" | "dark" | "system";

interface PreferencesState {
  theme: ThemePreference;
  hideSaveButton: boolean;
  setTheme: (theme: ThemePreference) => void;
  setHideSaveButton: (on: boolean) => void;
}

export function applyThemeToDOM(theme: ThemePreference) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "light") {
    root.classList.remove("dark");
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  }
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "system",
      hideSaveButton: false,

      setTheme: (theme) => {
        applyThemeToDOM(theme);
        set({ theme });
      },

      setHideSaveButton: (on) => set({ hideSaveButton: on }),
    }),
    {
      name: "ontobuild-editor-preferences",
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyThemeToDOM(state.theme);
        }
      },
    },
  ),
);

if (typeof window !== "undefined") {
  usePreferencesStore.persist.onFinishHydration(() => {
    applyThemeToDOM(usePreferencesStore.getState().theme);
  });

  usePreferencesStore.subscribe((state, prev) => {
    if (state.theme !== prev.theme) {
      applyThemeToDOM(state.theme);
    }
  });

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (usePreferencesStore.getState().theme === "system") {
        applyThemeToDOM("system");
      }
    });
}
