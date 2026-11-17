/** A compact view of the Health tab's latest results, shared by the agent's page context and the Agent tab. */
export interface AgentHealthSummary {
  /** Lint runs on the project's default branch. */
  lint: {
    errors: number;
    warnings: number;
    info: number;
    total: number;
    /** When the counts' run completed, or null when lint has never completed. */
    checkedAt: string | null;
    running: boolean;
  } | null;
  /** Consistency check on the branch open in the editor; null when it could not be loaded. */
  consistency: { count: number; checkedAt: string | null } | null;
  /** Duplicate detection on the branch open in the editor; null when it could not be loaded. */
  duplicates: { count: number; checkedAt: string | null } | null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Issues the user can act on: lint issues, consistency issues and duplicate groups. */
export function totalHealthIssues(h: AgentHealthSummary | null | undefined): number {
  if (!h) return 0;
  return (h.lint?.total ?? 0) + (h.consistency?.count ?? 0) + (h.duplicates?.count ?? 0);
}

/** Short parts such as "2 lint errors", "1 consistency issue"; empty when nothing is wrong. */
export function healthIssueParts(h: AgentHealthSummary): string[] {
  const parts: string[] = [];
  if (h.lint) {
    if (h.lint.errors) parts.push(plural(h.lint.errors, "lint error"));
    if (h.lint.warnings) parts.push(plural(h.lint.warnings, "lint warning"));
    if (h.lint.info) parts.push(`${h.lint.info} lint info`);
  }
  if (h.consistency?.count) parts.push(plural(h.consistency.count, "consistency issue"));
  if (h.duplicates?.count) parts.push(plural(h.duplicates.count, "duplicate group"));
  return parts;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function section(label: string, checkedAt: string | null | undefined, body: string): string {
  return checkedAt ? `${label}: ${body} (checked ${checkedAt})` : `${label}: never run`;
}

/** The lines added to <page_context> so the agent knows the project's health without asking. */
export function formatHealthContext(h: AgentHealthSummary): string {
  const lines = ["Health tab (latest results; call get_health_report for the issues themselves):"];
  if (h.lint) {
    const body = `${plural(h.lint.errors, "error")}, ${plural(h.lint.warnings, "warning")}, ${h.lint.info} info`;
    lines.push(`- ${section("Lint (default branch)", h.lint.checkedAt, body)}${h.lint.running ? " — a run is in progress" : ""}`);
  } else {
    lines.push("- Lint: unavailable");
  }
  lines.push(
    h.consistency
      ? `- ${section("Consistency (this branch)", h.consistency.checkedAt, plural(h.consistency.count, "issue"))}`
      : "- Consistency: unavailable",
  );
  lines.push(
    h.duplicates
      ? `- ${section("Duplicates (this branch)", h.duplicates.checkedAt, plural(h.duplicates.count, "group"))}`
      : "- Duplicates: unavailable",
  );
  return lines.join("\n");
}

/** The request "Fix issues" puts in the composer. */
export function buildHealthFixPrompt(h: AgentHealthSummary): string {
  const parts = healthIssueParts(h);
  if (!parts.length) return "Run all the health checks and tell me what you find.";
  return `Fix the issues in the Health tab (${joinList(parts)}). Start with the errors, group related fixes into clear commits, re-run the checks when you're done, and ask me before merging or deleting duplicate entities.`;
}
