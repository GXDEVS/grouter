import { getAdapter } from "../auth/providers/index.ts";
import {
  completeAuthCodeFlow,
  importToken,
  pollDeviceFlow,
  startAuthCodeFlow,
  startDeviceFlow,
} from "../auth/orchestrator.ts";
import { startCallbackListener } from "../auth/server.ts";
import { ensureProviderServer } from "../proxy/server.ts";
import { getProviderLock, PROVIDERS } from "../providers/registry.ts";
import { errorResponse, handleApiError, json, readJson } from "./api-http.ts";

// Pending auth-code callback listeners keyed by session_id.
interface PendingListener {
  close: () => void;
  waiter: Promise<{ code: string | null; state: string | null; error: string | null }>;
  done: boolean;
  createdAt: number;
}

const pendingListeners = new Map<string, PendingListener>();
const CALLBACK_POLL_WAIT_MS = 8_000;
const PENDING_LISTENER_TTL_MS = 15 * 60 * 1000;

const pendingListenerSweep = setInterval(() => {
  const now = Date.now();
  for (const [sessionId, pending] of pendingListeners) {
    if (pending.done || now - pending.createdAt <= PENDING_LISTENER_TTL_MS) continue;
    try {
      pending.close();
    } catch {
      // ignore cleanup errors
    }
    pendingListeners.delete(sessionId);
  }
}, 60 * 1000);
pendingListenerSweep.unref?.();

export async function handleAuthStart(req: Request): Promise<Response> {
  try {
    const body = await readJson<{ provider?: string }>(req, {});
    if (!body.provider) return errorResponse(400, "provider is required");
    const providerId = body.provider;
    const meta = PROVIDERS[providerId];
    if (!meta) return errorResponse(400, `Unknown provider: ${providerId}`);
    const lock = getProviderLock(meta);
    if (lock) return errorResponse(lock.kind === "deprecated" ? 410 : 503, lock.reason);
    const adapter = getAdapter(providerId);
    if (!adapter) return errorResponse(400, `No OAuth adapter for ${providerId}`);
    if (adapter.flow !== "device_code") {
      return errorResponse(400, `Provider ${providerId} uses ${adapter.flow} - use /api/auth/authorize`);
    }

    const device = await startDeviceFlow(providerId);
    return json(device);
  } catch (err) {
    return handleApiError(err);
  }
}

// Body: { session_id?: string; device_code?: string }.
// device_code is accepted for legacy clients.
export async function handleAuthPoll(req: Request): Promise<Response> {
  try {
    const body = await readJson<{ session_id?: string; device_code?: string }>(req);
    const sessionId = body.session_id ?? body.device_code;
    if (!sessionId) return errorResponse(400, "session_id required");

    const result = await pollDeviceFlow(sessionId);
    if (result.status === "complete") {
      ensureProviderServer(result.connection.provider);
      return json({ status: "complete", account: result.connection });
    }
    if (result.status === "error") {
      return json({ status: "error", message: result.message });
    }
    return json({ status: result.status === "slow_down" ? "pending" : result.status });
  } catch (err) {
    return handleApiError(err);
  }
}

// Body: { provider: string; meta?: Record<string, unknown> }.
// Opens an ephemeral local HTTP listener for OAuth redirect and returns auth_url.
export async function handleAuthAuthorize(req: Request): Promise<Response> {
  try {
    const body = await readJson<{ provider?: string; meta?: Record<string, unknown> }>(req);
    if (!body.provider) return errorResponse(400, "provider required");
    const adapter = getAdapter(body.provider);
    if (!adapter) return errorResponse(400, `No OAuth adapter for ${body.provider}`);
    if (adapter.flow !== "authorization_code" && adapter.flow !== "authorization_code_pkce") {
      return errorResponse(400, `Provider ${body.provider} does not use authorization-code flow`);
    }

    const listener = startCallbackListener({
      port: adapter.fixedPort ?? 0,
      path: adapter.callbackPath ?? "/callback",
      redirectHost: adapter.callbackHost,
    });
    const waiter = listener.wait().catch((error) => ({ code: null, state: null, error: String(error) }));

    let started: ReturnType<typeof startAuthCodeFlow>;
    try {
      started = startAuthCodeFlow(body.provider, listener.redirectUri, body.meta);
    } catch (err) {
      listener.close();
      throw err;
    }

    pendingListeners.set(started.session_id, {
      close: listener.close,
      waiter,
      done: false,
      createdAt: Date.now(),
    });

    waiter
      .then((capture) => {
        if (!capture?.error) return;
        const pending = pendingListeners.get(started.session_id);
        if (!pending || pending.done) return;
        pending.done = true;
        try {
          pending.close();
        } catch {
          // ignore cleanup errors
        }
        pendingListeners.delete(started.session_id);
      })
      .catch(() => {
        // ignore waiter errors
      });

    return json({
      session_id: started.session_id,
      auth_url: started.authUrl,
      state: started.state,
      redirect_uri: started.redirectUri,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// Long-poll endpoint, resolves when the redirect lands on ephemeral listener.
export async function handleAuthCallback(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return errorResponse(400, "session_id required");
    const pending = pendingListeners.get(sessionId);
    if (!pending) return json({ status: "expired" });
    if (pending.done) return json({ status: "expired" });

    const capture = await Promise.race([
      pending.waiter,
      Bun.sleep(CALLBACK_POLL_WAIT_MS).then(() => null),
    ]);
    if (!capture) return json({ status: "pending" });

    pending.done = true;
    setTimeout(() => {
      try {
        pending.close();
      } catch {
        // ignore cleanup errors
      }
      pendingListeners.delete(sessionId);
    }, 350);

    if (capture.error) {
      const message = String(capture.error);
      const lower = message.toLowerCase();
      if (lower.includes("timeout")) return json({ status: "expired", message });
      if (lower.includes("access_denied") || lower.includes("denied")) {
        return json({ status: "denied", message });
      }
      return json({ status: "error", message });
    }
    if (!capture.code || !capture.state) return json({ status: "error", message: "missing code/state" });

    const connection = await completeAuthCodeFlow(sessionId, capture.code, capture.state);
    ensureProviderServer(connection.provider);
    return json({ status: "complete", account: connection });
  } catch (err) {
    return json({ status: "error", message: String(err) });
  }
}

// Body: { provider: string; input: string; meta?: Record<string, unknown> }.
export async function handleAuthImport(req: Request): Promise<Response> {
  try {
    const body = await readJson<{ provider?: string; input?: string; meta?: Record<string, unknown> }>(req);
    if (!body.provider) return errorResponse(400, "provider required");
    if (!body.input) return errorResponse(400, "input required");
    const connection = await importToken(body.provider, body.input, body.meta);
    ensureProviderServer(body.provider);
    return json({ status: "complete", account: connection });
  } catch (err) {
    return json({ status: "error", message: String(err) });
  }
}
