import { parseIdTokenEmail } from "../pkce.ts";
import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

// OpenAI Codex + OpenAI Native share the same OAuth app — two adapters, same mechanics.
function buildAdapter(id: string, originator: string): OAuthAdapter {
  const CONFIG = {
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    scope: "openid profile email offline_access",
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
      providerData: { idToken: (tokens.id_token as string | undefined) ?? null },
    };
  }

  const isCodex = id === "codex";

  const adapter: OAuthAdapter = {
    id,
    flow: "authorization_code_pkce",
    // Codex CLI binds to a fixed port 1455 — keep it for codex only.
    fixedPort: isCodex ? 1455 : undefined,
    callbackPath: isCodex ? "/auth/callback" : "/callback",

    buildAuthUrl({ redirectUri, state, codeChallenge }) {
      if (!codeChallenge) throw new Error("codeChallenge required");
      const params = new URLSearchParams({
        response_type: "code",
        client_id: CONFIG.clientId,
        redirect_uri: redirectUri,
        scope: CONFIG.scope,
        code_challenge: codeChallenge,
        code_challenge_method: CONFIG.codeChallengeMethod,
        id_token_add_organizations: "true",
        originator,
        state,
      });
      if (isCodex) params.set("codex_cli_simplified_flow", "true");
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
      if (!resp.ok) throw new Error(`OpenAI token exchange failed: ${await resp.text()}`);
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
  return adapter;
}

export const codexAdapter   = buildAdapter("codex", "codex_cli_rs");
export const openaiAdapter  = buildAdapter("openai", "openai_native");
export const chatgptAdapter = buildAdapter("chatgpt", "chatgpt_native");
