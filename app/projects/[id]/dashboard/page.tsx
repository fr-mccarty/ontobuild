import { redirect } from "next/navigation";

/** The project dashboard was folded into project settings; keep old links working. */
export default async function DashboardRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/settings`);
}
