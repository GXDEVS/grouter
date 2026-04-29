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

const PROXY_POOL_PATCH_COLUMNS = {
  name: "name",
  proxy_url: "proxy_url",
  no_proxy: "no_proxy",
  is_active: "is_active",
  test_status: "test_status",
  last_tested_at: "last_tested_at",
  last_error: "last_error",
} as const;

export type ProxyPoolPatch = Partial<Pick<ProxyPool, keyof typeof PROXY_POOL_PATCH_COLUMNS>>;

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

export function updateProxyPool(id: string, patch: ProxyPoolPatch): void {
  const rawEntries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!rawEntries.length) return;

  const invalidKeys = rawEntries
    .map(([k]) => k)
    .filter((k) => !(k in PROXY_POOL_PATCH_COLUMNS));
  if (invalidKeys.length > 0) {
    throw new Error(`Invalid proxy pool patch field(s): ${invalidKeys.join(", ")}`);
  }

  const entries = rawEntries as Array<[keyof typeof PROXY_POOL_PATCH_COLUMNS, string | number | null]>;
  const now = new Date().toISOString();
  const sets = entries.map(([k]) => `${PROXY_POOL_PATCH_COLUMNS[k]} = ?`).join(", ");
  db().query(`UPDATE proxy_pools SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...entries.map(([, v]) => v), now, id);
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
