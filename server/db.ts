import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DATA_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.ONTOBUILD_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data"),
);
/** Legacy location of bare project repositories, moved into PROJECTS_DIR by server/workspace.ts. */
export const REPOS_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, "repos");
export const PROJECTS_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, "projects");
const SCHEMA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "server", "schema");

type GlobalWithDb = typeof globalThis & { __ontobuildDb?: DatabaseSync; __ontobuildSchema?: string };
const g = globalThis as GlobalWithDb;

function open(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  migrateLegacyDbFile();
  const db = new DatabaseSync(path.join(DATA_DIR, "ontobuild.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  applySchema(db);
  return db;
}

/**
 * Renames the database from an earlier name to data/ontobuild.db (with its -wal and -shm files),
 * if the earlier file is all there is: data/ontobuilder.db, or before that data/ontokit.db.
 */
function migrateLegacyDbFile() {
  const to = path.join(DATA_DIR, "ontobuild.db");
  if (fs.existsSync(to)) return;
  for (const legacy of ["ontobuilder.db", "ontokit.db"]) {
    const from = path.join(DATA_DIR, legacy);
    if (!fs.existsSync(from)) continue;
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(from + suffix)) fs.renameSync(from + suffix, to + suffix);
    }
    return;
  }
}

function applySchema(db: DatabaseSync) {
  if (!fs.existsSync(SCHEMA_DIR)) return;
  for (const file of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(SCHEMA_DIR, file), "utf8"));
  }
  for (const [table, column, type] of ADDED_COLUMNS) ensureColumn(db, table, column, type);
  g.__ontobuildSchema = schemaKey();
  // Indexes on added columns: they can only be made once the column exists.
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_folder ON projects(folder)");
  db.exec("CREATE INDEX IF NOT EXISTS ix_normalization_runs_file ON normalization_runs(project_id, ontology_path, created_at)");
}

/** Columns added after a table was first created (CREATE TABLE IF NOT EXISTS won't add them). */
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  ["projects", "folder", "TEXT"],
  // The ontology file a normalization run was about. Rows from before the column existed are NULL:
  // they count as the project's current file until it switches files (see server/routes/normalization.ts).
  ["normalization_runs", "ontology_path", "TEXT"],
];

function ensureColumn(db: DatabaseSync, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/** Identifies the schema this code expects; see getDb. */
function schemaKey(): string {
  return JSON.stringify(ADDED_COLUMNS);
}

export function getDb(): DatabaseSync {
  if (!g.__ontobuildDb) g.__ontobuildDb = open();
  // The connection outlives a code reload in development (it is kept on globalThis), so apply
  // schema changes made since it was opened. Everything in applySchema is idempotent.
  else if (g.__ontobuildSchema !== schemaKey()) applySchema(g.__ontobuildDb);
  return g.__ontobuildDb;
}

export type Param = SQLInputValue | boolean | undefined;

function norm(params: Param[]): SQLInputValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
}

export function all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
  return getDb().prepare(sql).all(...norm(params)) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
  return getDb().prepare(sql).get(...norm(params)) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  return getDb().prepare(sql).run(...norm(params));
}

let txDepth = 0;
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  const sp = `sp_${txDepth}`;
  db.exec(txDepth === 0 ? "BEGIN" : `SAVEPOINT ${sp}`);
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    db.exec(txDepth === 0 ? "COMMIT" : `RELEASE ${sp}`);
    return result;
  } catch (e) {
    txDepth--;
    db.exec(txDepth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}`);
    throw e;
  }
}

export function insert(table: string, row: Record<string, Param>) {
  const cols = Object.keys(row);
  return run(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...cols.map((k) => row[k]),
  );
}

export function update(table: string, set: Record<string, Param>, where: Record<string, Param>) {
  const sc = Object.keys(set);
  const wc = Object.keys(where);
  if (sc.length === 0) return { changes: 0, lastInsertRowid: 0 };
  return run(
    `UPDATE ${table} SET ${sc.map((k) => `${k} = ?`).join(", ")} WHERE ${wc.map((k) => `${k} = ?`).join(" AND ")}`,
    ...sc.map((k) => set[k]),
    ...wc.map((k) => where[k]),
  );
}

export function toJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}
export function fromJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || !text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function bool(v: unknown): boolean {
  return v === 1 || v === 1n || v === true || v === "1";
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
