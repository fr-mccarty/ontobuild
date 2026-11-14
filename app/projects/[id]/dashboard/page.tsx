"use client";

import { useSession } from "@/lib/localUser";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Settings,
  Globe,
  Lock,
  Eye,
  Pencil,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { useProject, derivePermissions } from "@/lib/hooks/useProject";
import { cn, formatDate } from "@/lib/utils";

export default function ProjectDashboardPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const projectId = params.id as string;

  // Project data from shared React Query cache
  const { project, isLoading, error } = useProject(projectId, session?.accessToken);
  const { canEdit, canManage } = derivePermissions(project, session?.accessToken);

  if (isLoading || status === "loading") {
    return (
      <>
        <Header />
        <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
          <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
            </div>
          </div>
        </main>
      </>
    );
  }

  if (error || !project) {
    return (
      <>
        <Header />
        <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
          <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
            <Link
              href="/"
              className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to projects
            </Link>

            <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/50 dark:bg-red-900/20">
              <h2 className="text-xl font-semibold text-red-700 dark:text-red-400">
                {error || "Project not found"}
              </h2>
              <Link href="/" className="mt-4 inline-block">
                <Button variant="outline">Back to Projects</Button>
              </Link>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main id="main-content" className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-slate-900">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Back link */}
          <Link
            href={`/projects/${project.id}`}
            className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to viewer
          </Link>

          {/* Project Header */}
          <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                    {project.name}
                  </h1>
                  <div
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium",
                      project.is_public
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    )}
                  >
                    {project.is_public ? (
                      <>
                        <Globe className="h-3.5 w-3.5" />
                        Public
                      </>
                    ) : (
                      <>
                        <Lock className="h-3.5 w-3.5" />
                        Private
                      </>
                    )}
                  </div>
                </div>

                {project.description && (
                  <p className="mt-2 text-slate-600 dark:text-slate-400">
                    {project.description}
                  </p>
                )}

                <div className="mt-4 flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                  <span>Created {formatDate(project.created_at)}</span>
                  {project.updated_at && (
                    <span>Updated {formatDate(project.updated_at)}</span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 gap-2">
                {canManage && (
                  <Link href={`/projects/${project.id}/settings`}>
                    <Button variant="outline" size="sm">
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </Button>
                  </Link>
                )}
                {canEdit && (
                  <Link href={`/projects/${project.id}/editor`}>
                    <Button size="sm">
                      <Pencil className="mr-2 h-4 w-4" />
                      Open Editor
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href={`/projects/${project.id}`}
              className="rounded-lg border border-slate-200 bg-white p-5 transition-all hover:border-primary-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-600"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                <Eye className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-semibold text-slate-900 dark:text-white">
                View Ontology
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Browse the ontology structure in read-only mode
              </p>
            </Link>

            {canEdit && (
              <Link
                href={`/projects/${project.id}/editor`}
                className="rounded-lg border border-slate-200 bg-white p-5 transition-all hover:border-primary-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-600"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                  <Pencil className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-slate-900 dark:text-white">
                  Ontology Editor
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Edit classes, properties, and individuals
                </p>
              </Link>
            )}

            {canManage && (
              <Link
                href={`/projects/${project.id}/settings`}
                className="rounded-lg border border-slate-200 bg-white p-5 transition-all hover:border-primary-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-600"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                  <Settings className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-semibold text-slate-900 dark:text-white">
                  Project Settings
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Manage visibility, imports, and project details
                </p>
              </Link>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
