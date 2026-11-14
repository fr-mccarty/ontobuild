"use client";

import Link from "next/link";
import { useSession } from "@/lib/localUser";
import { Globe, Lock } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import type { Project } from "@/lib/api/projects";
import { derivePermissions } from "@/lib/hooks/useProject";
import { useEditorModeStore } from "@/lib/stores/editorModeStore";

interface ProjectCardProps {
  project: Project;
  className?: string;
}

export function ProjectCard({ project, className }: ProjectCardProps) {
  const { data: session } = useSession();
  const { canEdit } = derivePermissions(project, session?.accessToken);
  const preferEditMode = useEditorModeStore((s) => s.preferEditMode);

  // When the user has prefer-edit-mode on AND has edit rights, open the
  // project straight to the editor.
  const href = preferEditMode && canEdit
    ? `/projects/${project.id}/editor`
    : `/projects/${project.id}`;

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
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            project.is_public
              ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
              : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
          )}
          title={project.is_public ? "Public project" : "Private project"}
        >
          {project.is_public ? (
            <Globe className="h-4 w-4" />
          ) : (
            <Lock className="h-4 w-4" />
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
