/**
 * SQLite access via node:sqlite (built into Node 24).
 *
 * - One DatabaseSync per process, cached on globalThis so Next dev HMR does not reopen it.
 * - On first open, every `server/schema/*.sql` file is executed (alphabetical order), so
 *   schema files must be idempotent (CREATE TABLE IF NOT EXISTS ...).
 * - Booleans are stored as 0/1, JSON as TEXT (use toJson/fromJson), timestamps as ISO strings.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DATA_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.ONTOKIT_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data"),
);
export const REPOS_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, "repos");
const SCHEMA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "server", "schema");

type GlobalWithDb = typeof globalThis & { __ontokitDb?: DatabaseSync };
const g = globalThis as GlobalWithDb;

function open(): DatabaseSync {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "ontokit.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  applySchema(db);
  return db;
}

function applySchema(db: DatabaseSync) {
  if (!fs.existsSync(SCHEMA_DIR)) return;
  for (const file of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(fs.readFileSync(path.join(SCHEMA_DIR, file), "utf8"));
  }
}

/** The shared database connection. */
export function getDb(): DatabaseSync {
  if (!g.__ontokitDb) g.__ontokitDb = open();
  return g.__ontokitDb;
}

/** Re-run all schema files (e.g. after adding a schema file during dev). */
export function reloadSchema() {
  applySchema(getDb());
}

/** Values accepted as SQL params: booleans become 0/1, undefined becomes NULL. */
export type Param = SQLInputValue | boolean | undefined;

function norm(params: Param[]): SQLInputValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
}

/** All rows. */
export function all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
  return getDb().prepare(sql).all(...norm(params)) as T[];
}

/** First row or undefined. */
export function get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
  return getDb().prepare(sql).get(...norm(params)) as T | undefined;
}

/** Execute a statement; returns `{changes, lastInsertRowid}`. */
export function run(sql: string, ...params: Param[]) {
  return getDb().prepare(sql).run(...norm(params));
}

/** Run `fn` inside a transaction (synchronous). Nested calls use savepoints. */
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

/** Insert a row from an object (keys = column names). */
export function insert(table: string, row: Record<string, Param>) {
  const cols = Object.keys(row);
  return run(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...cols.map((k) => row[k]),
  );
}

/** Update columns of rows matching `where` (object of column = value). */
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

/** JSON column helpers. */
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

/** SQLite integer -> boolean. */
export function bool(v: unknown): boolean {
  return v === 1 || v === 1n || v === true || v === "1";
}

/** Current time as ISO-8601 UTC string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** New UUID string id. */
export function newId(): string {
  return crypto.randomUUID();
}
