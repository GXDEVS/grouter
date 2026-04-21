import {
  startDeviceFlow,
  pollDeviceFlow,
  startAuthCodeFlow,
  completeAuthCodeFlow,
  importToken,
} from "../auth/orchestrator.ts";
import { startCallbackListener } from "../auth/server.ts";
import { ensureProviderServer } from "../proxy/server.ts";
import { getAdapter } from "../auth/providers/index.ts";
import { addApiKeyConnection, listAccounts, removeAccount, updateAccount, getConnectionCountByProvider } from "../db/accounts.ts";
import { getUsageTotals, getUsageByModel, getUsageByAccount } from "../db/usage.ts";
import { getStrategy, getStickyLimit, getProxyPort, getSetting, setSetting, db } from "../db/index.ts";
import { isRunning, readPid, removePid } from "../daemon/index.ts";
import { estimateCostUSD } from "../constants.ts";
import { clearModelLocks, getActiveModelLocks } from "../rotator/lock.ts";
import { PROVIDERS, getTopFreeProviderRank, providerHasFreeModelsById, saveCustomProvider, getProviderLock, type Provider } from "../providers/registry.ts";
import { listProxyPools, getProxyPoolById, createProxyPool, updateProxyPool, deleteProxyPool, testProxyPool, getConnectionCountForPool } from "../db/pools.ts";
import { getProviderPort, listProviderPorts } from "../db/ports.ts";
import { listConnectionsByProvider } from "../db/accounts.ts";
import { fetchAndSaveProviderModels, getModelsForProvider } from "../providers/model-fetcher.ts";
import { listClientKeys, createClientKey, deleteClientKey, updateClientKey, getClientKey, parseAllowedProviders } from "../db/client_keys.ts";

// Pending auth-code callback listeners keyed by session_id
interface PendingListener {
  close: () => void;
  waiter: Promise<{ code: string | null; state: string | null; error: string | null }>;
  done: boolean;
  createdAt: number;
}
const pendingListeners = new Map<string, PendingListener>();
const CALLBACK_POLL_WAIT_MS = 8_000;
const PENDING_LISTENER_TTL_MS = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, pending] of pendingListeners) {
    if (pending.done || (now - pending.createdAt) <= PENDING_LISTENER_TTL_MS) continue;
    try { pending.close(); } catch { /* ignore */ }
    pendingListeners.delete(sessionId);
  }
}, 60 * 1000);

// â”€â”€ CORS headers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: cors() });
}

// â”€â”€ GET /api/status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleStatus(): Response {
  const accounts   = listAccounts();
  const totals     = getUsageTotals();
  const byModel    = getUsageByModel();
  const byAccount  = getUsageByAccount();
  const running    = isRunning();
  const pid        = readPid();
  const port       = getProxyPort();
  const strategy   = getStrategy();
  const stickyLimit = getStickyLimit();

  const active      = accounts.filter((a) => a.is_active === 1 && a.test_status === "active").length;
  const unavailable = accounts.filter((a) => a.test_status === "unavailable").length;
  const unknown     = accounts.filter((a) => a.test_status === "unknown").length;

  const totalCost = byModel.reduce(
    (sum, m) => sum + estimateCostUSD(m.model, m.prompt_tokens, m.completion_tokens),
    0,
  );

  const accountsWithUsage = accounts.map((acc) => {
    const usage = byAccount.find((u) => u.account_id === acc.id);
    // If DB says unavailable but the lock already expired, it's effectively active again
    const hasActiveLock = getActiveModelLocks(acc.id).length > 0;
    const effective_status =
      acc.test_status === "unavailable" && !hasActiveLock ? "active" : acc.test_status;
    return { ...acc, effective_status, usage: usage ?? null };
  });

  // Recompute counts using effective status
  const effectiveActive      = accountsWithUsage.filter((a) => a.is_active === 1 && a.effective_status === "active").length;
  const effectiveUnavailable = accountsWithUsage.filter((a) => a.effective_status === "unavailable").length;
  const effectiveUnknown     = accountsWithUsage.filter((a) => a.effective_status === "unknown").length;

  // Provider summary â€” group active connections by provider
  const providerCounts = getConnectionCountByProvider();
  const portMap = Object.fromEntries(listProviderPorts().map(r => [r.provider, r.port]));
  const providerSummary = Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    name: p.name,
    color: p.color,
    logo: p.logo ?? null,
    authType: p.authType,
    deprecated: p.deprecated ?? false,
    underConstruction: p.underConstruction ?? false,
    connections: providerCounts[id] ?? 0,
    port: portMap[id] ?? null,
  })).filter(p => p.connections > 0);

  // Proxy pools
  const proxyPools = listProxyPools().map(pool => ({
    ...pool,
    connections: getConnectionCountForPool(pool.id),
  }));

  return json({
    proxy: { running, pid, port, strategy, stickyLimit },
    accounts: { list: accountsWithUsage, total: accounts.length, active: effectiveActive, unavailable: effectiveUnavailable, unknown: effectiveUnknown },
    usage: { totals, byModel, totalCost },
    providers: providerSummary,
    proxyPools,
  });
}

// â”€â”€ POST /api/auth/start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Body: { provider: string }
export async function handleAuthStart(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({})) as { provider?: string };
    if (!body.provider) return json({ error: "provider is required" }, 400);
    const providerId = body.provider;
    const meta = PROVIDERS[providerId];
    if (!meta) return json({ error: `Unknown provider: ${providerId}` }, 400);
    const lock = getProviderLock(meta);
    if (lock) return json({ error: lock.reason }, lock.kind === "deprecated" ? 410 : 503);
    const adapter = getAdapter(providerId);
    if (!adapter) return json({ error: `No OAuth adapter for ${providerId}` }, 400);
    if (adapter.flow !== "device_code") {
      return json({ error: `Provider ${providerId} uses ${adapter.flow} â€” use /api/auth/authorize` }, 400);
    }

    const device = await startDeviceFlow(providerId);
    return json(device);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// â”€â”€ POST /api/auth/poll â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Body: { session_id?: string; device_code?: string } â€” device_code accepted for legacy clients.
export async function handleAuthPoll(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { session_id?: string; device_code?: string };
    const sessionId = body.session_id ?? body.device_code;
    if (!sessionId) return json({ error: "session_id required" }, 400);

    const result = await pollDeviceFlow(sessionId);
    if (result.status === "complete") {
      ensureProviderServer(result.connection.provider);
      return json({ status: "complete", account: result.connection });
    }
    if (result.status === "error") {
      return json({ status: "error", message: result.message });
    }
    // pending | slow_down | denied | expired
    return json({ status: result.status === "slow_down" ? "pending" : result.status });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// â”€â”€ POST /api/auth/authorize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Body: { provider: string; meta?: Record<string, unknown> }
// Opens an ephemeral local HTTP listener for the OAuth redirect, returns the authUrl
// the browser should visit. Client then polls /api/auth/callback?session_id=â€¦
export async function handleAuthAuthorize(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { provider?: string; meta?: Record<string, unknown> };
    if (!body.provider) return json({ error: "provider required" }, 400);
    const adapter = getAdapter(body.provider);
    if (!adapter) return json({ error: `No OAuth adapter for ${body.provider}` }, 400);
    if (adapter.flow !== "authorization_code" && adapter.flow !== "authorization_code_pkce") {
      return json({ error: `Provider ${body.provider} does not use authorization-code flow` }, 400);
    }

    const listener = startCallbackListener({
      port: adapter.fixedPort ?? 0,
      path: adapter.callbackPath ?? "/callback",
      redirectHost: adapter.callbackHost,
    });
    const waiter = listener.wait().catch(e => ({ code: null, state: null, error: String(e) }));

    let started: ReturnType<typeof startAuthCodeFlow>;
    try {
      started = startAuthCodeFlow(body.provider, listener.redirectUri, body.meta);
    } catch (err) {
      // If auth setup fails after binding the callback port, immediately release it.
      listener.close();
      throw err;
    }

    pendingListeners.set(started.session_id, {
      close: listener.close,
      waiter,
      done: false,
      createdAt: Date.now(),
    });

    // If the callback flow fails (timeout/denied) and no poll request is in flight,
    // release the fixed port anyway so a new auth attempt can start immediately.
    waiter.then((capture) => {
      if (!capture?.error) return;
      const pending = pendingListeners.get(started.session_id);
      if (!pending || pending.done) return;
      pending.done = true;
      try { pending.close(); } catch { /* ignore */ }
      pendingListeners.delete(started.session_id);
    }).catch(() => { /* ignore */ });

    return json({
      session_id: started.session_id,
      auth_url: started.authUrl,
      state: started.state,
      redirect_uri: started.redirectUri,
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// â”€â”€ GET /api/auth/callback?session_id=â€¦ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Long-poll: resolves when the redirect lands on the ephemeral listener.
export async function handleAuthCallback(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return json({ error: "session_id required" }, 400);
    const pending = pendingListeners.get(sessionId);
    if (!pending) return json({ status: "expired" });
    if (pending.done) return json({ status: "expired" });

    const capture = await Promise.race([
      pending.waiter,
      Bun.sleep(CALLBACK_POLL_WAIT_MS).then(() => null),
    ]);
    if (!capture) return json({ status: "pending" });

    pending.done = true;
    // Give the callback tab enough time to render "Authorization complete"
    // before closing the local listener.
    setTimeout(() => {
      try { pending.close(); } catch { /* ignore */ }
      pendingListeners.delete(sessionId);
    }, 350);

    if (capture.error) {
      const msg = String(capture.error);
      const lower = msg.toLowerCase();
      if (lower.includes("timeout")) return json({ status: "expired", message: msg });
      if (lower.includes("access_denied") || lower.includes("denied")) {
        return json({ status: "denied", message: msg });
      }
      return json({ status: "error", message: msg });
    }
    if (!capture.code || !capture.state) return json({ status: "error", message: "missing code/state" });

    const connection = await completeAuthCodeFlow(sessionId, capture.code, capture.state);
    ensureProviderServer(connection.provider);
    return json({ status: "complete", account: connection });
  } catch (err) {
    return json({ status: "error", message: String(err) });
  }
}

// â”€â”€ POST /api/auth/import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Body: { provider: string; input: string; meta?: Record<string, unknown> }
export async function handleAuthImport(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { provider?: string; input?: string; meta?: Record<string, unknown> };
    if (!body.provider) return json({ error: "provider required" }, 400);
    if (!body.input) return json({ error: "input required" }, 400);
    const connection = await importToken(body.provider, body.input, body.meta);
    ensureProviderServer(body.provider);
    return json({ status: "complete", account: connection });
  } catch (err) {
    return json({ status: "error", message: String(err) });
  }
}

// â”€â”€ POST /api/accounts/:id/toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleAccountToggle(id: string): Response {
  const accounts = listAccounts();
  const account  = accounts.find((a) => a.id === id);
  if (!account) return json({ error: "Account not found" }, 404);

  const newActive = account.is_active === 1 ? 0 : 1;
  updateAccount(id, { is_active: newActive });

  return json({ ok: true, is_active: newActive });
}

// â”€â”€ DELETE /api/accounts/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleAccountRemove(id: string): Response {
  const ok = removeAccount(id);
  return ok ? json({ ok: true }) : json({ error: "Account not found" }, 404);
}

// â”€â”€ GET /api/setup-status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleSetupStatus(): Response {
  const done = getSetting("setup_done") === "1";
  return json({ done });
}

// â”€â”€ POST /api/setup-done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleSetupDone(): Response {
  setSetting("setup_done", "1");
  return json({ ok: true });
}

// â”€â”€ GET /api/config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleGetConfig(): Response {
  const requireClientAuth = getSetting("require_client_auth") ?? "false";
  return json({
    strategy:    getStrategy(),
    stickyLimit: getStickyLimit(),
    port:        getProxyPort(),
    require_client_auth: requireClientAuth,
  });
}

// â”€â”€ POST /api/config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleSetConfig(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as {
      strategy?: string;
      stickyLimit?: number;
      port?: number;
      require_client_auth?: string | boolean;
    };

    if (body.strategy !== undefined) {
      if (body.strategy !== "fill-first" && body.strategy !== "round-robin")
        return json({ error: "strategy must be fill-first or round-robin" }, 400);
      setSetting("strategy", body.strategy);
    }

    if (body.stickyLimit !== undefined) {
      const v = Number(body.stickyLimit);
      if (!Number.isInteger(v) || v < 1 || v > 100)
        return json({ error: "stickyLimit must be an integer 1â€“100" }, 400);
      setSetting("sticky_limit", String(v));
    }

    if (body.port !== undefined) {
      const v = Number(body.port);
      if (!Number.isInteger(v) || v < 1 || v > 65535)
        return json({ error: "port must be 1â€“65535" }, 400);
      setSetting("proxy_port", String(v));
    }

    if (body.require_client_auth !== undefined) {
      const normalized =
        body.require_client_auth === true || body.require_client_auth === "true" ? "true"
          : body.require_client_auth === false || body.require_client_auth === "false" ? "false"
            : null;
      if (!normalized) {
        return json({ error: "require_client_auth must be true or false" }, 400);
      }
      setSetting("require_client_auth", normalized);
    }

    return json({
      ok: true,
      strategy: getStrategy(),
      stickyLimit: getStickyLimit(),
      port: getProxyPort(),
      require_client_auth: getSetting("require_client_auth") ?? "false",
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// â”€â”€ GET /api/providers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleGetProviders(): Response {
  const counts = getConnectionCountByProvider();
  const list = Object.values(PROVIDERS).map(p => {
    const adapter = getAdapter(p.id);
    const models = getModelsForProvider(p.id);
    const freeModelsCount = models.filter((m) => m.is_free).length;
    const totalModelsCount = models.length;
    const hasFreeModels = totalModelsCount > 0
      ? freeModelsCount > 0
      : providerHasFreeModelsById(p.id);
    const topFreeRank = getTopFreeProviderRank(p.id);
    return {
      id:                p.id,
      name:              p.name,
      description:       p.description,
      category:          p.category,
      authType:          p.authType,
      oauthFlow:         adapter?.flow ?? null,
      color:             p.color,
      logo:              p.logo ?? null,
      apiKeyUrl:         p.apiKeyUrl ?? null,
      deprecated:        p.deprecated ?? false,
      deprecationReason: p.deprecationReason ?? null,
      underConstruction:       p.underConstruction ?? false,
      underConstructionReason: p.underConstructionReason ?? null,
      models:            p.models,
      connections:       counts[p.id] ?? 0,
      port:              getProviderPort(p.id),
      requiresMeta:      p.requiresMeta ?? null,
      freeTier:          hasFreeModels ? (p.freeTier ?? null) : null,
      hasFreeModels,
      freeModelsCount,
      totalModelsCount,
      topFreeRank,
    };
  });
  return json({ providers: list });
}

// â”€â”€ GET /api/providers/:id/connections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleGetProviderConnections(id: string): Response {
  const p = PROVIDERS[id];
  if (!p) return json({ error: `Unknown provider: ${id}` }, 404);
  const connections = listConnectionsByProvider(id).map(c => ({
    id:            c.id,
    display_name:  c.display_name,
    email:         c.email,
    auth_type:     c.auth_type,
    api_key_mask:  c.api_key ? maskApiKey(c.api_key) : null,
    is_active:     c.is_active,
    test_status:   c.test_status,
    priority:      c.priority,
    proxy_pool_id: c.proxy_pool_id ?? null,
    created_at:    c.created_at,
  }));
  return json({
    provider:    { id: p.id, name: p.name, color: p.color, logo: p.logo ?? null, port: getProviderPort(p.id) },
    connections,
  });
}

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "â€¢â€¢â€¢â€¢";
  return key.slice(0, 4) + "â€¦" + key.slice(-4);
}

// â”€â”€ POST /api/providers/custom â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleCreateCustomProvider(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { name?: string; url?: string };
    if (!body.name) return json({ error: "name is required" }, 400);
    if (!body.url)  return json({ error: "url is required" }, 400);

    const safeId = "custom_" + crypto.randomUUID().slice(0, 8) + "_" + body.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    const p: Provider = {
      id: safeId,
      name: body.name,
      description: "Custom provider",
      category: "apikey",
      authType: "apikey",
      color: "#94a3b8",
      baseUrl: body.url,
      models: [{ id: "default", name: "Default" }]
    };
    
    saveCustomProvider(p);
    return json(p);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// â”€â”€ POST /api/connections â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleAddConnection(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { provider?: string; api_key?: string; display_name?: string };
    if (!body.provider) return json({ error: "provider is required" }, 400);
    if (!body.api_key)  return json({ error: "api_key is required" }, 400);

    const p = PROVIDERS[body.provider];
    if (!p) return json({ error: `Unknown provider: ${body.provider}` }, 400);
    const addLock = getProviderLock(p);
    if (addLock) return json({ error: addLock.reason }, addLock.kind === "deprecated" ? 410 : 503);
    if (p.authType !== "apikey") return json({ error: "Use OAuth flow for this provider" }, 400);

    const connection = addApiKeyConnection({
      provider:     body.provider,
      api_key:      body.api_key.trim(),
      display_name: body.display_name ?? null,
    });
    const port = getProviderPort(body.provider);

    // Background: fetch models from provider API using the new key
    fetchAndSaveProviderModels(body.provider, body.api_key.trim()).catch(() => {});

    // Start the per-provider server on the fly if not already running
    ensureProviderServer(body.provider);

    return json({ ok: true, connection, port });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// â”€â”€ GET /api/providers/:id/models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleGetProviderModels(id: string): Response {
  const p = PROVIDERS[id];
  if (!p) return json({ error: `Unknown provider: ${id}` }, 404);
  const models = getModelsForProvider(id);
  const free_only = getSetting(`provider_free_only_${id}`) === "true";
  return json({ provider: id, models, free_only });
}

// â”€â”€ POST /api/providers/:id/config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleProviderConfig(id: string, req: Request): Promise<Response> {
  const p = PROVIDERS[id];
  if (!p) return json({ error: `Unknown provider: ${id}` }, 404);
  try {
    const body = (await req.json()) as { free_only?: boolean };
    if (typeof body.free_only === "boolean") {
      setSetting(`provider_free_only_${id}`, body.free_only ? "true" : "false");
      // Give server instances a hint to discard cache by touching models DB (already implemented implicitly next refresh)
      // They use modelsCache with TTL, so we can export a way or just let it expire in 10 mins.
      // Easiest is to do nothing complicated, but let's expose a global flag if needed.
      (globalThis as any).__grouterClearModelsCache = true;
    }
    return json({ ok: true, free_only: body.free_only });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// â”€â”€ POST /api/providers/:id/refresh-models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleRefreshProviderModels(id: string): Promise<Response> {
  const p = PROVIDERS[id];
  if (!p) return json({ error: `Unknown provider: ${id}` }, 404);
  try {
    const result = await fetchAndSaveProviderModels(id);
    (globalThis as any).__grouterClearModelsCache = true;
    return json({ provider: id, models: result.models, source: result.source });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ POST /api/providers/refresh-models (batch) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
export async function handleRefreshProviderModelsBatch(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as { providers?: string[] };
    const requested = Array.isArray(body.providers) ? body.providers : null;
    const targets = (requested && requested.length > 0 ? requested : Object.keys(PROVIDERS))
      .map((providerId) => providerId.trim().toLowerCase())
      .filter((providerId, idx, arr) => providerId.length > 0 && arr.indexOf(providerId) === idx);

    const results = await Promise.all(targets.map(async (providerId) => {
      if (!PROVIDERS[providerId]) {
        return { provider: providerId, ok: false, error: `Unknown provider: ${providerId}` };
      }
      try {
        const refreshed = await fetchAndSaveProviderModels(providerId);
        return {
          provider: providerId,
          ok: true,
          source: refreshed.source,
          model_count: refreshed.models.length,
        };
      } catch (err) {
        return { provider: providerId, ok: false, error: String(err) };
      }
    }));

    (globalThis as any).__grouterClearModelsCache = true;
    const success = results.filter((r) => r.ok).length;
    return json({
      ok: success === results.length,
      summary: { total: results.length, success, failed: results.length - success },
      results,
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// â”€â”€ GET /api/proxy-pools â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleListProxyPools(): Response {
  const pools = listProxyPools().map(p => ({
    ...p,
    connections: getConnectionCountForPool(p.id),
  }));
  return json({ pools });
}

// â”€â”€ POST /api/proxy-pools â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleCreateProxyPool(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { name?: string; proxy_url?: string; no_proxy?: string };
    if (!body.name)      return json({ error: "name is required" }, 400);
    if (!body.proxy_url) return json({ error: "proxy_url is required" }, 400);
    const pool = createProxyPool({ name: body.name, proxy_url: body.proxy_url, no_proxy: body.no_proxy ?? null });
    return json({ ok: true, pool });
  } catch (err) { return json({ error: String(err) }, 500); }
}

// â”€â”€ DELETE /api/proxy-pools/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleDeleteProxyPool(id: string): Response {
  const pool = getProxyPoolById(id);
  if (!pool) return json({ error: "Pool not found" }, 404);
  const bound = getConnectionCountForPool(id);
  if (bound > 0) return json({ error: `Cannot delete â€” ${bound} connection(s) still use this pool` }, 409);
  deleteProxyPool(id);
  return json({ ok: true });
}

// â”€â”€ PATCH /api/proxy-pools/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleUpdateProxyPool(id: string, req: Request): Promise<Response> {
  try {
    const pool = getProxyPoolById(id);
    if (!pool) return json({ error: "Pool not found" }, 404);
    const body = (await req.json()) as Partial<{ name: string; proxy_url: string; no_proxy: string | null; is_active: number }>;
    updateProxyPool(id, body);
    return json({ ok: true, pool: getProxyPoolById(id) });
  } catch (err) { return json({ error: String(err) }, 500); }
}

// â”€â”€ PATCH /api/connections/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleUpdateConnection(id: string, req: Request): Promise<Response> {
  try {
    const accounts = listAccounts();
    const account  = accounts.find((a) => a.id === id);
    if (!account) return json({ error: "Connection not found" }, 404);
    const body = (await req.json()) as { proxy_pool_id?: string | null };
    updateAccount(id, body);
    return json({ ok: true });
  } catch (err) { return json({ error: String(err) }, 500); }
}

// â”€â”€ POST /api/proxy-pools/:id/test â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleTestProxyPool(id: string): Promise<Response> {
  const pool = getProxyPoolById(id);
  if (!pool) return json({ error: "Pool not found" }, 404);
  const result = await testProxyPool(pool);
  return json(result);
}

// â”€â”€ POST /api/proxy/stop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleProxyStop(): Response {
  // Send the response first, then exit cleanly after a brief delay
  setTimeout(() => { try { removePid(); } catch {} process.exit(0); }, 300);
  return json({ ok: true });
}

// â”€â”€ POST /api/unlock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleUnlockAll(): Response {
  clearModelLocks();
  // Reset backoff and test_status on all accounts
  db().exec(`UPDATE accounts SET backoff_level = 0, test_status = 'unknown', last_error = NULL, error_code = NULL, last_error_at = NULL`);
  return json({ ok: true });
}

// â”€â”€ GET /api/client-keys â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleListClientKeys(): Response {
  return json({ keys: listClientKeys() });
}

function normalizeAllowedProvidersInput(raw: unknown): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  const cleaned = raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeExpiresAtInput(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

// â”€â”€ POST /api/client-keys â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleCreateClientKey(req: Request): Promise<Response> {
  try {
    const body = await req.json() as {
      name?: string;
      allowed_providers?: string[] | null;
      token_limit?: number;
      api_key?: string;
      expires_at?: string | null;
    };

    const name = body.name?.trim();
    if (!name) return json({ error: "Missing name" }, 400);

    const allowedProviders = normalizeAllowedProvidersInput(body.allowed_providers);
    if (allowedProviders === undefined) {
      return json({ error: "allowed_providers must be an array of provider ids or null" }, 400);
    }

    const tokenLimit = Number(body.token_limit ?? 0);
    if (!Number.isInteger(tokenLimit) || tokenLimit < 0) {
      return json({ error: "token_limit must be a non-negative integer" }, 400);
    }

    const expiresAt = normalizeExpiresAtInput(body.expires_at);
    if (expiresAt === undefined) {
      return json({ error: "expires_at must be a valid ISO date or null" }, 400);
    }

    const key = body.api_key?.trim() || "grouter-sk-" + crypto.randomUUID().replace(/-/g, "");
    createClientKey({
      name,
      api_key: key,
      allowed_providers: allowedProviders ?? null,
      token_limit: tokenLimit,
      expires_at: expiresAt ?? null
    });
    return json({ ok: true, key, client_key: getClientKey(key) });
  } catch (err) {
    if (String(err).includes("UNIQUE constraint failed")) {
      return json({ error: "Client key already exists" }, 409);
    }
    return json({ error: String(err) }, 500);
  }
}

// â”€â”€ DELETE /api/client-keys/:api_key â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function handleDeleteClientKey(key: string): Response {
  deleteClientKey(key);
  return json({ ok: true });
}

// â”€â”€ PATCH /api/client-keys/:api_key â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function handleUpdateClientKey(req: Request, key: string): Promise<Response> {
  try {
    const body = await req.json() as {
      name?: string;
      allowed_providers?: string[] | null;
      token_limit?: number;
      expires_at?: string | null;
    };

    const existing = getClientKey(key);
    if (!existing) return json({ error: "Key not found" }, 404);

    const hasAnyField =
      body.name !== undefined ||
      body.allowed_providers !== undefined ||
      body.token_limit !== undefined ||
      body.expires_at !== undefined;
    if (!hasAnyField) {
      return json({ error: "No fields provided for update" }, 400);
    }

    const name = body.name !== undefined ? body.name.trim() : existing.name;
    if (!name) return json({ error: "Missing name" }, 400);

    const allowedProvidersRaw = normalizeAllowedProvidersInput(body.allowed_providers);
    if (body.allowed_providers !== undefined && allowedProvidersRaw === undefined) {
      return json({ error: "allowed_providers must be an array of provider ids or null" }, 400);
    }
    const allowedProviders =
      body.allowed_providers !== undefined
        ? (allowedProvidersRaw ?? null)
        : (parseAllowedProviders(existing.allowed_providers) ?? null);

    const tokenLimit = body.token_limit !== undefined ? Number(body.token_limit) : existing.token_limit;
    if (!Number.isInteger(tokenLimit) || tokenLimit < 0) {
      return json({ error: "token_limit must be a non-negative integer" }, 400);
    }

    const expiresAtRaw = normalizeExpiresAtInput(body.expires_at);
    if (body.expires_at !== undefined && expiresAtRaw === undefined) {
      return json({ error: "expires_at must be a valid ISO date or null" }, 400);
    }
    const expiresAt = body.expires_at !== undefined ? (expiresAtRaw ?? null) : existing.expires_at;

    updateClientKey(key, {
      name,
      allowed_providers: allowedProviders,
      token_limit: tokenLimit,
      expires_at: expiresAt
    });
    return json({ ok: true, client_key: getClientKey(key) });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}
