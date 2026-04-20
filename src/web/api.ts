import {
  startDeviceFlow,
  pollDeviceFlow,
  startAuthCodeFlow,
  completeAuthCodeFlow,
  importToken,
} from "../auth/orchestrator.ts";
import { startCallbackListener } from "../auth/server.ts";
import { getAdapter } from "../auth/providers/index.ts";
import { addApiKeyConnection, listAccounts, removeAccount, updateAccount, getConnectionCountByProvider } from "../db/accounts.ts";
import { getUsageTotals, getUsageByModel, getUsageByAccount } from "../db/usage.ts";
import { getStrategy, getStickyLimit, getProxyPort, getSetting, setSetting, db } from "../db/index.ts";
import { isRunning, readPid, removePid } from "../daemon/index.ts";
import { estimateCostUSD } from "../constants.ts";
import { clearModelLocks, getActiveModelLocks } from "../rotator/lock.ts";
import { PROVIDERS, OAUTH_PROVIDERS, FREE_PROVIDERS, APIKEY_PROVIDERS, saveCustomProvider, type Provider } from "../providers/registry.ts";
import { listProxyPools, getProxyPoolById, createProxyPool, updateProxyPool, deleteProxyPool, testProxyPool, getConnectionCountForPool } from "../db/pools.ts";
import { getProviderPort, listProviderPorts } from "../db/ports.ts";
import { listConnectionsByProvider } from "../db/accounts.ts";
import { fetchAndSaveProviderModels, getModelsForProvider } from "../providers/model-fetcher.ts";
import { listClientKeys, createClientKey, deleteClientKey, updateClientKey, getClientKey } from "../db/client_keys.ts";

// Pending auth-code callback listeners keyed by session_id
interface PendingListener {
  close: () => void;
  waiter: Promise<{ code: string | null; state: string | null; error: string | null }>;
  done: boolean;
}
const pendingListeners = new Map<string, PendingListener>();

// ── CORS headers ──────────────────────────────────────────────────────────────
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

// ── GET /api/status ───────────────────────────────────────────────────────────
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

  // Provider summary — group active connections by provider
  const providerCounts = getConnectionCountByProvider();
  const portMap = Object.fromEntries(listProviderPorts().map(r => [r.provider, r.port]));
  const providerSummary = Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    name: p.name,
    color: p.color,
    logo: p.logo ?? null,
    authType: p.authType,
    deprecated: p.deprecated ?? false,
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

// ── POST /api/auth/start ──────────────────────────────────────────────────────
// Body: { provider: string }
export async function handleAuthStart(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({})) as { provider?: string };
    if (!body.provider) return json({ error: "provider is required" }, 400);
    const providerId = body.provider;
    const meta = PROVIDERS[providerId];
    if (!meta) return json({ error: `Unknown provider: ${providerId}` }, 400);
    if (meta.deprecated) return json({ error: meta.deprecationReason ?? `${meta.name} is deprecated` }, 410);
    const adapter = getAdapter(providerId);
    if (!adapter) return json({ error: `No OAuth adapter for ${providerId}` }, 400);
    if (adapter.flow !== "device_code") {
      return json({ error: `Provider ${providerId} uses ${adapter.flow} — use /api/auth/authorize` }, 400);
    }

    const device = await startDeviceFlow(providerId);
    return json(device);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// ── POST /api/auth/poll ───────────────────────────────────────────────────────
// Body: { session_id?: string; device_code?: string } — device_code accepted for legacy clients.
export async function handleAuthPoll(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { session_id?: string; device_code?: string };
    const sessionId = body.session_id ?? body.device_code;
    if (!sessionId) return json({ error: "session_id required" }, 400);

    const result = await pollDeviceFlow(sessionId);
    if (result.status === "complete") {
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

// ── POST /api/auth/authorize ──────────────────────────────────────────────────
// Body: { provider: string; meta?: Record<string, unknown> }
// Opens an ephemeral local HTTP listener for the OAuth redirect, returns the authUrl
// the browser should visit. Client then polls /api/auth/callback?session_id=…
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
    });
    const waiter = listener.wait().catch(e => ({ code: null, state: null, error: String(e) }));

    const started = startAuthCodeFlow(body.provider, listener.redirectUri, body.meta);
    pendingListeners.set(started.session_id, { close: listener.close, waiter, done: false });

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

// ── GET /api/auth/callback?session_id=… ───────────────────────────────────────
// Long-poll: resolves when the redirect lands on the ephemeral listener.
export async function handleAuthCallback(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return json({ error: "session_id required" }, 400);
    const pending = pendingListeners.get(sessionId);
    if (!pending) return json({ status: "expired" });
    if (pending.done) return json({ status: "expired" });

    const capture = await pending.waiter;
    pending.done = true;
    pending.close();
    pendingListeners.delete(sessionId);

    if (capture.error) return json({ status: "denied", message: capture.error });
    if (!capture.code || !capture.state) return json({ status: "error", message: "missing code/state" });

    const connection = await completeAuthCodeFlow(sessionId, capture.code, capture.state);
    return json({ status: "complete", account: connection });
  } catch (err) {
    return json({ status: "error", message: String(err) });
  }
}

// ── POST /api/auth/import ─────────────────────────────────────────────────────
// Body: { provider: string; input: string; meta?: Record<string, unknown> }
export async function handleAuthImport(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { provider?: string; input?: string; meta?: Record<string, unknown> };
    if (!body.provider) return json({ error: "provider required" }, 400);
    if (!body.input) return json({ error: "input required" }, 400);
    const connection = await importToken(body.provider, body.input, body.meta);
    return json({ status: "complete", account: connection });
  } catch (err) {
    return json({ status: "error", message: String(err) });
  }
}

// ── POST /api/accounts/:id/toggle ────────────────────────────────────────────
export function handleAccountToggle(id: string): Response {
  const accounts = listAccounts();
  const account  = accounts.find((a) => a.id === id);
  if (!account) return json({ error: "Account not found" }, 404);

  const newActive = account.is_active === 1 ? 0 : 1;
  updateAccount(id, { is_active: newActive });

  return json({ ok: true, is_active: newActive });
}

// ── DELETE /api/accounts/:id ──────────────────────────────────────────────────
export function handleAccountRemove(id: string): Response {
  const ok = removeAccount(id);
  return ok ? json({ ok: true }) : json({ error: "Account not found" }, 404);
}

// ── GET /api/setup-status ─────────────────────────────────────────────────────
export function handleSetupStatus(): Response {
  const done = getSetting("setup_done") === "1";
  return json({ done });
}

// ── POST /api/setup-done ──────────────────────────────────────────────────────
export function handleSetupDone(): Response {
  setSetting("setup_done", "1");
  return json({ ok: true });
}

// ── GET /api/config ───────────────────────────────────────────────────────────
export function handleGetConfig(): Response {
  return json({
    strategy:    getStrategy(),
    stickyLimit: getStickyLimit(),
    port:        getProxyPort(),
  });
}

// ── POST /api/config ──────────────────────────────────────────────────────────
export async function handleSetConfig(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { strategy?: string; stickyLimit?: number; port?: number };

    if (body.strategy !== undefined) {
      if (body.strategy !== "fill-first" && body.strategy !== "round-robin")
        return json({ error: "strategy must be fill-first or round-robin" }, 400);
      setSetting("strategy", body.strategy);
    }

    if (body.stickyLimit !== undefined) {
      const v = Number(body.stickyLimit);
      if (!Number.isInteger(v) || v < 1 || v > 100)
        return json({ error: "stickyLimit must be an integer 1–100" }, 400);
      setSetting("sticky_limit", String(v));
    }

    if (body.port !== undefined) {
      const v = Number(body.port);
      if (!Number.isInteger(v) || v < 1 || v > 65535)
        return json({ error: "port must be 1–65535" }, 400);
      setSetting("proxy_port", String(v));
    }

    return json({ ok: true, strategy: getStrategy(), stickyLimit: getStickyLimit(), port: getProxyPort() });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// ── GET /api/providers ────────────────────────────────────────────────────────
export function handleGetProviders(): Response {
  const counts = getConnectionCountByProvider();
  const list = Object.values(PROVIDERS).map(p => {
    const adapter = getAdapter(p.id);
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
      models:            p.models,
      connections:       counts[p.id] ?? 0,
      port:              getProviderPort(p.id),
      requiresMeta:      p.requiresMeta ?? null,
      freeTier:          p.freeTier ?? null,
    };
  });
  return json({ providers: list });
}

// ── GET /api/providers/:id/connections ────────────────────────────────────────
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
  if (key.length <= 8) return "••••";
  return key.slice(0, 4) + "…" + key.slice(-4);
}

// ── POST /api/providers/custom ────────────────────────────────────────────────
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

// ── POST /api/connections ─────────────────────────────────────────────────────
export async function handleAddConnection(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { provider?: string; api_key?: string; display_name?: string };
    if (!body.provider) return json({ error: "provider is required" }, 400);
    if (!body.api_key)  return json({ error: "api_key is required" }, 400);

    const p = PROVIDERS[body.provider];
    if (!p) return json({ error: `Unknown provider: ${body.provider}` }, 400);
    if (p.deprecated) return json({ error: `${p.name} is no longer accepting new connections: ${p.deprecationReason ?? "deprecated"}` }, 410);
    if (p.authType !== "apikey") return json({ error: "Use OAuth flow for this provider" }, 400);

    const connection = addApiKeyConnection({
      provider:     body.provider,
      api_key:      body.api_key.trim(),
      display_name: body.display_name ?? null,
    });
    const port = getProviderPort(body.provider);

    // Background: fetch models from provider API using the new key
    fetchAndSaveProviderModels(body.provider, body.api_key.trim()).catch(() => {});

    return json({ ok: true, connection, port });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// ── GET /api/providers/:id/models ────────────────────────────────────────────
export function handleGetProviderModels(id: string): Response {
  const p = PROVIDERS[id];
  if (!p) return json({ error: `Unknown provider: ${id}` }, 404);
  const models = getModelsForProvider(id);
  const free_only = getSetting(`provider_free_only_${id}`) === "true";
  return json({ provider: id, models, free_only });
}

// ── POST /api/providers/:id/config ───────────────────────────────────────────
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

// ── POST /api/providers/:id/refresh-models ───────────────────────────────────
export async function handleRefreshProviderModels(id: string): Promise<Response> {
  const p = PROVIDERS[id];
  if (!p) return json({ error: `Unknown provider: ${id}` }, 404);
  try {
    const result = await fetchAndSaveProviderModels(id);
    return json({ provider: id, models: result.models, source: result.source });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// ── GET /api/proxy-pools ──────────────────────────────────────────────────────
export function handleListProxyPools(): Response {
  const pools = listProxyPools().map(p => ({
    ...p,
    connections: getConnectionCountForPool(p.id),
  }));
  return json({ pools });
}

// ── POST /api/proxy-pools ─────────────────────────────────────────────────────
export async function handleCreateProxyPool(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { name?: string; proxy_url?: string; no_proxy?: string };
    if (!body.name)      return json({ error: "name is required" }, 400);
    if (!body.proxy_url) return json({ error: "proxy_url is required" }, 400);
    const pool = createProxyPool({ name: body.name, proxy_url: body.proxy_url, no_proxy: body.no_proxy ?? null });
    return json({ ok: true, pool });
  } catch (err) { return json({ error: String(err) }, 500); }
}

// ── DELETE /api/proxy-pools/:id ───────────────────────────────────────────────
export function handleDeleteProxyPool(id: string): Response {
  const pool = getProxyPoolById(id);
  if (!pool) return json({ error: "Pool not found" }, 404);
  const bound = getConnectionCountForPool(id);
  if (bound > 0) return json({ error: `Cannot delete — ${bound} connection(s) still use this pool` }, 409);
  deleteProxyPool(id);
  return json({ ok: true });
}

// ── PATCH /api/proxy-pools/:id ────────────────────────────────────────────────
export async function handleUpdateProxyPool(id: string, req: Request): Promise<Response> {
  try {
    const pool = getProxyPoolById(id);
    if (!pool) return json({ error: "Pool not found" }, 404);
    const body = (await req.json()) as Partial<{ name: string; proxy_url: string; no_proxy: string | null; is_active: number }>;
    updateProxyPool(id, body);
    return json({ ok: true, pool: getProxyPoolById(id) });
  } catch (err) { return json({ error: String(err) }, 500); }
}

// ── PATCH /api/connections/:id ─────────────────────────────────────────────────
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

// ── POST /api/proxy-pools/:id/test ────────────────────────────────────────────
export async function handleTestProxyPool(id: string): Promise<Response> {
  const pool = getProxyPoolById(id);
  if (!pool) return json({ error: "Pool not found" }, 404);
  const result = await testProxyPool(pool);
  return json(result);
}

// ── POST /api/proxy/stop ──────────────────────────────────────────────────────
export function handleProxyStop(): Response {
  // Send the response first, then exit cleanly after a brief delay
  setTimeout(() => { try { removePid(); } catch {} process.exit(0); }, 300);
  return json({ ok: true });
}

// ── POST /api/unlock ──────────────────────────────────────────────────────────
export function handleUnlockAll(): Response {
  clearModelLocks();
  // Reset backoff and test_status on all accounts
  db().exec(`UPDATE accounts SET backoff_level = 0, test_status = 'unknown', last_error = NULL, error_code = NULL, last_error_at = NULL`);
  return json({ ok: true });
}

// ── GET /api/client-keys ──────────────────────────────────────────────────────
export function handleListClientKeys(): Response {
  return json({ keys: listClientKeys() });
}

// ── POST /api/client-keys ─────────────────────────────────────────────────────
export async function handleCreateClientKey(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { name: string; allowed_providers?: string[]; token_limit?: number; api_key?: string; expires_at?: string };
    if (!body.name) return json({ error: "Missing name" }, 400);
    const key = body.api_key || "grouter-sk-" + crypto.randomUUID().replace(/-/g, "");
    createClientKey({
      name: body.name,
      api_key: key,
      allowed_providers: body.allowed_providers && body.allowed_providers.length > 0 ? body.allowed_providers : null,
      token_limit: body.token_limit || 0,
      expires_at: body.expires_at || null
    });
    return json({ ok: true, key });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// ── DELETE /api/client-keys/:api_key ──────────────────────────────────────────
export function handleDeleteClientKey(key: string): Response {
  deleteClientKey(key);
  return json({ ok: true });
}

// ── PATCH /api/client-keys/:api_key ───────────────────────────────────────────
export async function handleUpdateClientKey(req: Request, key: string): Promise<Response> {
  try {
    const body = await req.json() as { name?: string; allowed_providers?: string[]; token_limit?: number; expires_at?: string };
    if (!body.name) return json({ error: "Missing name" }, 400);

    const k = getClientKey(key);
    if (!k) return json({ error: "Key not found" }, 404);

    updateClientKey(key, {
      name: body.name,
      allowed_providers: body.allowed_providers && body.allowed_providers.length > 0 ? body.allowed_providers : null,
      token_limit: body.token_limit || 0,
      expires_at: body.expires_at || null
    });
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}
