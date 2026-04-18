import type { OAuthAdapter, NormalizedTokens } from "../types.ts";
import { parseIdTokenEmail } from "../pkce.ts";

const CONFIG = {
  defaultRegion: "us-east-1",
  defaultStartUrl: "https://view.awsapps.com/start",
  clientName: "kiro-oauth-client",
  clientType: "public",
  scopes: ["codewhisperer:completions", "codewhisperer:analysis", "codewhisperer:conversations"],
  grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
  issuerUrl: "https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6",
};

function registerClientUrl(region: string): string { return `https://oidc.${region}.amazonaws.com/client/register`; }
function deviceAuthUrl(region: string): string { return `https://oidc.${region}.amazonaws.com/device_authorization`; }
function tokenUrl(region: string): string { return `https://oidc.${region}.amazonaws.com/token`; }

export const kiroAdapter: OAuthAdapter = {
  id: "kiro",
  flow: "device_code",

  async startDevice() {
    const region = CONFIG.defaultRegion;
    const startUrl = CONFIG.defaultStartUrl;

    // Step 1: register client with AWS SSO OIDC
    const regRes = await fetch(registerClientUrl(region), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        clientName: CONFIG.clientName,
        clientType: CONFIG.clientType,
        scopes: CONFIG.scopes,
        grantTypes: CONFIG.grantTypes,
        issuerUrl: CONFIG.issuerUrl,
      }),
    });
    if (!regRes.ok) throw new Error(`Kiro client registration failed: ${await regRes.text()}`);
    const client = await regRes.json() as { clientId: string; clientSecret: string };

    // Step 2: request device authorization
    const devRes = await fetch(deviceAuthUrl(region), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ clientId: client.clientId, clientSecret: client.clientSecret, startUrl }),
    });
    if (!devRes.ok) throw new Error(`Kiro device authorization failed: ${await devRes.text()}`);
    const d = await devRes.json() as {
      deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete: string;
      expiresIn: number; interval?: number;
    };

    return {
      device: {
        device_code: d.deviceCode,
        user_code: d.userCode,
        verification_uri: d.verificationUri,
        verification_uri_complete: d.verificationUriComplete,
        expires_in: d.expiresIn,
        interval: d.interval ?? 5,
      },
      extra: {
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        region,
        startUrl,
        authMethod: "builder-id",
      },
    };
  },

  async pollDevice(session) {
    if (!session.deviceCode || !session.extra) return { status: "error", message: "missing session data" };
    const extra = session.extra as { clientId: string; clientSecret: string; region: string; startUrl: string; authMethod: string };

    const resp = await fetch(tokenUrl(extra.region), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        clientId: extra.clientId,
        clientSecret: extra.clientSecret,
        deviceCode: session.deviceCode,
        grantType: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = await resp.json().catch(() => ({})) as Record<string, unknown>;

    if (data.accessToken) {
      const expiresIn = (data.expiresIn as number | undefined) ?? 3600;
      const token = data.accessToken as string;
      const email = parseIdTokenEmail(token);
      return {
        status: "complete",
        tokens: {
          accessToken: token,
          refreshToken: (data.refreshToken as string | undefined) ?? null,
          expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
          email,
          displayName: email,
          providerData: {
            profileArn: (data.profileArn as string | undefined) ?? null,
            clientId: extra.clientId,
            clientSecret: extra.clientSecret,
            region: extra.region,
            authMethod: extra.authMethod,
            startUrl: extra.startUrl,
          },
        },
      };
    }

    const error = data.error as string | undefined;
    if (error === "authorization_pending") return { status: "pending" };
    if (error === "slow_down") return { status: "slow_down" };
    if (error === "expired_token") return { status: "expired" };
    if (error === "access_denied") return { status: "denied" };
    return { status: "pending" };
  },

  async refresh({ refreshToken, providerData }) {
    if (!refreshToken || !providerData) return null;
    const region = (providerData.region as string | undefined) ?? CONFIG.defaultRegion;
    const clientId = providerData.clientId as string | undefined;
    const clientSecret = providerData.clientSecret as string | undefined;
    if (!clientId || !clientSecret) return null;

    const resp = await fetch(tokenUrl(region), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        clientId, clientSecret,
        refreshToken,
        grantType: "refresh_token",
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    if (!data.accessToken) return null;
    const expiresIn = (data.expiresIn as number | undefined) ?? 3600;
    return {
      accessToken: data.accessToken as string,
      refreshToken: (data.refreshToken as string | undefined) ?? refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      providerData: {
        ...providerData,
        profileArn: (data.profileArn as string | undefined) ?? (providerData.profileArn ?? null),
      },
    };
  },
};
