import type { OAuthAdapter } from "../types.ts";

const CONFIG = {
  authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
  tokenExchangeUrl: "https://api.cline.bot/api/v1/auth/token",
  refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
};

// Cline encodes token data as base64-encoded JSON in the `code` query param,
// so the first attempt decodes it locally. Falls back to server exchange.

function tryDecodeCodeBlob(code: string): Record<string, unknown> | null {
  try {
    let base64 = code;
    const padding = 4 - (base64.length % 4);
    if (padding !== 4) base64 += "=".repeat(padding);
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    const lastBrace = decoded.lastIndexOf("}");
    if (lastBrace === -1) return null;
    return JSON.parse(decoded.substring(0, lastBrace + 1)) as Record<string, unknown>;
  } catch { return null; }
}

export const clineAdapter: OAuthAdapter = {
  id: "cline",
  flow: "authorization_code",

  buildAuthUrl({ redirectUri }) {
    const params = new URLSearchParams({
      client_type: "extension",
      callback_url: redirectUri,
      redirect_uri: redirectUri,
    });
    return `${CONFIG.authorizeUrl}?${params}`;
  },

  async exchangeCode({ code, redirectUri }) {
    let data = tryDecodeCodeBlob(code);

    if (!data) {
      const resp = await fetch(CONFIG.tokenExchangeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code, client_type: "extension", redirect_uri: redirectUri }),
      });
      if (!resp.ok) throw new Error(`Cline token exchange failed: ${await resp.text()}`);
      const body = await resp.json() as { data?: Record<string, unknown> } & Record<string, unknown>;
      data = body.data ?? body;
    }

    const accessToken = (data.accessToken as string | undefined) ?? (data.access_token as string | undefined);
    if (!accessToken) throw new Error("Cline returned no access token");
    const refreshToken = (data.refreshToken as string | undefined) ?? (data.refresh_token as string | undefined) ?? null;
    const email = (data.email as string | undefined) ?? ((data.userInfo as Record<string, unknown> | undefined)?.email as string | undefined) ?? null;
    const first = data.firstName as string | undefined;
    const last = data.lastName as string | undefined;
    const displayName = [first, last].filter(Boolean).join(" ") || email;
    const expiresAtTs = data.expiresAt as number | string | undefined;
    let expiresAt: string;
    if (typeof expiresAtTs === "number") expiresAt = new Date(expiresAtTs).toISOString();
    else if (typeof expiresAtTs === "string") expiresAt = expiresAtTs;
    else expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

    return { accessToken, refreshToken, expiresAt, email, displayName };
  },

  async refresh({ refreshToken }) {
    if (!refreshToken) return null;
    const resp = await fetch(CONFIG.refreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!resp.ok) return null;
    const body = await resp.json() as { data?: Record<string, unknown> } & Record<string, unknown>;
    const d = body.data ?? body;
    const accessToken = (d.accessToken as string | undefined) ?? (d.access_token as string | undefined);
    if (!accessToken) return null;
    const expiresIn = (d.expires_in as number | undefined) ?? 3600;
    return {
      accessToken,
      refreshToken: (d.refreshToken as string | undefined) ?? (d.refresh_token as string | undefined) ?? refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  },
};
