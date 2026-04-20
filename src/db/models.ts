// ── Provider model storage (SQLite) ──────────────────────────────────────────
// Stores dynamically fetched models per provider, replacing hardcoded lists.

import { db } from "./index.ts";

// Ensure table exists (called lazily)
let _initialized = false;
function ensureTable(): void {
  if (_initialized) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS provider_models (
      provider   TEXT NOT NULL,
      model_id   TEXT NOT NULL,
      model_name TEXT NOT NULL DEFAULT '',
      is_free    INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider, model_id)
    )
  `);
  _initialized = true;
}

export interface StoredModel {
  provider: string;
  model_id: string;
  model_name: string;
  is_free: boolean;
  updated_at: string;
}

/** Save models for a provider, replacing all existing entries. */
export function saveProviderModels(
  provider: string,
  models: { id: string; name: string; is_free?: boolean }[],
): void {
  ensureTable();
  const d = db();
  const now = new Date().toISOString();

  d.exec("BEGIN TRANSACTION");
  try {
    d.query<void, [string]>(
      "DELETE FROM provider_models WHERE provider = ?",
    ).run(provider);

    const insert = d.query<void, [string, string, string, number, string]>(
      "INSERT OR REPLACE INTO provider_models (provider, model_id, model_name, is_free, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const m of models) {
      insert.run(provider, m.id, m.name || m.id, m.is_free ? 1 : 0, now);
    }
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

/** Get all stored models for a provider. */
export function getProviderModels(provider: string): StoredModel[] {
  ensureTable();
  return db()
    .query<StoredModel, [string]>(
      "SELECT provider, model_id, model_name, is_free, updated_at FROM provider_models WHERE provider = ? ORDER BY model_name",
    )
    .all(provider)
    .map((r) => ({ ...r, is_free: !!r.is_free }));
}

/** Get all stored models across all providers. */
export function getAllProviderModels(): StoredModel[] {
  ensureTable();
  return db()
    .query<StoredModel, []>(
      "SELECT provider, model_id, model_name, is_free, updated_at FROM provider_models ORDER BY provider, model_name",
    )
    .all()
    .map((r) => ({ ...r, is_free: !!r.is_free }));
}

/** Check if a provider has any stored models. */
export function hasStoredModels(provider: string): boolean {
  ensureTable();
  const row = db()
    .query<{ cnt: number }, [string]>(
      "SELECT COUNT(*) as cnt FROM provider_models WHERE provider = ?",
    )
    .get(provider);
  return (row?.cnt ?? 0) > 0;
}
