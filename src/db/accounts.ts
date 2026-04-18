import { db } from "./index.ts";
import { allocateProviderPort, releaseProviderPortIfEmpty } from "./ports.ts";
import type { Connection, QwenAccount } from "../types.ts";

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

export function addAccount(data: {
  email: string | null;
  display_name: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  resource_url: string | null;
}): Connection {
  // Back-compat shim → addOAuthConnection with provider='qwen'
  return addOAuthConnection({
    provider: "qwen",
    email: data.email,
    display_name: data.display_name,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    resource_url: data.resource_url,
    api_key: null,
    provider_data: null,
  });
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
      .query<QwenAccount, [string, string]>(
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

export function updateAccount(id: string, patch: Partial<Connection>): void {
  const entries = Object.entries(patch).filter(([k]) => k !== "id");
  if (entries.length === 0) return;

  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([, v]) => v as string | number | null);
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
