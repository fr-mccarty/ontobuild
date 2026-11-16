import { describe, expect, it, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  const mockMatchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  (globalThis as Record<string, unknown>).matchMedia = mockMatchMedia;

  if (!globalThis.localStorage || typeof globalThis.localStorage.setItem !== "function") {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: (index: number) => [...store.keys()][index] ?? null,
    };
  }
});

import { usePreferencesStore, applyThemeToDOM } from "@/lib/stores/preferencesStore";

describe("applyThemeToDOM", () => {
  let addSpy: ReturnType<typeof vi.fn>;
  let removeSpy: ReturnType<typeof vi.fn>;
  let toggleSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    addSpy = vi.fn();
    removeSpy = vi.fn();
    toggleSpy = vi.fn();
    Object.defineProperty(document.documentElement, "classList", {
      value: { add: addSpy, remove: removeSpy, toggle: toggleSpy },
      writable: true,
      configurable: true,
    });
  });

  it("adds 'dark' class for dark theme", () => {
    applyThemeToDOM("dark");
    expect(addSpy).toHaveBeenCalledWith("dark");
  });

  it("removes 'dark' class for light theme", () => {
    applyThemeToDOM("light");
    expect(removeSpy).toHaveBeenCalledWith("dark");
  });

  it("toggles 'dark' class based on OS preference for system theme", () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: true }),
      writable: true,
      configurable: true,
    });

    applyThemeToDOM("system");
    expect(toggleSpy).toHaveBeenCalledWith("dark", true);
  });

  it("toggles off 'dark' class when OS prefers light", () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: false }),
      writable: true,
      configurable: true,
    });

    applyThemeToDOM("system");
    expect(toggleSpy).toHaveBeenCalledWith("dark", false);
  });
});

describe("usePreferencesStore", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      theme: "system",
      hideSaveButton: false,
    });
  });

  describe("defaults", () => {
    it("has correct initial state", () => {
      const state = usePreferencesStore.getState();
      expect(state.theme).toBe("system");
      expect(state.hideSaveButton).toBe(false);
    });
  });

  describe("setTheme", () => {
    beforeEach(() => {
      Object.defineProperty(document.documentElement, "classList", {
        value: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
        writable: true,
        configurable: true,
      });
    });

    it("sets the theme to dark and adds 'dark' class", () => {
      usePreferencesStore.getState().setTheme("dark");
      expect(usePreferencesStore.getState().theme).toBe("dark");
      expect(document.documentElement.classList.add).toHaveBeenCalledWith("dark");
    });

    it("sets the theme to light and removes 'dark' class", () => {
      usePreferencesStore.getState().setTheme("light");
      expect(usePreferencesStore.getState().theme).toBe("light");
      expect(document.documentElement.classList.remove).toHaveBeenCalledWith("dark");
    });
  });

  describe("setHideSaveButton", () => {
    it("hides the save button", () => {
      usePreferencesStore.getState().setHideSaveButton(true);
      expect(usePreferencesStore.getState().hideSaveButton).toBe(true);
    });

    it("shows the save button again", () => {
      usePreferencesStore.getState().setHideSaveButton(true);
      usePreferencesStore.getState().setHideSaveButton(false);
      expect(usePreferencesStore.getState().hideSaveButton).toBe(false);
    });
  });
});
