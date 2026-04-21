import crypto from "node:crypto";
import { getAdapter } from "./providers/index.ts";
import { generatePKCE } from "./pkce.ts";
import { addOAuthConnection } from "../db/accounts.ts";
import { getProvider, getProviderLock } from "../providers/registry.ts";
import type {
  NormalizedTokens,
  OAuthAdapter,
  PendingSessionData,
} from "./types.ts";
import type { Connection } from "../types.ts";

// In-memory pending sessions — key = session_id (opaque to the client)
const sessions = new Map<string, PendingSessionData>();
const SESSION_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now > s.expiresAt) sessions.delete(k);
}, 5 * 60 * 1000);

function newSessionId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function getSession(id: string): PendingSessionData | null {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { sessions.delete(id); return null; }
  return s;
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

function requireAdapter(providerId: string): OAuthAdapter {
  const a = getAdapter(providerId);
  if (!a) throw new Error(`No OAuth adapter for provider: ${providerId}`);
  const lock = getProviderLock(getProvider(providerId));
  if (lock) throw new Error(lock.reason);
  return a;
}

// ── Device-code flow ──────────────────────────────────────────────────────────

export async function startDeviceFlow(providerId: string): Promise<{
  session_id: string;
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}> {
  const adapter = requireAdapter(providerId);
  if (adapter.flow !== "device_code" || !adapter.startDevice) {
    throw new Error(`Provider ${providerId} does not use device-code flow`);
  }
  const { device, codeVerifier, extra } = await adapter.startDevice();
  const session_id = newSessionId();
  sessions.set(session_id, {
    providerId,
    flow: "device_code",
    createdAt: Date.now(),
    expiresAt: Date.now() + (device.expires_in ?? 600) * 1000,
    codeVerifier,
    deviceCode: device.device_code,
    extra,
  });
  return {
    session_id,
    device_code: device.device_code,
    user_code: device.user_code,
    verification_uri: device.verification_uri,
    verification_uri_complete: device.verification_uri_complete,
    expires_in: device.expires_in,
    interval: device.interval ?? 5,
  };
}

export async function pollDeviceFlow(session_id: string): Promise<
  | { status: "pending" | "slow_down" | "denied" | "expired" }
  | { status: "error"; message: string }
  | { status: "complete"; connection: Connection }
> {
  const session = getSession(session_id);
  if (!session) return { status: "expired" };
  const adapter = requireAdapter(session.providerId);
  if (!adapter.pollDevice) return { status: "error", message: "adapter missing pollDevice" };

  const result = await adapter.pollDevice(session);
  if (result.status === "complete") {
    sessions.delete(session_id);
    const connection = saveTokens(session.providerId, result.tokens);
    return { status: "complete", connection };
  }
  if (result.status === "denied" || result.status === "expired") {
    sessions.delete(session_id);
  }
  return result;
}

// ── Authorization-code flow ───────────────────────────────────────────────────

export function startAuthCodeFlow(providerId: string, redirectUri: string, meta?: Record<string, unknown>): {
  session_id: string;
  authUrl: string;
  state: string;
  redirectUri: string;
} {
  const adapter = requireAdapter(providerId);
  if (adapter.flow !== "authorization_code" && adapter.flow !== "authorization_code_pkce") {
    throw new Error(`Provider ${providerId} does not use authorization-code flow`);
  }
  if (!adapter.buildAuthUrl) throw new Error(`adapter ${providerId} missing buildAuthUrl`);

  const state = crypto.randomBytes(16).toString("hex");
  let codeVerifier: string | undefined;
  let codeChallenge: string | undefined;
  if (adapter.flow === "authorization_code_pkce") {
    const p = generatePKCE();
    codeVerifier = p.codeVerifier;
    codeChallenge = p.codeChallenge;
  }

  const authUrl = adapter.buildAuthUrl({ redirectUri, state, codeChallenge, meta });
  const session_id = newSessionId();
  sessions.set(session_id, {
    providerId,
    flow: adapter.flow,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    codeVerifier,
    state,
    redirectUri,
    extra: meta,
  });
  return { session_id, authUrl, state, redirectUri };
}

export async function completeAuthCodeFlow(session_id: string, code: string, state: string): Promise<Connection> {
  const session = getSession(session_id);
  if (!session) throw new Error("session expired or not found");
  if (session.state !== state) throw new Error("state mismatch — possible CSRF");
  const adapter = requireAdapter(session.providerId);
  if (!adapter.exchangeCode) throw new Error(`adapter ${session.providerId} missing exchangeCode`);

  const tokens = await adapter.exchangeCode({
    code,
    redirectUri: session.redirectUri!,
    codeVerifier: session.codeVerifier,
    state,
    meta: session.extra,
  });
  sessions.delete(session_id);
  return saveTokens(session.providerId, tokens);
}

// ── Import-token flow ─────────────────────────────────────────────────────────

export async function importToken(providerId: string, input: string, meta?: Record<string, unknown>): Promise<Connection> {
  const adapter = requireAdapter(providerId);
  if (adapter.flow !== "import_token" || !adapter.importToken) {
    throw new Error(`Provider ${providerId} does not support token import`);
  }
  const tokens = await adapter.importToken(input, meta);
  return saveTokens(providerId, tokens);
}

// ── Save ──────────────────────────────────────────────────────────────────────

function saveTokens(providerId: string, t: NormalizedTokens): Connection {
  return addOAuthConnection({
    provider: providerId,
    email: t.email ?? null,
    display_name: t.displayName ?? t.email ?? null,
    access_token: t.accessToken,
    refresh_token: t.refreshToken ?? null,
    expires_at: t.expiresAt,
    resource_url: t.resourceUrl ?? null,
    api_key: t.apiKey ?? null,
    provider_data: t.providerData ?? null,
  });
}
