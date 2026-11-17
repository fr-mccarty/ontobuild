"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X } from "lucide-react";
import { cn, getLocalName } from "@/lib/utils";
import { projectOntologyApi, type EntitySearchResult } from "@/lib/api/client";
import type { ImportedMarker } from "@/lib/ontology/types";
import { Tooltip } from "@/components/ui/tooltip";

type PickerResult = EntitySearchResult & ImportedMarker;

interface ParentClassPickerProps {
  projectId: string;
  branch?: string;
  excludeIris: string[];
  onSelect: (iri: string, label: string) => void;
  onClose: () => void;
}

export function ParentClassPicker({
  projectId,
  branch,
  excludeIris,
  onSelect,
  onClose,
}: ParentClassPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await projectOntologyApi.searchEntities(
          projectId,
          query.trim(),
          branch,
          "class",
        );
        const excludeSet = new Set(excludeIris);
        setResults(response.results.filter((r) => !excludeSet.has(r.iri)));
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, projectId, branch, excludeIris]);

  const handleSelect = useCallback(
    (result: PickerResult) => {
      onSelect(result.iri, result.label || getLocalName(result.iri));
      onClose();
    },
    [onSelect, onClose],
  );

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-700"
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-600">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder="Search for a class..."
          className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden dark:text-white dark:placeholder:text-slate-500"
        />
        <button
          onClick={onClose}
          className="rounded-sm p-0.5 hover:bg-slate-100 dark:hover:bg-slate-600"
        >
          <X className="h-3.5 w-3.5 text-slate-400" />
        </button>
      </div>

      <div className="max-h-48 overflow-y-auto">
        {isSearching ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
          </div>
        ) : results.length > 0 ? (
          <div className="py-1">
            {results.map((result) => (
              <button
                key={result.iri}
                onClick={() => handleSelect(result)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                  "hover:bg-slate-50 dark:hover:bg-slate-600",
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-owl-class/10 border border-owl-class/50">
                  <span className="text-[9px] font-bold text-owl-class">C</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900 dark:text-white">
                    {result.label || getLocalName(result.iri)}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {result.iri}
                  </p>
                </div>
                {result.imported_from && (
                  <Tooltip
                    content={`Imported from ${result.imported_from_label ? `${result.imported_from_label} (${result.imported_from})` : result.imported_from}`}
                  >
                    <span className="shrink-0 rounded-sm border border-slate-300 px-1 text-[10px] uppercase leading-4 tracking-wide text-slate-500 dark:border-slate-500 dark:text-slate-300">
                      imported
                    </span>
                  </Tooltip>
                )}
              </button>
            ))}
          </div>
        ) : query.trim() ? (
          <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            No classes found
          </p>
        ) : (
          <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            Type to search for classes
          </p>
        )}
      </div>
    </div>
  );
}
