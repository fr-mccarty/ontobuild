import { Hono } from "hono";
import type { Context } from "hono";
import { fromJson, get, insert, nowIso, toJson, update } from "../db";
import { httpError, readJson } from "../http";
import { LOCAL_USER, userSummary } from "../user";

const r = new Hono();

interface SettingsRow {
  user_id: string;
  settings: string;
  created_at: string;
  updated_at: string | null;
}

function loadRow(): SettingsRow {
  let row = get<SettingsRow>("SELECT * FROM user_settings WHERE user_id = ?", LOCAL_USER.id);
  if (!row) {
    insert("user_settings", { user_id: LOCAL_USER.id, settings: "{}", created_at: nowIso() });
    row = get<SettingsRow>("SELECT * FROM user_settings WHERE user_id = ?", LOCAL_USER.id)!;
  }
  return row;
}

function toResponse(row: SettingsRow) {
  return {
    user_id: row.user_id,
    settings: fromJson<Record<string, unknown>>(row.settings, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function readSettingsBody(c: Context): Promise<Record<string, unknown>> {
  const body = await readJson<unknown>(c);
  if (!body || typeof body !== "object" || Array.isArray(body)) httpError(422, "Expected a JSON object");
  const obj = body as Record<string, unknown>;
  const inner = obj.settings;
  if (Object.keys(obj).length === 1 && inner && typeof inner === "object" && !Array.isArray(inner))
    return inner as Record<string, unknown>;
  return obj;
}

r.get("/users/me", (c) => c.json(userSummary()));

r.get("/users/me/settings", (c) => c.json(toResponse(loadRow())));

r.put("/users/me/settings", async (c) => {
  const next = await readSettingsBody(c);
  loadRow();
  update("user_settings", { settings: toJson(next) ?? "{}", updated_at: nowIso() }, { user_id: LOCAL_USER.id });
  return c.json(toResponse(loadRow()));
});

r.patch("/users/me/settings", async (c) => {
  const patch = await readSettingsBody(c);
  const current = fromJson<Record<string, unknown>>(loadRow().settings, {});
  const next = { ...current, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k];
  update("user_settings", { settings: toJson(next) ?? "{}", updated_at: nowIso() }, { user_id: LOCAL_USER.id });
  return c.json(toResponse(loadRow()));
});

export default r;
