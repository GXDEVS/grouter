import { parseIdTokenEmail } from "../pkce.ts";
import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

const CONFIG = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://api.anthropic.com/v1/oauth/token",
  scopes: ["org:create_api_key", "user:profile", "user:inference"],
  codeChallengeMethod: "S256",
};

function normalize(tokens: Record<string, unknown>): NormalizedTokens {
  const expiresIn = (tokens.expires_in as number | undefined) ?? 3600;
  const email = tokens.id_token ? parseIdTokenEmail(tokens.id_token as string) : null;
  return {
    accessToken: tokens.access_token as string,
    refreshToken: (tokens.refresh_token as string | undefined) ?? null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    email,
    displayName: email,
    providerData: { scope: tokens.scope as string | undefined ?? null },
  };
}

export const claudeAdapter: OAuthAdapter = {
  id: "claude",
  flow: "authorization_code_pkce",

  buildAuthUrl({ redirectUri, state, codeChallenge }) {
    if (!codeChallenge) throw new Error("codeChallenge required for Claude");
    const params = new URLSearchParams({
      code: "true",
      client_id: CONFIG.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: CONFIG.scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: CONFIG.codeChallengeMethod,
      state,
    });
    return `${CONFIG.authorizeUrl}?${params}`;
  },

  async exchangeCode({ code, redirectUri, codeVerifier, state }) {
    // Claude may return code#state
    let authCode = code;
    let codeState = state ?? "";
    if (authCode.includes("#")) {
      const [left, right] = authCode.split("#");
      authCode = left ?? code;
      codeState = right || codeState;
    }
    const resp = await fetch(CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        code: authCode,
        state: codeState,
        grant_type: "authorization_code",
        client_id: CONFIG.clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!resp.ok) throw new Error(`Claude token exchange failed: ${await resp.text()}`);
    const data = await resp.json() as Record<string, unknown>;
    return normalize(data);
  },

  async refresh({ refreshToken }) {
    if (!refreshToken) return null;
    const resp = await fetch(CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
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
