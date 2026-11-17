"use client";

import Link from "next/link";
import { Import } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import type { Project } from "@/lib/api/projects";
import type { ImportStatus } from "@/lib/api/imports";
import { useImports } from "@/lib/hooks/useImports";

interface ProjectCardProps {
  project: Project;
  className?: string;
}

function importName(i: ImportStatus): string {
  return i.project_name ?? i.label ?? i.iri;
}

export function ProjectCard({ project, className }: ProjectCardProps) {
  const href = `/projects/${project.id}`;
  // Imports on the default branch; only the ones this project declares itself (owl:imports).
  const { data: importsData } = useImports(project.id);
  const imports = importsData?.closure.filter((i) => i.direct) ?? [];

  return (
    <Link
      href={href}
      aria-label={`Open project ${project.name}`}
      className={cn(
        "block rounded-lg border border-slate-200 bg-white p-5 shadow-xs transition-all",
        "hover:border-primary-300 hover:shadow-md",
        "dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-600",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
            {project.name}
          </h3>
          {project.description && (
            <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
              {project.description}
            </p>
          )}
        </div>
      </div>

      {imports.length > 0 && (
        <div className="mt-3 flex items-start gap-1.5" data-testid="project-card-imports">
          <Import
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
          <ul className="flex min-w-0 flex-wrap gap-1" aria-label="Imported ontologies">
            {imports.map((i) => (
              <li
                key={i.iri}
                title={i.iri}
                className="max-w-full truncate rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300"
              >
                {importName(i)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
        <span>Updated {formatDate(project.updated_at || project.created_at)}</span>
      </div>

    </Link>
  );
}
