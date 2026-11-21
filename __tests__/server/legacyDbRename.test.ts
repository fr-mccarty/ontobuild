// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { removeDir, useTempDataDir } from "./agent/helpers";

/** A database named ontobuilder.db (before the app was renamed) is moved to ontobuild.db, with its WAL files, so no project is lost. */

let dataDir: string;

beforeAll(() => {
  dataDir = useTempDataDir();
  const old = new DatabaseSync(path.join(dataDir, "ontobuilder.db"));
  old.exec("CREATE TABLE marker (v TEXT); INSERT INTO marker VALUES ('kept');");
  old.close();
  fs.writeFileSync(path.join(dataDir, "ontobuilder.db-wal"), "");
});
afterAll(() => removeDir(dataDir));

it("moves ontobuilder.db to ontobuild.db and keeps its contents", async () => {
  const { all, getDb } = await import("@/server/db");
  getDb();
  expect(all("SELECT v FROM marker")).toEqual([{ v: "kept" }]);
  expect(fs.existsSync(path.join(dataDir, "ontobuilder.db"))).toBe(false);
  expect(fs.existsSync(path.join(dataDir, "ontobuild.db"))).toBe(true);
});
