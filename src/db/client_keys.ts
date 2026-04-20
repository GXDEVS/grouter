import { db } from "./index.ts";

export interface ClientKey {
  api_key: string;
  name: string;
  allowed_providers: string | null;
  token_limit: number;
  tokens_used: number;
  is_active: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function parseAllowedProviders(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const normalized = parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

export function isClientKeyExpired(key: ClientKey, nowMs = Date.now()): boolean {
  if (!key.expires_at) return false;
  const expiry = Date.parse(key.expires_at);
  if (Number.isNaN(expiry)) return true;
  return expiry <= nowMs;
}

export function isClientKeyTokenLimitReached(key: ClientKey): boolean {
  return key.token_limit > 0 && key.tokens_used >= key.token_limit;
}

export function isProviderAllowedForClientKey(key: ClientKey, provider: string): boolean {
  const allowed = parseAllowedProviders(key.allowed_providers);
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(provider.toLowerCase());
}

export function createClientKey(data: {
  api_key: string;
  name: string;
  allowed_providers?: string[] | null;
  token_limit?: number;
  expires_at?: string | null;
}): void {
  const allowed = data.allowed_providers ? JSON.stringify(data.allowed_providers) : null;
  const limit = data.token_limit ?? 0;
  const exp = data.expires_at ?? null;
  const now = new Date().toISOString();

  db()
    .query<void, [string, string, string | null, number, string | null, string, string]>(
      `INSERT INTO client_keys (api_key, name, allowed_providers, token_limit, expires_at, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(data.api_key, data.name, allowed, limit, exp, now, now);
}

export function listClientKeys(): ClientKey[] {
  return db().query<ClientKey, []>("SELECT * FROM client_keys ORDER BY created_at DESC").all();
}

export function getClientKey(apiKey: string): ClientKey | null {
  return db()
    .query<ClientKey, [string]>("SELECT * FROM client_keys WHERE api_key = ?")
    .get(apiKey) || null;
}

export function updateClientKeyUsage(apiKey: string, tokensToAdd: number): void {
  db()
    .query<void, [number, string, string]>(
      `UPDATE client_keys 
       SET tokens_used = tokens_used + ?, updated_at = ? 
       WHERE api_key = ?`
    )
    .run(tokensToAdd, new Date().toISOString(), apiKey);
}

export function deleteClientKey(apiKey: string): void {
  db().query<void, [string]>("DELETE FROM client_keys WHERE api_key = ?").run(apiKey);
}

export function updateClientKey(apiKey: string, data: {
  name: string;
  allowed_providers?: string[] | null;
  token_limit?: number;
  expires_at?: string | null;
}): void {
  const allowed = data.allowed_providers ? JSON.stringify(data.allowed_providers) : null;
  const limit = data.token_limit ?? 0;
  const exp = data.expires_at ?? null;
  const now = new Date().toISOString();

  db()
    .query<void, [string, string | null, number, string | null, string, string]>(
      `UPDATE client_keys 
       SET name = ?, allowed_providers = ?, token_limit = ?, expires_at = ?, updated_at = ?
       WHERE api_key = ?`
    )
    .run(data.name, allowed, limit, exp, now, apiKey);
}
