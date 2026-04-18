import {
  QWEN_CLIENT_ID,
  QWEN_DEVICE_CODE_URL,
  QWEN_TOKEN_URL,
  QWEN_SCOPE,
} from "../../constants.ts";
import { generatePKCE, parseIdTokenEmail } from "../pkce.ts";
import type { OAuthAdapter } from "../types.ts";

export const qwenAdapter: OAuthAdapter = {
  id: "qwen",
  flow: "device_code",

  async startDevice() {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const resp = await fetch(QWEN_DEVICE_CODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: QWEN_CLIENT_ID,
        scope: QWEN_SCOPE,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }),
    });
    if (!resp.ok) throw new Error(`Device code request failed (${resp.status})`);
    const device = (await resp.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete?: string;
      expires_in: number;
      interval?: number;
    };
    return { device, codeVerifier };
  },

  async pollDevice(session) {
    if (!session.deviceCode || !session.codeVerifier) {
      return { status: "error", message: "missing session data" };
    }
    const resp = await fetch(QWEN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: session.deviceCode,
        client_id: QWEN_CLIENT_ID,
        code_verifier: session.codeVerifier,
      }),
    });

    if (resp.ok) {
      const t = (await resp.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        resource_url?: string;
        id_token?: string;
      };
      const email = t.id_token ? parseIdTokenEmail(t.id_token) : null;
      return {
        status: "complete",
        tokens: {
          accessToken: t.access_token,
          refreshToken: t.refresh_token,
          expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
          email,
          displayName: email,
          resourceUrl: t.resource_url ?? null,
        },
      };
    }

    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    const error = data.error as string | undefined;
    if (error === "authorization_pending") return { status: "pending" };
    if (error === "slow_down") return { status: "slow_down" };
    if (error === "expired_token") return { status: "expired" };
    if (error === "access_denied") return { status: "denied" };
    return { status: "error", message: (data.error_description as string) ?? error ?? "unknown" };
  },

  async refresh({ refreshToken }) {
    if (!refreshToken) return null;
    try {
      const resp = await fetch(QWEN_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: QWEN_CLIENT_ID,
        }),
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as Record<string, unknown>;
      if (!data.access_token) return null;
      return {
        accessToken: data.access_token as string,
        refreshToken: (data.refresh_token as string | undefined) ?? refreshToken,
        expiresAt: new Date(Date.now() + ((data.expires_in as number | undefined) ?? 3600) * 1000).toISOString(),
        resourceUrl: (data.resource_url as string | undefined) ?? null,
      };
    } catch { return null; }
  },
};
