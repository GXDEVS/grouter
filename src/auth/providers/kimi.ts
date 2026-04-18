import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

const CONFIG = {
  clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
  deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
  tokenUrl: "https://auth.kimi.com/api/oauth/token",
};

function normalize(tokens: Record<string, unknown>): NormalizedTokens {
  const expiresIn = (tokens.expires_in as number | undefined) ?? 3600;
  return {
    accessToken: tokens.access_token as string,
    refreshToken: (tokens.refresh_token as string | undefined) ?? null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export const kimiAdapter: OAuthAdapter = {
  id: "kimi-coding",
  flow: "device_code",

  async startDevice() {
    const resp = await fetch(CONFIG.deviceCodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: CONFIG.clientId }),
    });
    if (!resp.ok) throw new Error(`Kimi device code failed (${resp.status})`);
    const d = await resp.json() as {
      device_code: string; user_code: string; verification_uri?: string; verification_uri_complete?: string;
      expires_in: number; interval?: number;
    };
    const verify = d.verification_uri ?? "https://www.kimi.com/code/authorize_device";
    return {
      device: {
        device_code: d.device_code,
        user_code: d.user_code,
        verification_uri: verify,
        verification_uri_complete: d.verification_uri_complete ?? `${verify}?user_code=${d.user_code}`,
        expires_in: d.expires_in,
        interval: d.interval ?? 5,
      },
    };
  },

  async pollDevice(session) {
    if (!session.deviceCode) return { status: "error", message: "missing device_code" };
    const resp = await fetch(CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: CONFIG.clientId,
        device_code: session.deviceCode,
      }),
    });
    if (resp.ok) {
      const data = await resp.json() as Record<string, unknown>;
      return { status: "complete", tokens: normalize(data) };
    }
    const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
    const error = data.error as string | undefined;
    if (error === "authorization_pending") return { status: "pending" };
    if (error === "slow_down") return { status: "slow_down" };
    if (error === "expired_token") return { status: "expired" };
    if (error === "access_denied") return { status: "denied" };
    return { status: "error", message: (data.error_description as string) ?? error ?? "unknown" };
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
