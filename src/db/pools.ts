import { db } from "./index.ts";

export interface ProxyPool {
  id: string;
  name: string;
  proxy_url: string;
  no_proxy: string | null;
  is_active: number;        // SQLite boolean (0/1)
  test_status: string;      // "unknown" | "active" | "error"
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function listProxyPools(): ProxyPool[] {
  return db().query<ProxyPool, []>("SELECT * FROM proxy_pools ORDER BY created_at ASC").all();
}

export function getProxyPoolById(id: string): ProxyPool | null {
  return db().query<ProxyPool, [string]>("SELECT * FROM proxy_pools WHERE id = ?").get(id) ?? null;
}

export function getConnectionCountForPool(poolId: string): number {
  const row = db()
    .query<{ n: number }, [string]>("SELECT COUNT(*) as n FROM accounts WHERE proxy_pool_id = ?")
    .get(poolId);
  return row?.n ?? 0;
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function createProxyPool(data: {
  name: string;
  proxy_url: string;
  no_proxy?: string | null;
}): ProxyPool {
  const now = new Date().toISOString();
  const id  = crypto.randomUUID();
  db().query(
    `INSERT INTO proxy_pools (id, name, proxy_url, no_proxy, is_active, test_status, last_tested_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 'unknown', NULL, NULL, ?, ?)`
  ).run(id, data.name, data.proxy_url, data.no_proxy ?? null, now, now);
  return getProxyPoolById(id)!;
}

export function updateProxyPool(id: string, patch: Partial<Omit<ProxyPool, "id" | "created_at">>): void {
  const entries = Object.entries(patch);
  if (!entries.length) return;
  const now = new Date().toISOString();
  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  db().query(`UPDATE proxy_pools SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, v]) => v as string | number | null), now, id);
}

export function deleteProxyPool(id: string): boolean {
  const { changes } = db().query<void, [string]>("DELETE FROM proxy_pools WHERE id = ?").run(id);
  return changes > 0;
}

// ── Test ──────────────────────────────────────────────────────────────────────

export async function testProxyPool(pool: ProxyPool): Promise<{ ok: boolean; elapsedMs: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch("https://1.1.1.1", {
      method: "HEAD",
      // @ts-ignore — Bun-specific proxy option
      proxy: pool.proxy_url,
      signal: AbortSignal.timeout(8_000),
    });
    const elapsedMs = Date.now() - start;
    const ok = res.ok || res.status < 500;
    updateProxyPool(pool.id, {
      test_status:    ok ? "active" : "error",
      last_tested_at: new Date().toISOString(),
      last_error:     ok ? null : `HTTP ${res.status}`,
    });
    return { ok, elapsedMs };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    updateProxyPool(pool.id, {
      test_status:    "error",
      last_tested_at: new Date().toISOString(),
      last_error:     error.slice(0, 200),
    });
    return { ok: false, elapsedMs, error };
  }
}
