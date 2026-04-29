import { getAdapter } from "../auth/providers/index.ts";
import {
  completeAuthCodeFlow,
  importToken,
  pollDeviceFlow,
  startAuthCodeFlow,
  startDeviceFlow,
} from "../auth/orchestrator.ts";
import {
  createRemoteCallbackListener,
  startCallbackListener,
  type CallbackCapture,
  type RemoteCallbackListener,
} from "../auth/server.ts";
import { ensureProviderServer } from "../proxy/server.ts";
import { getProviderLock, PROVIDERS } from "../providers/registry.ts";
import { errorResponse, handleApiError, json, readJson } from "./api-http.ts";

/**
 * If set, OAuth providers redirect their callback to <PUBLIC_URL>/oauth/callback
 * which is handled by the main proxy server. Useful in containerised /
 * Kubernetes / VPS deployments where binding an ephemeral localhost port
 * does not work because the user's browser cannot reach the container.
 *
 * Per-provider adapters with a fixedPort (currently only Codex on :1455) are
 * skipped — those depend on a hardcoded loopback redirect.
 */
const PUBLIC_URL = process.env.GROUTER_PUBLIC_URL?.replace(/\/+$/, "") || null;

// Pending auth-code callback listeners keyed by session_id.
interface PendingListener {
  close: () => void;
  waiter: Promise<{ code: string | null; state: string | null; error: string | null }>;
  done: boolean;
  createdAt: number;
  /** OAuth `state` value — used as reverse lookup key for /oauth/callback. */
  state?: string;
  /** Set on remote-mode listeners; called when /oauth/callback receives the redirect. */
  resolveRemote?: (capture: CallbackCapture) => void;
}

const pendingListeners = new Map<string, PendingListener>();
/** Reverse index: OAuth state -> session_id. Used by /oauth/callback only. */
const pendingByState = new Map<string, string>();
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
    if (pending.state) pendingByState.delete(pending.state);
    pendingListeners.delete(sessionId);
  }
}, 60 * 1000);
pendingListenerSweep.unref?.();

function disposePending(sessionId: string, pending: PendingListener): void {
  pending.done = true;
  try {
    pending.close();
  } catch {
    // ignore cleanup errors
  }
  if (pending.state) pendingByState.delete(pending.state);
  pendingListeners.delete(sessionId);
}

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
// Opens an OAuth redirect listener and returns auth_url. Two modes:
//   - Local (default): ephemeral HTTP server on 127.0.0.1 (or localhost dual-stack).
//   - Remote: GROUTER_PUBLIC_URL is set and the adapter has no fixedPort.
//     The redirect goes to <PUBLIC_URL>/oauth/callback handled by the main
//     proxy server. Useful for K8s/VPS deployments.
export async function handleAuthAuthorize(req: Request): Promise<Response> {
  try {
    const body = await readJson<{ provider?: string; meta?: Record<string, unknown> }>(req);
    if (!body.provider) return errorResponse(400, "provider required");
    const adapter = getAdapter(body.provider);
    if (!adapter) return errorResponse(400, `No OAuth adapter for ${body.provider}`);
    if (adapter.flow !== "authorization_code" && adapter.flow !== "authorization_code_pkce") {
      return errorResponse(400, `Provider ${body.provider} does not use authorization-code flow`);
    }

    const useRemote = PUBLIC_URL !== null && !adapter.fixedPort;
    const listener = useRemote
      ? createRemoteCallbackListener(`${PUBLIC_URL}/oauth/callback`)
      : startCallbackListener({
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

    const remoteListener = useRemote ? (listener as RemoteCallbackListener) : null;
    pendingListeners.set(started.session_id, {
      close: listener.close,
      waiter,
      done: false,
      createdAt: Date.now(),
      state: started.state,
      resolveRemote: remoteListener?.resolveRemote.bind(remoteListener),
    });
    if (started.state) pendingByState.set(started.state, started.session_id);

    waiter
      .then((capture) => {
        if (!capture?.error) return;
        const pending = pendingListeners.get(started.session_id);
        if (!pending || pending.done) return;
        disposePending(started.session_id, pending);
      })
      .catch(() => {
        // ignore waiter errors
      });

    return json({
      session_id: started.session_id,
      auth_url: started.authUrl,
      state: started.state,
      redirect_uri: started.redirectUri,
      mode: useRemote ? "remote" : "local",
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Public OAuth redirect receiver. Mounted at GET /oauth/callback when
 * GROUTER_PUBLIC_URL is set. Looks up the pending session by `state`,
 * hands the capture to the matching remote listener, and renders a
 * "you can close this tab" page.
 */
export function handleOAuthCallback(req: Request): Response {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (!state) {
    return htmlResponse(400, oauthCallbackHtml(false, "Missing state parameter."));
  }

  const sessionId = pendingByState.get(state);
  if (!sessionId) {
    return htmlResponse(400, oauthCallbackHtml(false, "No pending session — it may have expired. Try authorising again."));
  }
  const pending = pendingListeners.get(sessionId);
  if (!pending || pending.done || !pending.resolveRemote) {
    return htmlResponse(400, oauthCallbackHtml(false, "Session no longer active."));
  }

  pending.resolveRemote({ code, state, error, url });
  // Don't dispose the pending entry yet — the long-poll /api/auth/callback
  // still needs to read the capture. The waiter chain disposes it on success.

  if (error) {
    return htmlResponse(200, oauthCallbackHtml(false, `Authorization failed: ${error}`));
  }
  return htmlResponse(200, oauthCallbackHtml(true, "Authorization complete. You can close this tab and return to the CLI."));
}

function htmlResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function oauthCallbackHtml(success: boolean, message: string): string {
  const title = success ? "Authorization complete" : "Authorization failed";
  const accent = success ? "#22c55e" : "#ef4444";
  const safeMessage = message.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  return [
    "<!DOCTYPE html><html><head><meta charset='utf-8'><title>grouter auth</title>",
    "<style>",
    "body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0d0f13;color:#eee}",
    ".card{text-align:center;padding:2rem 2.5rem;border-radius:1rem;background:#1e293b;max-width:480px;border-top:4px solid " + accent + "}",
    "h2{margin:0 0 .75rem 0;color:" + accent + "}",
    "p{margin:.25rem 0;color:#94a3b8;line-height:1.5}",
    "</style></head>",
    "<body><div class='card'><h2>" + title + "</h2><p>" + safeMessage + "</p></div>",
    "<script>setTimeout(function(){try{window.close()}catch(e){}},400)</script>",
    "</body></html>",
  ].join("");
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
      if (pending.state) pendingByState.delete(pending.state);
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
