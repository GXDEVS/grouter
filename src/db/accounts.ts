import { db } from "./index.ts";
import { allocateProviderPort, releaseProviderPortIfEmpty } from "./ports.ts";
import type { Connection } from "../types.ts";

const ACCOUNT_PATCH_COLUMNS = {
  display_name: "display_name",
  access_token: "access_token",
  refresh_token: "refresh_token",
  expires_at: "expires_at",
  resource_url: "resource_url",
  api_key: "api_key",
  provider_data: "provider_data",
  proxy_pool_id: "proxy_pool_id",
  priority: "priority",
  is_active: "is_active",
  test_status: "test_status",
  last_error: "last_error",
  error_code: "error_code",
  last_error_at: "last_error_at",
  backoff_level: "backoff_level",
  consecutive_use_count: "consecutive_use_count",
  last_used_at: "last_used_at",
} as const;

export type AccountPatch = Partial<Pick<Connection, keyof typeof ACCOUNT_PATCH_COLUMNS>>;

export function listAccounts(): Connection[] {
  return db()
    .query<Connection, []>("SELECT * FROM accounts ORDER BY priority ASC")
    .all();
}

export function listConnectionsByProvider(provider: string): Connection[] {
  return db()
    .query<Connection, [string]>(
      "SELECT * FROM accounts WHERE provider = ? ORDER BY priority ASC"
    )
    .all(provider);
}

export function getAccountById(id: string): Connection | null {
  return (
    db().query<Connection, [string]>("SELECT * FROM accounts WHERE id = ?").get(id) ??
    db().query<Connection, [string]>("SELECT * FROM accounts WHERE id LIKE ? || '%' LIMIT 1").get(id) ??
    null
  );
}

export function getAccountByEmail(email: string): Connection | null {
  return (
    db()
      .query<Connection, [string]>(
        "SELECT * FROM accounts WHERE email LIKE '%' || ? || '%' LIMIT 1"
      )
      .get(email) ?? null
  );
}

export function getConnectionCountByProvider(): Record<string, number> {
  const rows = db()
    .query<{ provider: string; count: number }, []>(
      "SELECT provider, COUNT(*) as count FROM accounts WHERE is_active = 1 GROUP BY provider"
    )
    .all();
  return Object.fromEntries(rows.map(r => [r.provider, r.count]));
}



export function addOAuthConnection(data: {
  provider: string;
  email: string | null;
  display_name: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  resource_url: string | null;
  api_key?: string | null;
  provider_data?: Record<string, unknown> | null;
}): Connection {
  const now = new Date().toISOString();
  const providerData = data.provider_data ? JSON.stringify(data.provider_data) : null;

  // Upsert by (provider, email)
  if (data.email) {
    const existing = db()
      .query<Connection, [string, string]>(
        "SELECT * FROM accounts WHERE provider = ? AND email = ?"
      )
      .get(data.provider, data.email);
    if (existing) {
      db().query(
        `UPDATE accounts SET access_token=?, refresh_token=?, expires_at=?, resource_url=?, api_key=?, provider_data=?, updated_at=? WHERE id=?`
      ).run(
        data.access_token,
        data.refresh_token ?? "",
        data.expires_at,
        data.resource_url,
        data.api_key ?? null,
        providerData,
        now,
        existing.id,
      );
      allocateProviderPort(data.provider);
      return getAccountById(existing.id)!;
    }
  }

  const id = crypto.randomUUID();
  const row = db().query<{ m: number }, []>(
    "SELECT COALESCE(MAX(priority), 0) as m FROM accounts"
  ).get();
  const maxPri = row?.m ?? 0;

  db().query(
    `INSERT INTO accounts
      (id, provider, auth_type, email, display_name, access_token, refresh_token, expires_at, resource_url, api_key, provider_data,
       priority, is_active, test_status, backoff_level, consecutive_use_count, created_at, updated_at)
     VALUES (?, ?, 'oauth', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'unknown', 0, 0, ?, ?)`
  ).run(
    id,
    data.provider,
    data.email,
    data.display_name,
    data.access_token,
    data.refresh_token ?? "",
    data.expires_at,
    data.resource_url,
    data.api_key ?? null,
    providerData,
    maxPri + 1,
    now,
    now,
  );

  allocateProviderPort(data.provider);
  return getAccountById(id)!;
}

// ── API Key connections ───────────────────────────────────────────────────────

export function addApiKeyConnection(data: {
  provider: string;
  api_key: string;
  display_name?: string | null;
}): Connection {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const row = db().query<{ m: number }, [string]>(
    "SELECT COALESCE(MAX(priority), 0) as m FROM accounts WHERE provider = ?"
  ).get(data.provider);
  const maxPri = row?.m ?? 0;

  db().query(
    `INSERT INTO accounts
      (id, provider, auth_type, email, display_name,
       access_token, refresh_token, expires_at, resource_url, api_key,
       priority, is_active, test_status, backoff_level, consecutive_use_count,
       created_at, updated_at)
     VALUES (?, ?, 'apikey', NULL, ?, '', '', '1970-01-01T00:00:00.000Z', NULL, ?, ?, 1, 'active', 0, 0, ?, ?)`
  ).run(id, data.provider, data.display_name ?? null, data.api_key, maxPri + 1, now, now);

  // Allocate a dedicated listener port for this provider (idempotent)
  allocateProviderPort(data.provider);

  return getAccountById(id)!;
}

export function updateAccount(id: string, patch: AccountPatch): void {
  const rawEntries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (rawEntries.length === 0) return;

  const invalidKeys = rawEntries
    .map(([k]) => k)
    .filter((k) => !(k in ACCOUNT_PATCH_COLUMNS));
  if (invalidKeys.length > 0) {
    throw new Error(`Invalid account patch field(s): ${invalidKeys.join(", ")}`);
  }

  const entries = rawEntries as Array<[keyof typeof ACCOUNT_PATCH_COLUMNS, string | number | null]>;
  const sets = entries.map(([k]) => `${ACCOUNT_PATCH_COLUMNS[k]} = ?`).join(", ");
  const values = entries.map(([, v]) => v);
  const now = new Date().toISOString();

  db().query(`UPDATE accounts SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...values, now, id);
}

export function removeAccount(id: string): boolean {
  const acc = getAccountById(id);
  const { changes } = db().query<void, [string]>(
    "DELETE FROM accounts WHERE id = ?"
  ).run(id);
  if (changes > 0) {
    reorderPriorities();
    if (acc) releaseProviderPortIfEmpty(acc.provider);
  }
  return changes > 0;
}

export function reorderPriorities(): void {
  const accounts = db()
    .query<{ id: string }, []>("SELECT id FROM accounts ORDER BY priority ASC")
    .all();
  const stmt = db().query<void, [number, string]>(
    "UPDATE accounts SET priority = ? WHERE id = ?"
  );
  accounts.forEach((a, i) => stmt.run(i + 1, a.id));
}
