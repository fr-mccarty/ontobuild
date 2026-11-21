// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeDir, useTempDataDir } from "./agent/helpers";

/** Opening a database made before normalization runs recorded their ontology file. */

let dataDir: string;

beforeAll(() => {
  dataDir = useTempDataDir();
  // The table as it was before `ontology_path`, with one run in it.
  const old = new DatabaseSync(path.join(dataDir, "ontobuild.db"));
  old.exec(`
    CREATE TABLE normalization_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      triggered_by TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      report_json TEXT NOT NULL,
      original_format TEXT NOT NULL,
      original_size_bytes INTEGER NOT NULL,
      normalized_size_bytes INTEGER NOT NULL,
      triple_count INTEGER NOT NULL,
      prefixes_removed_count INTEGER NOT NULL DEFAULT 0,
      prefixes_added_count INTEGER NOT NULL DEFAULT 0,
      format_converted INTEGER NOT NULL DEFAULT 0,
      is_dry_run INTEGER NOT NULL DEFAULT 0,
      commit_hash TEXT
    );
    INSERT INTO normalization_runs (id, project_id, created_at, report_json, original_format, original_size_bytes, normalized_size_bytes, triple_count)
    VALUES ('old-run', 'p1', '2024-01-01T00:00:00Z', '{}', 'Turtle', 1, 1, 1);
  `);
  old.close();
});

afterAll(() => removeDir(dataDir));

describe("Database migration", () => {
  it("adds normalization_runs.ontology_path, keeping the old runs (with no path)", async () => {
    const { all, getDb } = await import("@/server/db");
    getDb();
    const cols = all<{ name: string }>("PRAGMA table_info(normalization_runs)").map((c) => c.name);
    expect(cols).toContain("ontology_path");
    expect(all("SELECT id, ontology_path FROM normalization_runs")).toEqual([{ id: "old-run", ontology_path: null }]);
    const indexes = all<{ name: string }>("PRAGMA index_list(normalization_runs)").map((i) => i.name);
    expect(indexes).toContain("ix_normalization_runs_file");
    expect(fs.existsSync(path.join(dataDir, "ontobuild.db"))).toBe(true);
  });

  it("applies schema changes to a connection opened by older code (a reload in development)", async () => {
    const { all, getDb, run } = await import("@/server/db");
    const g = globalThis as typeof globalThis & { __ontobuildSchema?: string };
    getDb();
    run("DROP INDEX ix_normalization_runs_file");
    g.__ontobuildSchema = "older code";
    getDb();
    expect(all<{ name: string }>("PRAGMA index_list(normalization_runs)").map((i) => i.name)).toContain("ix_normalization_runs_file");
  });
});
