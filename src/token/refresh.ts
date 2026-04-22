import { TOKEN_EXPIRY_BUFFER_MS } from "../constants.ts";
import { updateAccount } from "../db/accounts.ts";
import { getAdapter } from "../auth/providers/index.ts";
import { parseProviderData } from "../utils.ts";
import type { Connection } from "../types.ts";

export async function checkAndRefreshAccount(account: Connection): Promise<Connection> {
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

  const patch: Partial<Connection> = {
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
