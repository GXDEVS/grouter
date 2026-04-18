import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

const CONFIG = {
  clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: "https://www.googleapis.com/auth/generativelanguage openid email profile",
  codeChallengeMethod: "S256",
};

function parseJwtClaims(token: string): Record<string, unknown> {
  try {
    const base64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
    return JSON.parse(Buffer.from(base64, "base64").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalize(tokens: Record<string, unknown>): NormalizedTokens {
  const expiresIn = (tokens.expires_in as number | undefined) ?? 3600;
  let email: string | null = null;
  let displayName: string | null = null;

  if (typeof tokens.id_token === "string") {
    const claims = parseJwtClaims(tokens.id_token);
    email = typeof claims.email === "string" ? claims.email : null;
    displayName = typeof claims.name === "string" ? claims.name : email;
  }

  return {
    accessToken: tokens.access_token as string,
    refreshToken: (tokens.refresh_token as string | undefined) ?? null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    email,
    displayName,
    providerData: {
      scope: (tokens.scope as string | undefined) ?? null,
      idToken: (tokens.id_token as string | undefined) ?? null,
    },
  };
}

export const geminiCliAdapter: OAuthAdapter = {
  id: "gemini-cli",
  flow: "authorization_code_pkce",

  buildAuthUrl({ redirectUri, state, codeChallenge }) {
    if (!codeChallenge) throw new Error("codeChallenge required for Gemini CLI");
    const params = new URLSearchParams({
      client_id: CONFIG.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: CONFIG.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CONFIG.codeChallengeMethod,
      access_type: "offline",
      prompt: "consent",
    });
    return `${CONFIG.authorizeUrl}?${params}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier }) {
    const resp = await fetch(CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CONFIG.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier ?? "",
      }),
    });
    if (!resp.ok) throw new Error(`Gemini CLI token exchange failed: ${await resp.text()}`);
    const data = await resp.json() as Record<string, unknown>;
    return normalize(data);
  },

  async refresh({ refreshToken }) {
    if (!refreshToken) return null;
    const resp = await fetch(CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CONFIG.clientId,
        refresh_token: refreshToken,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    if (!data.access_token) return null;
    return normalize(data);
  },
};
