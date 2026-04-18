import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

const CONFIG = {
  apiBaseUrl: "https://api.kilo.ai",
  initiateUrl: "https://api.kilo.ai/api/device-auth/codes",
  pollUrlBase: "https://api.kilo.ai/api/device-auth/codes",
};

async function fetchOrgId(token: string): Promise<string | null> {
  try {
    const resp = await fetch(`${CONFIG.apiBaseUrl}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const p = await resp.json() as { organizations?: Array<{ id: string }> };
    return p.organizations?.[0]?.id ?? null;
  } catch { return null; }
}

export const kilocodeAdapter: OAuthAdapter = {
  id: "kilocode",
  flow: "device_code",

  async startDevice() {
    const resp = await fetch(CONFIG.initiateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!resp.ok) {
      if (resp.status === 429) throw new Error("Too many pending authorization requests. Please try again later.");
      throw new Error(`KiloCode device auth failed (${resp.status})`);
    }
    const d = await resp.json() as { code: string; verificationUrl: string; expiresIn?: number };
    return {
      device: {
        device_code: d.code,
        user_code: d.code,
        verification_uri: d.verificationUrl,
        verification_uri_complete: d.verificationUrl,
        expires_in: d.expiresIn ?? 300,
        interval: 3,
      },
    };
  },

  async pollDevice(session) {
    if (!session.deviceCode) return { status: "error", message: "missing device_code" };
    const resp = await fetch(`${CONFIG.pollUrlBase}/${session.deviceCode}`);
    if (resp.status === 202) return { status: "pending" };
    if (resp.status === 403) return { status: "denied" };
    if (resp.status === 410) return { status: "expired" };
    if (!resp.ok) return { status: "error", message: `Poll failed: ${resp.status}` };

    const data = await resp.json().catch(() => ({})) as { status?: string; token?: string; userEmail?: string };
    if (data.status === "approved" && data.token) {
      const orgId = await fetchOrgId(data.token);
      const normalized: NormalizedTokens = {
        accessToken: data.token,
        refreshToken: null,
        // KiloCode tokens don't expire in a conventional way — set 30 days so we don't thrash
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        email: data.userEmail ?? null,
        displayName: data.userEmail ?? null,
        providerData: orgId ? { orgId } : null,
      };
      return { status: "complete", tokens: normalized };
    }
    return { status: "pending" };
  },

  // KiloCode has no refresh endpoint
};
