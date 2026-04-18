import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

// Qoder uses device-token polling (not classic OAuth auth-code). 9router treats it
// as authorization_code but the real flow is: user opens https://qoder.com/login, then
// we poll /api/v1/deviceToken/poll — here we model it as device_code using a synthesized
// device_code from the local listener state.
//
// Simplified version: expose as authorization_code pointing at qoder.com/login with an
// identifier, then poll deviceToken/poll in exchangeCode. If the user cancels, the
// listener times out.

const CONFIG = {
  apiBaseUrl: "https://api2.qoder.sh",
  deviceTokenUrl: "https://api2.qoder.sh/api/v1/deviceToken/poll",
  refreshUrl: "https://api2.qoder.sh/api/v3/user/refresh_token",
  userInfoUrl: "https://api2.qoder.sh/api/v1/userinfo",
  loginUrl: "https://qoder.com/login",
};

export const qoderAdapter: OAuthAdapter = {
  id: "qoder",
  flow: "authorization_code",

  buildAuthUrl({ redirectUri, state }) {
    // Qoder login page — user completes login there, then we poll for the token
    const params = new URLSearchParams({ state, redirect: redirectUri });
    return `${CONFIG.loginUrl}?${params}`;
  },

  async exchangeCode({ code }) {
    // Qoder returns a device_token in `code`. Poll the deviceToken endpoint once.
    const resp = await fetch(CONFIG.deviceTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ deviceToken: code }),
    });
    if (!resp.ok) throw new Error(`Qoder device token poll failed: ${await resp.text()}`);
    const data = await resp.json() as { success?: boolean; data?: Record<string, unknown>; message?: string };
    if (!data.success || !data.data) throw new Error(`Qoder poll failed: ${data.message ?? "unknown"}`);
    const tokens = data.data;
    const accessToken = tokens.accessToken as string | undefined;
    if (!accessToken) throw new Error("Qoder returned no accessToken");

    // Fetch user info for email/apiKey
    const userRes = await fetch(`${CONFIG.userInfoUrl}?accessToken=${encodeURIComponent(accessToken)}`, {
      headers: { Accept: "application/json" },
    });
    if (!userRes.ok) throw new Error(`Qoder userinfo failed: ${await userRes.text()}`);
    const userJson = await userRes.json() as { success?: boolean; data?: Record<string, unknown>; message?: string };
    if (!userJson.success) throw new Error(`Qoder userinfo error: ${userJson.message ?? "unknown"}`);
    const user = userJson.data ?? {};

    const apiKey = (user.apiKey as string | undefined)?.trim();
    if (!apiKey) throw new Error("Empty API key from Qoder");
    const email = (user.email as string | undefined)?.trim() ?? (user.phone as string | undefined)?.trim() ?? null;

    const expiresIn = (tokens.expiresIn as number | undefined) ?? 3600;
    const normalized: NormalizedTokens = {
      accessToken,
      refreshToken: (tokens.refreshToken as string | undefined) ?? null,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      email,
      displayName: (user.nickname as string | undefined) ?? (user.name as string | undefined) ?? email,
      apiKey,
    };
    return normalized;
  },

  async refresh({ refreshToken }) {
    if (!refreshToken) return null;
    const resp = await fetch(CONFIG.refreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!resp.ok) return null;
    const d = await resp.json() as { success?: boolean; data?: Record<string, unknown> };
    if (!d.success || !d.data?.accessToken) return null;
    const expiresIn = (d.data.expiresIn as number | undefined) ?? 3600;
    return {
      accessToken: d.data.accessToken as string,
      refreshToken: (d.data.refreshToken as string | undefined) ?? refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  },
};
