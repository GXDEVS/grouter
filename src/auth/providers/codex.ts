import { parseIdTokenEmail } from "../pkce.ts";
import type { OAuthAdapter, NormalizedTokens } from "../types.ts";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseJwtExp(token: string): number | null {
  const payload = parseJwtPayload(token);
  if (!payload) return null;
  const exp = payload.exp;
  return typeof exp === "number" ? exp : null;
}

function extractAccountId(tokens: Record<string, unknown>): string | null {
  if (typeof tokens.account_id === "string" && tokens.account_id) return tokens.account_id;

  const idToken = typeof tokens.id_token === "string" ? tokens.id_token : null;
  const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : null;
  const payloads = [idToken, accessToken]
    .filter((t): t is string => !!t)
    .map((t) => parseJwtPayload(t))
    .filter((p): p is Record<string, unknown> => !!p);

  for (const payload of payloads) {
    const authClaim = payload["https://api.openai.com/auth"];
    if (!authClaim || typeof authClaim !== "object") continue;
    const auth = authClaim as Record<string, unknown>;
    if (typeof auth.chatgpt_account_id === "string" && auth.chatgpt_account_id) return auth.chatgpt_account_id;
    if (typeof auth.account_id === "string" && auth.account_id) return auth.account_id;
  }

  return null;
}

function loadCodexAuthJsonTokens(): Record<string, unknown> | null {
  const authPath = join(homedir(), ".codex", "auth.json");
  if (!existsSync(authPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, unknown>;
    const tokens = raw.tokens;
    if (!tokens || typeof tokens !== "object") return null;
    const t = tokens as Record<string, unknown>;
    if (typeof t.access_token !== "string" || !t.access_token) return null;

    const exp = parseJwtExp(t.access_token);
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = exp && exp > now ? exp - now : 3600;

    return {
      access_token: t.access_token,
      refresh_token: typeof t.refresh_token === "string" ? t.refresh_token : undefined,
      id_token: typeof t.id_token === "string" ? t.id_token : undefined,
      account_id: typeof t.account_id === "string" ? t.account_id : undefined,
      expires_in: expiresIn,
    };
  } catch {
    return null;
  }
}

// OpenAI Codex + OpenAI Native share the same OAuth app - two adapters, same mechanics.
function buildAdapter(id: string, originator: string): OAuthAdapter {
  const CONFIG = {
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    defaultScope: "openid profile email offline_access",
    nativeScope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    codeChallengeMethod: "S256",
  };

  function normalize(tokens: Record<string, unknown>): NormalizedTokens {
    const accessToken = tokens.access_token as string | undefined;
    if (!accessToken) throw new Error("Token response missing access_token");

    const expiresIn = (tokens.expires_in as number | undefined) ?? 3600;
    const email = tokens.id_token ? parseIdTokenEmail(tokens.id_token as string) : null;
    const accountId = extractAccountId(tokens);
    return {
      accessToken,
      refreshToken: (tokens.refresh_token as string | undefined) ?? null,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      email,
      displayName: email,
      providerData: {
        idToken: (tokens.id_token as string | undefined) ?? null,
        accountId,
      },
    };
  }

  const isCodex = id === "codex";

  const adapter: OAuthAdapter = {
    id,
    flow: "authorization_code_pkce",
    // Codex CLI binds to a fixed port 1455 - keep it for codex only.
    fixedPort: isCodex ? 1455 : undefined,
    callbackPath: isCodex ? "/auth/callback" : "/callback",
    callbackHost: isCodex ? "localhost" : undefined,

    buildAuthUrl({ redirectUri, state, codeChallenge }) {
      if (!codeChallenge) throw new Error("codeChallenge required");
      const scope = isCodex ? CONFIG.defaultScope : CONFIG.nativeScope;
      const params = new URLSearchParams({
        response_type: "code",
        client_id: CONFIG.clientId,
        redirect_uri: redirectUri,
        scope,
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
      if (!codeVerifier) {
        throw new Error("OpenAI token exchange failed: missing PKCE code_verifier");
      }

      const form = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CONFIG.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });

      const resp = await fetch(CONFIG.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Origin: "https://chatgpt.com",
          Referer: "https://chatgpt.com/",
          "User-Agent": "codex_cli_rs/0.0.1 (grouter)",
        },
        body: form,
      });
      if (!resp.ok) {
        const text = await resp.text();

        // Some accounts intermittently fail token exchange even after successful browser auth.
        // Fall back to official Codex cached credentials if available.
        if (isCodex && text.includes("token_exchange_user_error")) {
          const cached = loadCodexAuthJsonTokens();
          if (cached) return normalize(cached);
        }

        throw new Error(`OpenAI token exchange failed: ${text}`);
      }
      const data = await resp.json() as Record<string, unknown>;
      return normalize(data);
    },

    async refresh({ refreshToken }) {
      if (!refreshToken) return null;
      const resp = await fetch(CONFIG.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Origin: "https://chatgpt.com",
          Referer: "https://chatgpt.com/",
          "User-Agent": "codex_cli_rs/0.0.1 (grouter)",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CONFIG.clientId,
          refresh_token: refreshToken,
        }),
      });

      // 400/401 = token revoked/expired - caller handles re-auth.
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
  return adapter;
}

export const codexAdapter = buildAdapter("codex", "codex_cli_rs");
export const openaiAdapter = buildAdapter("openai", "openai_native");