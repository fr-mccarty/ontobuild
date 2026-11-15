"use client";

import Link from "next/link";
import { cn, formatDate } from "@/lib/utils";
import type { Project } from "@/lib/api/projects";

interface ProjectCardProps {
  project: Project;
  className?: string;
}

export function ProjectCard({ project, className }: ProjectCardProps) {
  const href = `/projects/${project.id}`;

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

      <div className="mt-4 flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
        <span>Updated {formatDate(project.updated_at || project.created_at)}</span>
      </div>

      {project.is_exemplar && (
        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
            Exemplar
          </span>
        </div>
      )}
    </Link>
  );
}
