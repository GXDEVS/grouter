import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

const CONFIG = {
  clientId: "10009311001",
  clientSecret: "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW",
  authorizeUrl: "https://iflow.cn/oauth",
  tokenUrl: "https://iflow.cn/oauth/token",
  userInfoUrl: "https://iflow.cn/api/oauth/getUserInfo",
};

function basicAuth(): string {
  return "Basic " + btoa(`${CONFIG.clientId}:${CONFIG.clientSecret}`);
}

export const iflowAdapter: OAuthAdapter = {
  id: "iflow",
  flow: "authorization_code",

  buildAuthUrl({ redirectUri, state }) {
    const params = new URLSearchParams({
      loginMethod: "phone",
      type: "phone",
      redirect: redirectUri,
      state,
      client_id: CONFIG.clientId,
    });
    return `${CONFIG.authorizeUrl}?${params}`;
  },

  async exchangeCode({ code, redirectUri }) {
    const resp = await fetch(CONFIG.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: basicAuth(),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: CONFIG.clientId,
        client_secret: CONFIG.clientSecret,
      }),
    });
    if (!resp.ok) throw new Error(`iFlow token exchange failed: ${await resp.text()}`);
    const tokens = await resp.json() as Record<string, unknown>;

    // Fetch user info — MUST succeed (provides the real apiKey)
    const userRes = await fetch(`${CONFIG.userInfoUrl}?accessToken=${encodeURIComponent(tokens.access_token as string)}`, {
      headers: { Accept: "application/json" },
    });
    if (!userRes.ok) throw new Error(`iFlow userinfo failed: ${await userRes.text()}`);
    const result = await userRes.json() as { success?: boolean; data?: Record<string, unknown>; message?: string };
    if (!result.success) throw new Error(`iFlow userinfo error: ${result.message ?? "unknown"}`);

    const user = result.data ?? {};
    const apiKey = (user.apiKey as string | undefined)?.trim();
    if (!apiKey) throw new Error("Empty API key returned from iFlow");
    const email = (user.email as string | undefined)?.trim() ?? (user.phone as string | undefined)?.trim() ?? null;
    if (!email) throw new Error("Missing account email/phone in iFlow userinfo");

    const expiresIn = (tokens.expires_in as number | undefined) ?? 3600;
    const normalized: NormalizedTokens = {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string | undefined) ?? null,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      email,
      displayName: (user.nickname as string | undefined) ?? (user.name as string | undefined) ?? email,
      apiKey,
    };
    return normalized;
  },

  async refresh({ refreshToken }) {
    if (!refreshToken) return null;
    const resp = await fetch(CONFIG.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: basicAuth(),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CONFIG.clientId,
        client_secret: CONFIG.clientSecret,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    if (!data.access_token) return null;
    const expiresIn = (data.expires_in as number | undefined) ?? 3600;
    return {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string | undefined) ?? refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  },
};
