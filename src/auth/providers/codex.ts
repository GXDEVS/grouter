import { parseIdTokenEmail } from "../pkce.ts";
import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

// OpenAI Codex + OpenAI Native share the same OAuth app — two adapters, same mechanics.

const CONFIG = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
  codeChallengeMethod: "S256" as const,
} satisfies {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  codeChallengeMethod: "S256";
};

function normalize(tokens: Record<string, unknown>): NormalizedTokens {
  const accessToken = tokens.access_token as string | undefined;
  if (!accessToken) throw new Error("Token response missing access_token");

  const expiresIn = (tokens.expires_in as number | undefined) ?? 3600;
  const email = tokens.id_token
    ? parseIdTokenEmail(tokens.id_token as string)
    : null;

  return {
    accessToken,
    refreshToken: (tokens.refresh_token as string | undefined) ?? null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    email,
    displayName: email,
    providerData: { idToken: (tokens.id_token as string | undefined) ?? null },
  };
}

function buildAdapter(id: string, originator: string): OAuthAdapter {
  const isCodex = id === "codex";

  return {
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
      if (!codeVerifier) throw new Error("codeVerifier required for PKCE flow");

      const resp = await fetch(CONFIG.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: CONFIG.clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      if (!resp.ok) {
        throw new Error(`OpenAI token exchange failed: ${await resp.text()}`);
      }

      return normalize(await resp.json() as Record<string, unknown>);
    },

    async refresh({ refreshToken }) {
      if (!refreshToken) return null;

      const resp = await fetch(CONFIG.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CONFIG.clientId,
          refresh_token: refreshToken,
        }),
      });

      // 400/401 = token revoked/expired — caller handles re-auth.
      // 5xx/network = propagate so caller can retry.
      if (resp.status >= 500) {
        throw new Error(`OpenAI refresh failed with ${resp.status}: ${await resp.text()}`);
      }
      if (!resp.ok) return null;

      const data = await resp.json() as Record<string, unknown>;
      if (!data.access_token) return null;

      return normalize(data);
    },
  };
}

export const codexAdapter  = buildAdapter("codex",  "codex_cli_rs");
export const openaiAdapter = buildAdapter("openai", "openai_native");