import { TOKEN_EXPIRY_BUFFER_MS } from "../constants.ts";
import { updateAccount } from "../db/accounts.ts";
import { getAdapter } from "../auth/providers/index.ts";
import type { QwenAccount } from "../types.ts";

/**
 * Legacy alias — refreshes a Qwen-shaped account via the adapter.
 * Kept for callers that still import by this name.
 */
export async function refreshQwenToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  resourceUrl?: string;
} | null> {
  const adapter = getAdapter("qwen");
  if (!adapter?.refresh) return null;
  const n = await adapter.refresh({ refreshToken, providerData: null });
  if (!n) return null;
  return {
    accessToken: n.accessToken,
    refreshToken: n.refreshToken ?? refreshToken,
    expiresIn: Math.max(60, Math.floor((new Date(n.expiresAt).getTime() - Date.now()) / 1000)),
    resourceUrl: n.resourceUrl ?? undefined,
  };
}

export async function checkAndRefreshAccount(account: QwenAccount): Promise<QwenAccount> {
  // API-key connections don't expire
  if (account.auth_type === "apikey") return account;

  const expiresAt = new Date(account.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return account;
  if (expiresAt - Date.now() > TOKEN_EXPIRY_BUFFER_MS) return account;

  const adapter = getAdapter(account.provider);
  if (!adapter?.refresh) return account;

  const providerData = parseProviderData(account.provider_data);
  const refreshed = await adapter.refresh({
    refreshToken: account.refresh_token || null,
    providerData,
  });
  if (!refreshed) return account;

  const patch: Partial<QwenAccount> = {
    access_token: refreshed.accessToken,
    refresh_token: refreshed.refreshToken ?? account.refresh_token,
    expires_at: refreshed.expiresAt,
  };
  if (refreshed.resourceUrl) patch.resource_url = refreshed.resourceUrl;
  if (refreshed.apiKey) patch.api_key = refreshed.apiKey;
  if (refreshed.providerData) {
    const merged = { ...(providerData ?? {}), ...refreshed.providerData };
    patch.provider_data = JSON.stringify(merged);
  }

  updateAccount(account.id, patch);
  return { ...account, ...patch };
}

function parseProviderData(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { return null; }
}
