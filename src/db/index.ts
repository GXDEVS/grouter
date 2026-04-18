import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

let _db: Database | null = null;

function getDbPath(): string {
  const dir = join(homedir(), ".grouter");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "grouter.db");
}

export function db(): Database {
  if (_db) return _db;

  _db = new Database(getDbPath());
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      resource_url TEXT,
      priority INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      test_status TEXT NOT NULL DEFAULT 'unknown',
      last_error TEXT,
      error_code INTEGER,
      last_error_at TEXT,
      backoff_level INTEGER NOT NULL DEFAULT 0,
      consecutive_use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS model_locks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      locked_until TEXT NOT NULL
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS proxy_pools (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      proxy_url      TEXT NOT NULL,
      no_proxy       TEXT,
      is_active      INTEGER NOT NULL DEFAULT 1,
      test_status    TEXT NOT NULL DEFAULT 'unknown',
      last_tested_at TEXT,
      last_error     TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS provider_ports (
      provider   TEXT PRIMARY KEY,
      port       INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  TEXT NOT NULL,
      model       TEXT NOT NULL DEFAULT '',
      prompt_tokens     INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens      INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    )
  `);

  // ── Silent migrations (idempotent — safe to run on every startup) ────────────
  const cols = _db.query<{ name: string }, [string]>(
    "SELECT name FROM pragma_table_info(?)"
  ).all("accounts").map(r => r.name);

  if (!cols.includes("provider"))
    _db.exec(`ALTER TABLE accounts ADD COLUMN provider TEXT NOT NULL DEFAULT 'qwen'`);
  if (!cols.includes("auth_type"))
    _db.exec(`ALTER TABLE accounts ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'oauth'`);
  if (!cols.includes("api_key"))
    _db.exec(`ALTER TABLE accounts ADD COLUMN api_key TEXT`);
  if (!cols.includes("proxy_pool_id"))
    _db.exec(`ALTER TABLE accounts ADD COLUMN proxy_pool_id TEXT REFERENCES proxy_pools(id) ON DELETE SET NULL`);
  if (!cols.includes("provider_data"))
    _db.exec(`ALTER TABLE accounts ADD COLUMN provider_data TEXT`);

  // Seed defaults
  _db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('strategy', 'fill-first')`);
  _db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('sticky_limit', '3')`);
  _db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('proxy_port', '3099')`);

  return _db;
}

export function getSetting(key: string): string | null {
  const row = db().query<{ value: string }, [string]>(
    "SELECT value FROM settings WHERE key = ?"
  ).get(key);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db().query<void, [string, string]>(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
  ).run(key, value);
}

export function getStrategy(): "fill-first" | "round-robin" {
  return (getSetting("strategy") as "fill-first" | "round-robin") ?? "fill-first";
}

export function getStickyLimit(): number {
  return parseInt(getSetting("sticky_limit") ?? "3", 10);
}

export function getProxyPort(): number {
  return parseInt(getSetting("proxy_port") ?? "3099", 10);
}
