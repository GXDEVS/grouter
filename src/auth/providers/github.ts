import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

const CONFIG = {
  clientId: "Iv1.b507a08c87ecfe98",
  deviceCodeUrl: "https://github.com/login/device/code",
  tokenUrl: "https://github.com/login/oauth/access_token",
  userInfoUrl: "https://api.github.com/user",
  copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
  scopes: "read:user",
  apiVersion: "2022-11-28",
  userAgent: "GitHubCopilotChat/0.26.7",
};

async function fetchCopilotAndUser(accessToken: string): Promise<{
  copilot: { token?: string; expires_at?: number } | null;
  user: { id?: number; login?: string; email?: string; name?: string } | null;
}> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "X-GitHub-Api-Version": CONFIG.apiVersion,
    "User-Agent": CONFIG.userAgent,
  };
  const [cRes, uRes] = await Promise.all([
    fetch(CONFIG.copilotTokenUrl, { headers }),
    fetch(CONFIG.userInfoUrl, { headers }),
  ]);
  const copilot = cRes.ok ? (await cRes.json()) as { token?: string; expires_at?: number } : null;
  const user = uRes.ok ? (await uRes.json()) as { id?: number; login?: string; email?: string; name?: string } : null;
  return { copilot, user };
}

function normalize(tokens: Record<string, unknown>, copilot: { token?: string; expires_at?: number } | null, user: { id?: number; login?: string; email?: string; name?: string } | null): NormalizedTokens {
  const expiresIn = (tokens.expires_in as number | undefined) ?? 8 * 60 * 60;
  return {
    accessToken: tokens.access_token as string,
    refreshToken: (tokens.refresh_token as string | undefined) ?? null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    email: user?.email ?? null,
    displayName: user?.login ?? user?.name ?? null,
    providerData: {
      copilotToken: copilot?.token ?? null,
      copilotTokenExpiresAt: copilot?.expires_at ?? null,
      githubUserId: user?.id ?? null,
      githubLogin: user?.login ?? null,
    },
  };
}

export const githubAdapter: OAuthAdapter = {
  id: "github",
  flow: "device_code",

  async startDevice() {
    const resp = await fetch(CONFIG.deviceCodeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: CONFIG.clientId, scope: CONFIG.scopes }),
    });
    if (!resp.ok) throw new Error(`GitHub device code failed (${resp.status})`);
    const d = await resp.json() as {
      device_code: string; user_code: string; verification_uri: string; expires_in: number; interval?: number;
    };
    return { device: { ...d, interval: d.interval ?? 5 } };
  },

  async pollDevice(session) {
    if (!session.deviceCode) return { status: "error", message: "missing device_code" };
    const resp = await fetch(CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: CONFIG.clientId,
        device_code: session.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = await resp.json().catch(() => ({})) as Record<string, unknown>;

    if (data.access_token) {
      const { copilot, user } = await fetchCopilotAndUser(data.access_token as string);
      return { status: "complete", tokens: normalize(data, copilot, user) };
    }
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
        client_id: CONFIG.clientId,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    if (!data.access_token) return null;
    const { copilot, user } = await fetchCopilotAndUser(data.access_token as string);
    return normalize(data, copilot, user);
  },
};
