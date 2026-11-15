import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor, type RenderOptions } from "@testing-library/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  rtlRender(ui, { wrapper: TooltipPrimitive.Provider, ...options });
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api/lint", () => ({
  lintApi: {
    getStatus: vi.fn(),
    getIssues: vi.fn(),
    triggerLint: vi.fn(),
    dismissIssue: vi.fn(),
    clearResults: vi.fn(),
    getLintConfig: vi.fn(),
    getLevels: vi.fn(),
  },
  isLintRunActive: (s: { last_run?: { status?: string } | null } | null | undefined) =>
    s?.last_run?.status === "pending" || s?.last_run?.status === "running",
  waitForLintRun: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/lib/api/quality", () => ({
  qualityApi: {
    triggerConsistencyCheck: vi.fn(),
    getConsistencyJobResult: vi.fn(),
    getConsistencyIssues: vi.fn(),
    triggerDuplicateDetection: vi.fn(),
    getDuplicateJobResult: vi.fn(),
    getLatestDuplicates: vi.fn(),
  },
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
  formatDateTime: (d: string) => d,
  getLocalName: (iri: string) => iri.split(/[#/]/).pop() || iri,
}));

import { HealthCheckPanel } from "@/components/editor/HealthCheckPanel";
import { lintApi, waitForLintRun } from "@/lib/api/lint";
import { qualityApi } from "@/lib/api/quality";

const mockLintApi = vi.mocked(lintApi);
const mockQualityApi = vi.mocked(qualityApi);
const mockWaitForLintRun = vi.mocked(waitForLintRun);

const baseSummary = {
  project_id: "p1",
  last_run: {
    id: "run1",
    project_id: "p1",
    status: "completed" as const,
    started_at: "2025-01-01T00:00:00Z",
    completed_at: "2025-01-01T00:01:00Z",
    issues_found: 3,
    error_message: null,
  },
  error_count: 1,
  warning_count: 1,
  info_count: 1,
  total_issues: 3,
};

const baseIssues = {
  items: [
    {
      id: "i1",
      run_id: "run1",
      project_id: "p1",
      issue_type: "error" as const,
      rule_id: "R001",
      message: "Missing label",
      subject_iri: "http://example.org/Foo",
      subject_type: "class" as const,
      details: null,
      created_at: "2025-01-01T00:00:00Z",
      resolved_at: null,
    },
    {
      id: "i2",
      run_id: "run1",
      project_id: "p1",
      issue_type: "warning" as const,
      rule_id: "R002",
      message: "Deprecated parent",
      subject_iri: null,
      subject_type: null,
      details: null,
      created_at: "2025-01-01T00:00:00Z",
      resolved_at: null,
    },
  ],
  total: 2,
  skip: 0,
  limit: 500,
};

function setup(overrides: Partial<React.ComponentProps<typeof HealthCheckPanel>> = {}) {
  const defaults = {
    projectId: "p1",
    accessToken: "tok",
    isOpen: true,
    onClose: vi.fn(),
    onNavigateToClass: vi.fn(),
    canRunLint: true,
  };
  return render(<HealthCheckPanel {...defaults} {...overrides} />);
}

describe("HealthCheckPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    mockLintApi.getStatus.mockResolvedValue(baseSummary);
    mockLintApi.getIssues.mockResolvedValue(baseIssues);
    mockLintApi.getLintConfig.mockResolvedValue({
      project_id: "p1", lint_level: 2, enabled_rules: null, effective_rules: ["R001", "R002", "R003"], updated_at: null,
    });
    mockLintApi.getLevels.mockResolvedValue({
      levels: [
        { level: 1, name: "Critical", description: "Structural errors", rule_ids: ["R001"] },
        { level: 2, name: "Consistency", description: "Consistency checks", rule_ids: ["R001", "R002", "R003"] },
        { level: 3, name: "Labels", description: "Label checks", rule_ids: ["R001", "R002", "R003", "R004"] },
      ],
    });
    mockQualityApi.getConsistencyIssues.mockResolvedValue({
      project_id: "p1",
      branch: "main",
      issues: [],
      checked_at: "",
      duration_ms: 0,
    });
    mockWaitForLintRun.mockImplementation(() => new Promise(() => {}));
    mockQualityApi.getLatestDuplicates.mockResolvedValue({
      clusters: [],
      threshold: 0.85,
      checked_at: "",
    });
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = setup({ isOpen: false });
    expect(container.innerHTML).toBe("");
  });

  it("renders header and tabs when open", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText("Health Check")).toBeDefined();
    });
    expect(screen.getByText("Lint")).toBeDefined();
    expect(screen.getByText("Consistency")).toBeDefined();
    expect(screen.getByText("Duplicates")).toBeDefined();
  });

  it("shows summary cards after data loads", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText("Errors")).toBeDefined();
    });
    expect(screen.getByText("Warnings")).toBeDefined();
    expect(screen.getByText("Info")).toBeDefined();
    expect(screen.getByText("Total")).toBeDefined();
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
  });

  it("shows lint issues", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText("Missing label")).toBeDefined();
    });
    expect(screen.getByText("Deprecated parent")).toBeDefined();
    expect(screen.getByText("R001")).toBeDefined();
  });

  it("shows Run Lint button when no completed run exists", async () => {
    mockLintApi.getStatus.mockResolvedValue({ ...baseSummary, last_run: null });
    mockLintApi.triggerLint.mockResolvedValue({
      job_id: "j1",
      status: "pending",
      message: "started",
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Run Lint")).toBeDefined();
    });
    const btn = screen.getByText("Run Lint");
    await userEvent.click(btn);
    expect(mockLintApi.triggerLint).toHaveBeenCalledWith("p1", "tok");
  });

  it("shows Clear button after completed run", async () => {
    mockLintApi.clearResults.mockResolvedValue(undefined);
    setup();
    await waitFor(() => {
      expect(screen.getByText("Clear")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Clear"));
    expect(mockLintApi.clearResults).toHaveBeenCalledWith("p1", "tok");
    await waitFor(() => {
      expect(screen.getByText("Run Lint")).toBeDefined();
    });
  });

  it("shows Run Lint (not Clear) when last run completed with zero issues", async () => {
    mockLintApi.getStatus.mockResolvedValue({
      ...baseSummary,
      error_count: 0,
      warning_count: 0,
      info_count: 0,
      total_issues: 0,
    });
    mockLintApi.getIssues.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 500 });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Run Lint")).toBeDefined();
    });
    expect(screen.queryByText("Clear")).toBeNull();
  });

  it("shows error when clear results fails", async () => {
    mockLintApi.clearResults.mockRejectedValue(new Error("Clear failed"));
    setup();
    await waitFor(() => {
      expect(screen.getByText("Clear")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Clear"));
    await waitFor(() => {
      expect(screen.getByText("Clear failed")).toBeDefined();
    });
  });

  it("keeps summary counters at zero after clearing", async () => {
    mockLintApi.clearResults.mockResolvedValue(undefined);
    setup();
    await waitFor(() => {
      expect(screen.getByText("Clear")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Clear"));
    await waitFor(() => {
      for (const label of ["Errors", "Warnings", "Info", "Total"]) {
        const card = screen.getByText(label).closest("button")!;
        const count = card.querySelector("p.text-lg")!;
        expect(count.textContent).toBe("0");
      }
    });
  });

  it("shows all-rules config hint when no config is set", async () => {
    mockLintApi.getLintConfig.mockResolvedValue({
      project_id: "p1", lint_level: null, enabled_rules: null, effective_rules: ["R001", "R002", "R003", "R004"], updated_at: null,
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText(/All rules/)).toBeDefined();
    });
  });

  it("does not show 'No issues found' when run is not completed", async () => {
    mockLintApi.getStatus.mockResolvedValue({
      ...baseSummary,
      last_run: { ...baseSummary.last_run!, status: "running" as const },
      error_count: 0, warning_count: 0, info_count: 0, total_issues: 0,
    });
    mockLintApi.getIssues.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 500 });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Running")).toBeDefined();
    });
    expect(screen.queryByText("No issues found")).toBeNull();
  });

  it("shows duplicate_iris related entities with +N more for many duplicates", async () => {
    mockLintApi.getIssues.mockResolvedValue({
      items: [
        {
          ...baseIssues.items[0],
          rule_id: "duplicate-label",
          message: "Label shared",
          details: {
            duplicate_iris: [
              "http://example.org/Alpha",
              "http://example.org/Beta",
              "http://example.org/Gamma",
              "http://example.org/Delta",
            ],
            label: "Foo",
            local_name: "Foo",
            total_duplicates: 4,
          },
        },
      ],
      total: 1, skip: 0, limit: 500,
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeDefined();
    });
    expect(screen.getByText("Beta")).toBeDefined();
    expect(screen.getByText("Gamma")).toBeDefined();
    expect(screen.queryByText("Delta")).toBeNull();
    expect(screen.getByText("+1 more")).toBeDefined();
  });

  it("shows error when triggerLint fails", async () => {
    mockLintApi.getStatus.mockResolvedValue({ ...baseSummary, last_run: null });
    mockLintApi.triggerLint.mockRejectedValue(new Error("Nope"));
    setup();
    await waitFor(() => {
      expect(screen.getByText("Run Lint")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Run Lint"));
    await waitFor(() => {
      expect(screen.getByText("Nope")).toBeDefined();
    });
  });

  it("disables Run Lint when canRunLint is false", async () => {
    mockLintApi.getStatus.mockResolvedValue({ ...baseSummary, last_run: null });
    setup({ canRunLint: false });
    await waitFor(() => {
      expect(screen.getByText("Run Lint")).toBeDefined();
    });
    const btn = screen.getByText("Run Lint").closest("button")!;
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("shows error when lint requires auth but none provided", async () => {
    mockLintApi.getStatus.mockResolvedValue({ ...baseSummary, last_run: null });
    setup({ accessToken: undefined, canRunLint: true });
    await waitFor(() => {
      expect(screen.getByText("Run Lint")).toBeDefined();
    });
    const btn = screen.getByText("Run Lint").closest("button")!;
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    setup({ onClose });
    await waitFor(() => {
      expect(screen.getByText("Health Check")).toBeDefined();
    });
    const closeBtn = screen.getByRole("button", { name: /close/i });
    expect(closeBtn).toBeTruthy();
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("hides its close button and left border when embedded", async () => {
    const { container } = setup({ embedded: true });
    await waitFor(() => {
      expect(screen.getByText("Health Check")).toBeDefined();
    });
    expect(screen.queryByRole("button", { name: /^close$/i })).toBeNull();
    expect((container.firstChild as HTMLElement).className).not.toContain("border-l");
  });

  it("displays no issues message when total is 0", async () => {
    mockLintApi.getStatus.mockResolvedValue({
      ...baseSummary,
      total_issues: 0,
      error_count: 0,
      warning_count: 0,
      info_count: 0,
    });
    mockLintApi.getIssues.mockResolvedValue({
      items: [],
      total: 0,
      skip: 0,
      limit: 500,
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("No issues found")).toBeDefined();
    });
  });

  it("displays no run yet message when last_run is null", async () => {
    mockLintApi.getStatus.mockResolvedValue({
      ...baseSummary,
      last_run: null,
      total_issues: 0,
      error_count: 0,
      warning_count: 0,
      info_count: 0,
    });
    mockLintApi.getIssues.mockResolvedValue({
      items: [],
      total: 0,
      skip: 0,
      limit: 500,
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("No lint run yet")).toBeDefined();
    });
  });

  it("shows error when fetch fails", async () => {
    mockLintApi.getStatus.mockRejectedValue(new Error("Network error"));
    setup();
    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeDefined();
    });
  });

  it("navigates to class when issue link is clicked", async () => {
    const onNav = vi.fn();
    setup({ onNavigateToClass: onNav });
    await waitFor(() => {
      expect(screen.getByText("Foo")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Foo"));
    expect(onNav).toHaveBeenCalledWith("http://example.org/Foo", "class");
  });

  it("shows entity type badge based on subject_type", async () => {
    mockLintApi.getStatus.mockResolvedValue({
      ...baseSummary,
      last_run: { ...baseSummary.last_run!, issues_found: 4 },
    });
    mockLintApi.getIssues.mockResolvedValue({
      items: [
        baseIssues.items[0],
        { ...baseIssues.items[0], id: "i3", subject_iri: "http://example.org/hasFoo", subject_type: "property" as const, rule_id: "R003", message: "Domain violation" },
        { ...baseIssues.items[0], id: "i4", subject_iri: "http://example.org/foo1", subject_type: "individual" as const, rule_id: "R004", message: "Range violation" },
        { ...baseIssues.items[0], id: "i5", subject_iri: "http://example.org/unknown1", subject_type: "other" as const, rule_id: "R005", message: "Missing type" },
      ],
      total: 4, skip: 0, limit: 500,
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Foo")).toBeDefined();
    });
    expect(screen.getByTestId("subject-type-badge-class")).toBeDefined();
    expect(screen.getByTestId("subject-type-badge-property")).toBeDefined();
    expect(screen.getByTestId("subject-type-badge-individual")).toBeDefined();
    expect(screen.getByTestId("subject-type-badge-other")).toBeDefined();
  });

  it("passes subject_type when navigating to property", async () => {
    const onNav = vi.fn();
    mockLintApi.getIssues.mockResolvedValue({
      items: [
        { ...baseIssues.items[0], subject_iri: "http://example.org/hasFoo", subject_type: "property" as const },
      ],
      total: 1, skip: 0, limit: 500,
    });
    setup({ onNavigateToClass: onNav });
    await waitFor(() => {
      expect(screen.getByText("hasFoo")).toBeDefined();
    });
    await userEvent.click(screen.getByText("hasFoo"));
    expect(onNav).toHaveBeenCalledWith("http://example.org/hasFoo", "property");
  });

  it("treats null subject_type as 'other' for navigation", async () => {
    const onNav = vi.fn();
    mockLintApi.getIssues.mockResolvedValue({
      items: [
        { ...baseIssues.items[0], subject_type: null },
      ],
      total: 1, skip: 0, limit: 500,
    });
    setup({ onNavigateToClass: onNav });
    await waitFor(() => {
      expect(screen.getByText("Foo")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Foo"));
    expect(onNav).toHaveBeenCalledWith("http://example.org/Foo", "other");
  });

  it("shows lint configuration hint", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText("Level 2 — Consistency (3 rules)")).toBeDefined();
    });
  });

  it("shows custom config hint when lint_level is null", async () => {
    mockLintApi.getLintConfig.mockResolvedValue({
      project_id: "p1", lint_level: null, enabled_rules: ["R001", "R002"], effective_rules: ["R001", "R002"], updated_at: null,
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Custom (2 rules)")).toBeDefined();
    });
  });

  it("shows related entities for duplicate-label issues", async () => {
    mockLintApi.getIssues.mockResolvedValue({
      items: [
        {
          ...baseIssues.items[0],
          rule_id: "duplicate-label",
          message: "Label 'Foo' is shared with 1 other resource(s)",
          details: {
            duplicate_iris: ["http://example.org/Bar", "http://example.org/Baz"],
            label: "Foo",
            local_name: "Foo",
            total_duplicates: 2,
          },
        },
      ],
      total: 1, skip: 0, limit: 500,
    });
    const onNav = vi.fn();
    setup({ onNavigateToClass: onNav });
    await waitFor(() => {
      expect(screen.getByText("Also:")).toBeDefined();
      expect(screen.getByText("Bar")).toBeDefined();
      expect(screen.getByText("Baz")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Bar"));
    expect(onNav).toHaveBeenCalledWith("http://example.org/Bar", "class");
  });

  it("routes duplicate IRIs using the issue's own subject_type", async () => {
    mockLintApi.getIssues.mockResolvedValue({
      items: [
        {
          ...baseIssues.items[0],
          subject_iri: "http://example.org/hasFoo",
          subject_type: "property" as const,
          rule_id: "duplicate-label",
          message: "Label 'Foo' is shared with 1 other property",
          details: {
            duplicate_iris: ["http://example.org/hasBar"],
          },
        },
      ],
      total: 1, skip: 0, limit: 500,
    });
    const onNav = vi.fn();
    setup({ onNavigateToClass: onNav });
    await waitFor(() => {
      expect(screen.getByText("hasBar")).toBeDefined();
    });
    await userEvent.click(screen.getByText("hasBar"));
    expect(onNav).toHaveBeenCalledWith("http://example.org/hasBar", "property");
  });

  it("switches to consistency tab", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText("Consistency")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Consistency"));
    await waitFor(() => {
      expect(screen.getByText("No consistency issues")).toBeDefined();
    });
  });

  it("switches to duplicates tab", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText("Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Duplicates"));
    await waitFor(() => {
      expect(screen.getByText("No duplicates detected")).toBeDefined();
    });
  });

  it("shows Run Check button on consistency tab", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText("Consistency")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Consistency"));
    await waitFor(() => {
      expect(screen.getByText("Run Check")).toBeDefined();
    });
  });

  it("shows Find Duplicates button on duplicates tab", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText("Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Duplicates"));
    await waitFor(() => {
      expect(screen.getByText("Find Duplicates")).toBeDefined();
    });
  });

  it("runs consistency check via polling when Run Check is clicked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockQualityApi.triggerConsistencyCheck.mockResolvedValue({ job_id: "cons-j1" });
      mockQualityApi.getConsistencyJobResult.mockResolvedValue({
        project_id: "p1",
        branch: "main",
        issues: [
          {
            rule_id: "orphan_class",
            severity: "warning",
            entity_iri: "http://example.org/Bar",
            entity_type: "class",
            message: "Orphan class detected",
          },
        ],
        checked_at: "",
        duration_ms: 100,
      });
      setup();
      await waitFor(() => {
        expect(screen.getByText("Consistency")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Consistency")
      );
      await waitFor(() => {
        expect(screen.getByText("Run Check")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Run Check")
      );
      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() => {
        expect(screen.getByText("Orphan class detected")).toBeDefined();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows error when consistency check trigger fails", async () => {
    mockQualityApi.triggerConsistencyCheck.mockRejectedValue(
      new Error("Consistency backend down")
    );
    setup();
    await waitFor(() => {
      expect(screen.getByText("Consistency")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Consistency"));
    await waitFor(() => {
      expect(screen.getByText("Run Check")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Run Check"));
    await waitFor(() => {
      expect(screen.getByText("Consistency backend down")).toBeDefined();
    });
  });

  it("surfaces consistency polling errors in the UI", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockQualityApi.triggerConsistencyCheck.mockResolvedValue({ job_id: "cons-500" });
      const serverError = Object.assign(new Error("Server error"), { status: 500 });
      mockQualityApi.getConsistencyJobResult.mockRejectedValue(serverError);
      setup();
      await waitFor(() => {
        expect(screen.getByText("Consistency")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Consistency")
      );
      await waitFor(() => {
        expect(screen.getByText("Run Check")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Run Check")
      );
      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() => {
        expect(screen.getByText("Server error")).toBeDefined();
      });
      expect(mockQualityApi.getConsistencyJobResult).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows consistency polling timeout when all attempts exhausted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockQualityApi.triggerConsistencyCheck.mockResolvedValue({ job_id: "cons-slow" });
      mockQualityApi.getConsistencyJobResult.mockResolvedValue({
        job_id: "cons-slow",
        status: "pending",
      } as unknown as Awaited<ReturnType<typeof qualityApi.getConsistencyJobResult>>);

      setup();
      await waitFor(() => {
        expect(screen.getByText("Consistency")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Consistency")
      );
      await waitFor(() => {
        expect(screen.getByText("Run Check")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Run Check")
      );

      for (let i = 0; i < 25; i++) {
        await vi.advanceTimersByTimeAsync(6000);
      }

      await waitFor(() => {
        expect(
          screen.getByText("Consistency check timed out — try again later")
        ).toBeDefined();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("consistency poll handles pending then complete response", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockQualityApi.triggerConsistencyCheck.mockResolvedValue({ job_id: "cons-pend" });
      let callCount = 0;
      mockQualityApi.getConsistencyJobResult.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve({ job_id: "cons-pend", status: "pending" } as never);
        }
        return Promise.resolve({
          project_id: "p1",
          branch: "main",
          issues: [
            {
              rule_id: "missing_label",
              severity: "info",
              entity_iri: "http://example.org/PendEntity",
              entity_type: "class",
              message: "Pending then complete",
            },
          ],
          checked_at: "",
          duration_ms: 50,
        });
      });
      setup();
      await waitFor(() => {
        expect(screen.getByText("Consistency")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Consistency")
      );
      await waitFor(() => {
        expect(screen.getByText("Run Check")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Run Check")
      );
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }
      await waitFor(() => {
        expect(screen.getByText("Pending then complete")).toBeDefined();
      });
      expect(mockQualityApi.getConsistencyJobResult).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads cached consistency results on tab switch", async () => {
    mockQualityApi.getConsistencyIssues.mockResolvedValue({
      project_id: "p1",
      branch: "main",
      issues: [
        {
          rule_id: "orphan_class",
          severity: "warning",
          entity_iri: "http://example.org/CachedCons",
          entity_type: "class",
          message: "Cached consistency issue",
        },
      ],
      checked_at: "",
      duration_ms: 50,
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Consistency")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Consistency"));
    await waitFor(() => {
      expect(screen.getByText("Cached consistency issue")).toBeDefined();
    });
  });

  it("loads cached duplicates results on tab switch", async () => {
    mockQualityApi.getLatestDuplicates.mockResolvedValue({
      clusters: [
        {
          entities: [
            { iri: "http://example.org/CachedA", label: "CachedA", entity_type: "class" },
            { iri: "http://example.org/CachedB", label: "CachedB", entity_type: "class" },
          ],
          similarity: 0.87,
        },
      ],
      threshold: 0.85,
      checked_at: "",
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Duplicates"));
    await waitFor(() => {
      expect(screen.getByText("CachedA")).toBeDefined();
    });
    expect(screen.getByText("87% similar")).toBeDefined();
  });

  it("logs error when cached consistency fetch fails on tab switch", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQualityApi.getConsistencyIssues.mockRejectedValue(new Error("Network fail"));
    setup();
    await waitFor(() => {
      expect(screen.getByText("Consistency")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Consistency"));
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load cached consistency issues"),
        expect.objectContaining({ projectId: "p1", err: expect.any(Error) })
      );
    });
    consoleSpy.mockRestore();
  });

  it("logs error when cached duplicates fetch fails on tab switch", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQualityApi.getLatestDuplicates.mockRejectedValue(new Error("Network fail"));
    setup();
    await waitFor(() => {
      expect(screen.getByText("Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Duplicates"));
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load cached duplicates"),
        expect.objectContaining({ projectId: "p1", err: expect.any(Error) })
      );
    });
    consoleSpy.mockRestore();
  });

  it("detects duplicates via polling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const duplicateResult = {
        clusters: [
          {
            entities: [
              { iri: "http://example.org/A", label: "EntityA", entity_type: "class" },
              { iri: "http://example.org/B", label: "EntityB", entity_type: "class" },
            ],
            similarity: 0.92,
          },
        ],
        threshold: 0.85,
        checked_at: "",
      };
      mockQualityApi.triggerDuplicateDetection.mockResolvedValue({ job_id: "dup-j1" });
      mockQualityApi.getDuplicateJobResult.mockResolvedValue(duplicateResult);
      setup();
      await waitFor(() => {
        expect(screen.getByText("Duplicates")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Duplicates")
      );
      await waitFor(() => {
        expect(screen.getByText("Find Duplicates")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Find Duplicates")
      );
      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() => {
        expect(screen.getByText("92% similar")).toBeDefined();
      });
      expect(screen.getByText("EntityA")).toBeDefined();
      expect(screen.getByText("EntityB")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows Running status when lint is in progress", async () => {
    mockLintApi.getStatus.mockResolvedValue({
      ...baseSummary,
      last_run: {
        ...baseSummary.last_run!,
        status: "running" as const,
      },
    });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Running")).toBeDefined();
    });
  });

  it("dismisses an issue when dismiss button is clicked", async () => {
    mockLintApi.dismissIssue.mockResolvedValue(undefined as never);
    setup();
    await waitFor(() => {
      expect(screen.getByText("Missing label")).toBeDefined();
    });
    const dismissBtns = screen.getAllByLabelText("Dismiss issue");
    expect(dismissBtns.length).toBeGreaterThan(0);
    await userEvent.click(dismissBtns[0]);
    expect(mockLintApi.dismissIssue).toHaveBeenCalledWith("p1", "i1", "tok");
  });

  it("shows error when duplicate detection trigger fails", async () => {
    mockQualityApi.triggerDuplicateDetection.mockRejectedValue(
      new Error("Backend unavailable")
    );
    setup();
    await waitFor(() => {
      expect(screen.getByText("Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Duplicates"));
    await waitFor(() => {
      expect(screen.getByText("Find Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Find Duplicates"));
    await waitFor(() => {
      expect(screen.getByText("Backend unavailable")).toBeDefined();
    });
  });

  it("surfaces polling errors in the UI", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockQualityApi.triggerDuplicateDetection.mockResolvedValue({ job_id: "dup-500" });
      const serverError = Object.assign(new Error("Internal server error"), { status: 500 });
      mockQualityApi.getDuplicateJobResult.mockRejectedValue(serverError);
      setup();
      await waitFor(() => {
        expect(screen.getByText("Duplicates")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Duplicates")
      );
      await waitFor(() => {
        expect(screen.getByText("Find Duplicates")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Find Duplicates")
      );
      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() => {
        expect(screen.getByText("Internal server error")).toBeDefined();
      });
      expect(mockQualityApi.getDuplicateJobResult).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads cached duplicates when switching to duplicates tab", async () => {
    const cachedResult = {
      clusters: [
        {
          entities: [
            { iri: "http://example.org/X", label: "CachedX", entity_type: "class" },
            { iri: "http://example.org/Y", label: "CachedY", entity_type: "class" },
          ],
          similarity: 0.88,
        },
      ],
      threshold: 0.85,
      checked_at: "",
    };
    mockQualityApi.getLatestDuplicates.mockResolvedValue(cachedResult);
    setup();
    await waitFor(() => {
      expect(screen.getByText("Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Duplicates"));
    await waitFor(() => {
      expect(screen.getByText("CachedX")).toBeDefined();
    });
    expect(screen.getByText("CachedY")).toBeDefined();
    expect(screen.getByText("88% similar")).toBeDefined();
  });

  it("navigates to entity when duplicate entity is clicked", async () => {
    const onNav = vi.fn();
    const cachedResult = {
      clusters: [
        {
          entities: [
            { iri: "http://example.org/DupA", label: "DupA", entity_type: "class" },
            { iri: "http://example.org/DupB", label: "DupB", entity_type: "property" },
          ],
          similarity: 0.95,
        },
      ],
      threshold: 0.85,
      checked_at: "",
    };
    mockQualityApi.getLatestDuplicates.mockResolvedValue(cachedResult);
    setup({ onNavigateToClass: onNav });
    await waitFor(() => {
      expect(screen.getByText("Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Duplicates"));
    await waitFor(() => {
      expect(screen.getByText("DupA")).toBeDefined();
    });
    await userEvent.click(screen.getByText("DupA"));
    expect(onNav).toHaveBeenCalledWith("http://example.org/DupA", "class");
  });

  it("navigates to entity from consistency issue", async () => {
    const onNav = vi.fn();
    mockQualityApi.getConsistencyIssues.mockResolvedValue({
      project_id: "p1",
      branch: "main",
      issues: [
        {
          rule_id: "orphan_class",
          severity: "warning",
          entity_iri: "http://example.org/ConsEntity",
          entity_type: "class",
          message: "Orphan detected",
        },
      ],
      checked_at: "",
      duration_ms: 50,
    });
    setup({ onNavigateToClass: onNav });
    await waitFor(() => {
      expect(screen.getByText("Consistency")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Consistency"));
    await waitFor(() => {
      expect(screen.getByText("ConsEntity")).toBeDefined();
    });
    await userEvent.click(screen.getByText("ConsEntity"));
    expect(onNav).toHaveBeenCalledWith("http://example.org/ConsEntity", "class");
  });

  it("consistency check does nothing without access token", async () => {
    setup({ accessToken: undefined });
    await waitFor(() => {
      expect(screen.getByText("Consistency")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Consistency"));
    await waitFor(() => {
      expect(screen.getByText("Run Check")).toBeDefined();
    });
    expect(mockQualityApi.triggerConsistencyCheck).not.toHaveBeenCalled();
  });

  it("duplicate detection does nothing without access token", async () => {
    setup({ accessToken: undefined });
    await waitFor(() => {
      expect(screen.getByText("Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Duplicates"));
    await waitFor(() => {
      expect(screen.getByText("Find Duplicates")).toBeDefined();
    });
    expect(mockQualityApi.triggerDuplicateDetection).not.toHaveBeenCalled();
  });

  it("shows timeout error when polling exhausts all attempts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockQualityApi.triggerDuplicateDetection.mockResolvedValue({ job_id: "dup-slow" });
      mockQualityApi.getDuplicateJobResult.mockResolvedValue({
        job_id: "dup-slow",
        status: "pending",
      } as unknown as Awaited<ReturnType<typeof qualityApi.getDuplicateJobResult>>);

      setup();
      await waitFor(() => {
        expect(screen.getByText("Duplicates")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Duplicates")
      );
      await waitFor(() => {
        expect(screen.getByText("Find Duplicates")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Find Duplicates")
      );

      for (let i = 0; i < 25; i++) {
        await vi.advanceTimersByTimeAsync(6000);
      }

      await waitFor(() => {
        expect(
          screen.getByText("Duplicate detection timed out — try again later")
        ).toBeDefined();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows generic error when trigger throws non-Error value", async () => {
    mockQualityApi.triggerDuplicateDetection.mockRejectedValue("string-error");
    setup();
    await waitFor(() => {
      expect(screen.getByText("Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Duplicates"));
    await waitFor(() => {
      expect(screen.getByText("Find Duplicates")).toBeDefined();
    });
    await userEvent.click(screen.getByText("Find Duplicates"));
    await waitFor(() => {
      expect(screen.getByText("Duplicate detection failed")).toBeDefined();
    });
  });

  it("cancels polling loop on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockQualityApi.triggerDuplicateDetection.mockResolvedValue({ job_id: "dup-cancel" });
      mockQualityApi.getDuplicateJobResult.mockResolvedValue({
        job_id: "dup-cancel",
        status: "pending",
      } as unknown as Awaited<ReturnType<typeof qualityApi.getDuplicateJobResult>>);

      const { unmount } = setup();

      await waitFor(() => {
        expect(screen.getByText("Duplicates")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Duplicates")
      );
      await waitFor(() => {
        expect(screen.getByText("Find Duplicates")).toBeDefined();
      });
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByText("Find Duplicates")
      );

      await vi.advanceTimersByTimeAsync(1500);
      const callsBefore = mockQualityApi.getDuplicateJobResult.mock.calls.length;

      unmount();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockQualityApi.getDuplicateJobResult.mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels deferred cache fetch when tab switches before rAF fires", async () => {
    const pendingCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      pendingCallbacks.push(cb);
      return pendingCallbacks.length;
    });

    setup();
    await waitFor(() => {
      expect(screen.getByText("Consistency")).toBeDefined();
    });

    await userEvent.click(screen.getByText("Consistency"));

    await userEvent.click(screen.getByText("Duplicates"));

    pendingCallbacks.forEach((cb) => cb(0));

    await waitFor(() => {
      expect(screen.getByText("No duplicates detected")).toBeDefined();
    });

    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
  });

  it("polls lint status after triggering a run and refreshes when it finishes", async () => {
    const user = userEvent.setup();
    mockLintApi.getStatus.mockResolvedValueOnce({ ...baseSummary, last_run: null, total_issues: 0, error_count: 0, warning_count: 0, info_count: 0 });
    mockLintApi.triggerLint.mockResolvedValue({ job_id: "j1", status: "queued", message: "" });
    let finish: (v: typeof baseSummary) => void = () => {};
    mockWaitForLintRun.mockImplementation(() => new Promise((resolve) => { finish = resolve as typeof finish; }));
    setup({ canRunLint: true });
    const runButton = await screen.findByRole("button", { name: /run lint/i });
    const statusCallsBefore = mockLintApi.getStatus.mock.calls.length;
    await user.click(runButton);
    await waitFor(() => expect(mockWaitForLintRun).toHaveBeenCalledWith("p1", expect.objectContaining({ signal: expect.anything() })));
    finish(baseSummary);
    await waitFor(() => expect(mockLintApi.getStatus.mock.calls.length).toBeGreaterThan(statusCallsBefore));
  });
});
