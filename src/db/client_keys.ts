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
