import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

const CONFIG = {
  defaultBaseUrl: "https://gitlab.com",
  authorizeUrlPath: "/oauth/authorize",
  tokenUrlPath: "/oauth/token",
  userInfoUrlPath: "/api/v4/user",
  scope: "api read_user",
  codeChallengeMethod: "S256",
};

interface Meta {
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

export const gitlabAdapter: OAuthAdapter = {
  id: "gitlab",
  flow: "authorization_code_pkce",

  buildAuthUrl({ redirectUri, state, codeChallenge, meta }) {
    if (!codeChallenge) throw new Error("codeChallenge required for GitLab");
    const m = (meta ?? {}) as Meta;
    const baseUrl = m.baseUrl || CONFIG.defaultBaseUrl;
    const clientId = m.clientId || "";
    if (!clientId) throw new Error("GitLab connection requires clientId in meta");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: CONFIG.scope,
      code_challenge: codeChallenge,
      code_challenge_method: CONFIG.codeChallengeMethod,
    });
    return `${baseUrl}${CONFIG.authorizeUrlPath}?${params}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier, meta }) {
    const m = (meta ?? {}) as Meta;
    const baseUrl = m.baseUrl || CONFIG.defaultBaseUrl;
    const clientId = m.clientId || "";
    const clientSecret = m.clientSecret || "";

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier ?? "",
    });
    if (clientSecret) body.set("client_secret", clientSecret);

    const resp = await fetch(`${baseUrl}${CONFIG.tokenUrlPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    if (!resp.ok) throw new Error(`GitLab token exchange failed: ${await resp.text()}`);
    const tokens = await resp.json() as Record<string, unknown>;

    // Fetch user info
    let user: Record<string, unknown> = {};
    try {
      const userRes = await fetch(`${baseUrl}${CONFIG.userInfoUrlPath}`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userRes.ok) user = await userRes.json() as Record<string, unknown>;
    } catch { /* ignore */ }

    const expiresIn = (tokens.expires_in as number | undefined) ?? 7200;
    const email = (user.email as string | undefined) ?? (user.public_email as string | undefined) ?? null;
    const username = (user.username as string | undefined) ?? null;

    const result: NormalizedTokens = {
      accessToken: tokens.access_token as string,
      refreshToken: (tokens.refresh_token as string | undefined) ?? null,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      email,
      displayName: username ?? email,
      providerData: { baseUrl, clientId, clientSecret, username, name: user.name ?? null },
    };
    return result;
  },

  async refresh({ refreshToken, providerData }) {
    if (!refreshToken) return null;
    const d = (providerData ?? {}) as Meta;
    const baseUrl = d.baseUrl || CONFIG.defaultBaseUrl;
    const clientId = d.clientId || "";
    if (!clientId) return null;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    });
    if (d.clientSecret) body.set("client_secret", d.clientSecret);

    const resp = await fetch(`${baseUrl}${CONFIG.tokenUrlPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    if (!data.access_token) return null;
    const expiresIn = (data.expires_in as number | undefined) ?? 7200;
    return {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string | undefined) ?? refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      providerData: { baseUrl, clientId, clientSecret: d.clientSecret ?? null },
    };
  },
};
