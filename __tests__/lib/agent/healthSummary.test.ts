import { describe, it, expect } from "vitest";
import {
  buildHealthFixPrompt,
  formatHealthContext,
  healthIssueParts,
  totalHealthIssues,
  type AgentHealthSummary,
} from "@/lib/agent/healthSummary";
import { buildPageContext } from "@/lib/agent/pageContext";

const health: AgentHealthSummary = {
  lint: { errors: 2, warnings: 1, info: 0, total: 3, checkedAt: "2026-11-17T10:00:00Z", running: false },
  consistency: { count: 1, checkedAt: "2026-11-17T10:05:00Z" },
  duplicates: { count: 0, checkedAt: null },
  rules: null,
};

describe("healthSummary", () => {
  it("counts and describes the open issues", () => {
    expect(totalHealthIssues(health)).toBe(4);
    expect(totalHealthIssues(null)).toBe(0);
    expect(healthIssueParts(health)).toEqual(["2 lint errors", "1 lint warning", "1 consistency issue"]);
  });

  it("formats the page context lines, marking checks that never ran", () => {
    const text = formatHealthContext(health);
    expect(text).toContain("get_health_report");
    expect(text).toContain("Lint (default branch): 2 errors, 1 warning, 0 info (checked 2026-11-17T10:00:00Z)");
    expect(text).toContain("Consistency (this branch): 1 issue (checked 2026-11-17T10:05:00Z)");
    expect(text).toContain("Duplicates (this branch): never run");
  });

  it("reports unavailable sections and runs in progress", () => {
    const text = formatHealthContext({
      lint: { ...health.lint!, running: true },
      consistency: null,
      duplicates: null,
      rules: null,
    });
    expect(text).toContain("a run is in progress");
    expect(text).toContain("Consistency: unavailable");
  });

  it("builds a fix prompt from the counts", () => {
    expect(buildHealthFixPrompt(health)).toContain("(2 lint errors, 1 lint warning and 1 consistency issue)");
    const clean = { ...health, lint: { ...health.lint!, errors: 0, warnings: 0, total: 0 }, consistency: { count: 0, checkedAt: null } };
    expect(buildHealthFixPrompt(clean)).toMatch(/Run all the health checks/);
  });

  it("counts rule violations in the strip, the context and the fix prompt", () => {
    const withRules = { ...health, rules: { errors: 1, warnings: 0, info: 2, total: 3, checkedAt: "2026-11-17T10:10:00Z" } };
    expect(totalHealthIssues(withRules)).toBe(7);
    const parts = healthIssueParts(withRules);
    expect(parts.length).toBe(healthIssueParts(health).length + 2);
    expect(formatHealthContext(withRules)).toContain("2026-11-17T10:10:00Z");
    expect(buildHealthFixPrompt(withRules)).toContain(parts[parts.length - 1]);
  });

  it("is included in the agent's page context when known", () => {
    const env = { url: "u", title: "t", pageText: "" };
    expect(buildPageContext({ projectId: "p1", health }, null, env).context).toContain("Health tab");
    expect(buildPageContext({ projectId: "p1" }, null, env).context).not.toContain("Health tab");
  });
});
