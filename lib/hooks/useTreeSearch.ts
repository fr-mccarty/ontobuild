"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { projectOntologyApi, type EntitySearchResult } from "@/lib/api/client";

interface UseTreeSearchOptions {
  projectId: string;
  branch?: string;
  onSearchSelect: (iri: string) => void;
  /** Called when Cmd/Ctrl+K opens the search, e.g. to reveal a collapsed tree panel. */
  onShortcut?: () => void;
}

interface UseTreeSearchReturn {
  showSearch: boolean;
  searchQuery: string;
  searchResults: EntitySearchResult[] | null;
  isSearching: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  toggleSearch: () => void;
  closeSearch: () => void;
  setSearchQuery: (query: string) => void;
  handleSearchSelect: (iri: string) => void;
}

export function useTreeSearch({
  projectId,
  branch,
  onSearchSelect,
  onShortcut,
}: UseTreeSearchOptions): UseTreeSearchReturn {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EntitySearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const onShortcutRef = useRef(onShortcut);
  useEffect(() => {
    onShortcutRef.current = onShortcut;
  }, [onShortcut]);

  const toggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 0);
      } else {
        setSearchQuery("");
        setSearchResults(null);
      }
      return !prev;
    });
  }, []);

  const closeSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults(null);
  }, []);

  // Cmd+K (Mac) / Ctrl+K opens the search, or refocuses it if it is already open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (document.querySelector("[data-state='open'][role='dialog']")) return;
      if (document.activeElement?.closest(".monaco-editor")) return;
      e.preventDefault();
      onShortcutRef.current?.();
      setShowSearch(true);
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 0);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleSearchSelect = useCallback(
    (iri: string) => {
      onSearchSelect(iri);
      closeSearch();
    },
    [onSearchSelect, closeSearch],
  );

  useEffect(() => {
    if (!showSearch) return;
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await projectOntologyApi.searchEntities(
          projectId,
          searchQuery.trim(),
          branch,
        );
        setSearchResults(response.results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, showSearch, projectId, branch]);

  return {
    showSearch,
    searchQuery,
    searchResults,
    isSearching,
    searchInputRef,
    toggleSearch,
    closeSearch,
    setSearchQuery,
    handleSearchSelect,
  };
}
