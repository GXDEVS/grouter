import chalk from "chalk";
import { QWEN_MODELS_OAUTH } from "../constants.ts";
import { buildUpstream } from "./upstream.ts";
import { claudeChunkToOpenAI, newClaudeStreamState, translateClaudeNonStream } from "./claude-translator.ts";
import { codexChunkToOpenAI, newCodexStreamState, translateCodexNonStream } from "./codex-translator.ts";
import { geminiChunkToOpenAI, newGeminiStreamState, translateGeminiNonStream } from "./gemini-translator.ts";
import { getSetting } from "../db/index.ts";
import { CURRENT_VERSION, fetchAndCacheVersion } from "../update/checker.ts";
import { selectAccount, markAccountUnavailable, clearAccountError } from "../rotator/index.ts";
import { checkAndRefreshAccount } from "../token/refresh.ts";
import { isRateLimitedResult, isTemporarilyUnavailableResult } from "../types.ts";
import { listAccounts } from "../db/accounts.ts";
import { recordUsage } from "../db/usage.ts";
import { PROVIDERS } from "../providers/registry.ts";
import { getModelsForProvider } from "../providers/model-fetcher.ts";
import { getConnectionCountByProvider } from "../db/accounts.ts";
import { getClientKey, updateClientKeyUsage } from "../db/client_keys.ts";
import {
  handleStatus,
  handleAuthStart,
  handleAuthPoll,
  handleAuthAuthorize,
  handleAuthCallback,
  handleAuthImport,
  handleAccountToggle,
  handleAccountRemove,
  handleGetConfig,
  handleSetConfig,
  handleUnlockAll,
  handleSetupStatus,
  handleSetupDone,
  handleProxyStop,
  handleGetProviders,
  handleGetProviderConnections,
  handleAddConnection,
  handleListProxyPools,
  handleCreateProxyPool,
  handleUpdateProxyPool,
  handleDeleteProxyPool,
  handleTestProxyPool,
  handleUpdateConnection,
  handleCreateCustomProvider,
  handleGetProviderModels,
  handleRefreshProviderModels,
  handleProviderConfig,
  handleListClientKeys,
  handleCreateClientKey,
  handleUpdateClientKey,
  handleDeleteClientKey,
  handleRefreshProviderModelsBatch,
} from "../web/api.ts";
import { getProxyPoolById } from "../db/pools.ts";
import { getProviderPort, listProviderPorts } from "../db/ports.ts";

// â”€â”€ HTML pages + static assets â€” embedded at build time â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// @ts-ignore
import WIZARD_HTML    from "../web/wizard.html"       with { type: "text" };
// @ts-ignore
import DASHBOARD_HTML from "../web/dashboard.html"    with { type: "text" };
// @ts-ignore
import ANIMATION_JS   from "../public/animation.js"  with { type: "text" };
import { serveLogo } from "../web/logos.ts";

// Bun route params â€” not in the standard Request type
interface BunRequest extends Request {
  params: Record<string, string>;
}

function serveWizard():    Response { return new Response(WIZARD_HTML    as unknown as string, { headers: { "Content-Type": "text/html; charset=utf-8" } }); }
function serveDashboard(): Response { return new Response(DASHBOARD_HTML as unknown as string, { headers: { "Content-Type": "text/html; charset=utf-8" } }); }

const MAX_RETRIES = 3;
const SERVER_IDLE_TIMEOUT_SECONDS = 240;

// â”€â”€ Model cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let modelsCache: { data: unknown[]; at: number } | null = null;
const MODELS_TTL = 10 * 60 * 1000;

/** Invalidates the in-memory models cache. Called by API handlers after config changes. */
export function clearModelsCache(): void {
  modelsCache = null;
}

/**
 * Aggregate models from ALL providers that have active connections.
 * Each model is prefixed: "provider/model-id".
 * Uses DB-stored models when available, otherwise falls back to registry.
 */
async function fetchModels(req?: Request) {
  
  let baseData: unknown[] = [];
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL) {
    baseData = modelsCache.data;
  } else {


  const counts = getConnectionCountByProvider();
  const data: unknown[] = [];

  for (const [providerId, provider] of Object.entries(PROVIDERS)) {
    // Include providers with connections, or all providers with models defined
    const hasConnections = (counts[providerId] ?? 0) > 0;
    if (!hasConnections && provider.category !== "free") continue;

    const models = getModelsForProvider(providerId);
    const freeOnly = getSetting(`provider_free_only_${providerId}`) === "true";
    for (const m of models) {
      if (freeOnly && !m.is_free) continue;
      data.push({
        id: `${providerId}/${m.id}`,
        object: "model",
        created: 1720000000,
        owned_by: providerId,
      });
    }
  }

  if (data.length === 0) {
    // Ultimate fallback: Qwen hardcoded models
    const fallback = QWEN_MODELS_OAUTH.map((id) => ({
      id: `qwen/${id}`,
      object: "model",
      created: 1720000000,
      owned_by: "qwen",
    }));
    modelsCache = { data: fallback, at: Date.now() };
    baseData = fallback;
  } else {
    modelsCache = { data, at: Date.now() };
    baseData = data;
  }
  } // <-- Added brace to close the `if (modelsCache...) { ... } else {` block

  // --- Dynamic Filtering depending on request Client API Key ---
  if (req) {
    const authHeader = req.headers.get("Authorization");
    const requireAuth = getSetting("require_client_auth") === "true";
    let clientKey = null;

    if (authHeader?.startsWith("Bearer ")) {
      clientKey = getClientKey(authHeader.slice(7).trim());
    }

    if (clientKey) {
      if (clientKey.allowed_providers) {
        try {
          const allowed: string[] = JSON.parse(clientKey.allowed_providers);
          if (allowed.length > 0) {
            return baseData.filter((m: any) => allowed.includes(m.id.split("/")[0]));
          }
        } catch {}
      }
    } else if (requireAuth) {
      // Key is absent or invalid, but auth is required
      return [];
    }
  }

  return baseData;
}

// â”€â”€ Logger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function logReq(method: string, path: string, status: number, ms: number,
  meta?: { model?: string | null; account?: string; rotated?: number; tokens?: number }) {
  const time = chalk.gray(new Date().toLocaleTimeString("pt-BR", { hour12: false }));
  const sc = status < 300 ? chalk.green : status < 400 ? chalk.cyan : status < 500 ? chalk.yellow : chalk.red;
  const lat = ms < 1000 ? chalk.gray(`${ms}ms`) : chalk.yellow(`${(ms / 1000).toFixed(1)}s`);
  let extras = "";
  if (meta?.model) extras += chalk.magenta(` ${meta.model}`);
  if (meta?.account) extras += chalk.gray(` â†’ ${meta.account}`);
  if (meta?.rotated && meta.rotated > 0) extras += chalk.yellow(` â†»Ã—${meta.rotated}`);
  if (meta?.tokens) extras += chalk.gray(` [${meta.tokens}t]`);
  console.log(`  ${time} ${chalk.bold(method.padEnd(4))} ${path}${extras} ${sc(String(status))} ${lat}`);
}

// â”€â”€ Provider/model parsing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parseProviderModel(raw: string | null, pinnedProvider?: string): { provider: string | null; model: string } {
  if (pinnedProvider) {
    if (!raw) return { provider: pinnedProvider, model: "" };
    const slash = raw.indexOf("/");
    // On provider-pinned ports, keep model IDs exactly as provided because
    // many providers use namespaced models (e.g. "Qwen/Qwen3-...").
    // Only strip when the prefix matches the pinned provider itself.
    if (slash === -1) return { provider: pinnedProvider, model: raw };
    const maybeProvider = raw.slice(0, slash).toLowerCase();
    if (maybeProvider === pinnedProvider.toLowerCase()) {
      return { provider: pinnedProvider, model: raw.slice(slash + 1) };
    }
    return { provider: pinnedProvider, model: raw };
  }
  // Without a pinned provider the format "provider/model" is required.
  if (!raw) return { provider: null, model: "" };
  const slash = raw.indexOf("/");
  if (slash === -1) return { provider: null, model: raw };
  return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return Response.json(data, { status, headers: { ...corsHeaders(), ...extra } });
}



interface TokenUsage { prompt: number; completion: number; total: number }

// Extracts usage from the tail of a streaming SSE response.
// Searches for the last `"usage":` object to avoid false positives from
// model-generated content and handles chunk fragmentation by working on
// an accumulated buffer instead of individual chunks.
function extractUsageFromSSE(tail: string): TokenUsage | null {
  const idx = tail.lastIndexOf('"usage":');
  if (idx === -1) return null;
  const slice = tail.slice(idx, idx + 256);
  const prompt     = parseInt(slice.match(/"prompt_tokens"\s*:\s*(\d+)/)?.[1]     ?? "0", 10);
  const completion = parseInt(slice.match(/"completion_tokens"\s*:\s*(\d+)/)?.[1] ?? "0", 10);
  const total      = parseInt(slice.match(/"total_tokens"\s*:\s*(\d+)/)?.[1]      ?? "0", 10)
                     || (prompt + completion);
  if (!prompt && !completion) return null;
  return { prompt, completion, total };
}

// â”€â”€ Server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function startServer(port: number) {
  return Bun.serve({
    port,
    idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,

    routes: {
      // â”€â”€ Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      "/": {
        GET: () => {
          if (getSetting("setup_done") === "1") {
            return new Response(null, { status: 302, headers: { Location: "/dashboard" } });
          }
          return serveWizard();
        },
      },
      "/setup": { GET: () => serveWizard() },
      "/public/animation.js": {
        GET: () => new Response(ANIMATION_JS as string, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" } }),
      },
      "/public/logos/:file": {
        GET: (req: BunRequest) => serveLogo(req.params.file!),
      },
      "/dashboard": { GET: () => serveDashboard() },

      // â”€â”€ Dashboard API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      "/api/status": {
        GET: () => handleStatus(),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/auth/start": {
        POST: (req: Request) => handleAuthStart(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/auth/poll": {
        POST: (req: Request) => handleAuthPoll(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/auth/authorize": {
        POST: (req: Request) => handleAuthAuthorize(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/auth/callback": {
        GET: (req: Request) => handleAuthCallback(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/auth/import": {
        POST: (req: Request) => handleAuthImport(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/accounts/:id/toggle": {
        POST: (req: BunRequest) => handleAccountToggle(req.params.id!),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/accounts/:id": {
        DELETE: (req: BunRequest) => handleAccountRemove(req.params.id!),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/setup-status": {
        GET:     () => handleSetupStatus(),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/setup-done": {
        POST:    () => handleSetupDone(),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/client-keys": {
        GET:     () => handleListClientKeys(),
        POST:    (req: Request) => handleCreateClientKey(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/client-keys/:key": {
        PATCH:   (req: BunRequest) => handleUpdateClientKey(req, req.params.key!),
        DELETE:  (req: BunRequest) => handleDeleteClientKey(req.params.key!),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/config": {
        GET:     () => handleGetConfig(),
        POST:    (req: Request) => handleSetConfig(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/unlock": {
        POST:    () => handleUnlockAll(),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/providers": {
        GET:     () => handleGetProviders(),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/providers/custom": {
        POST:    (req: Request) => handleCreateCustomProvider(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/providers/:id/connections": {
        GET:     (req: BunRequest) => handleGetProviderConnections(req.params.id!),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/providers/:id/models": {
        GET:     (req: BunRequest) => handleGetProviderModels(req.params.id!),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/providers/:id/refresh-models": {
        POST:    (req: BunRequest) => handleRefreshProviderModels(req.params.id!),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/providers/refresh-models": {
        POST:    (req: Request) => handleRefreshProviderModelsBatch(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/providers/:id/config": {
        POST:    (req: BunRequest) => handleProviderConfig(req.params.id!, req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/providers/:id/wake": {
        POST:    (req: BunRequest) => {
          const id = req.params.id!;
          ensureProviderServer(id);
          const port = getProviderPort(id);
          return jsonResponse({ ok: true, provider: id, port });
        },
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/connections": {
        POST:    (req: Request) => handleAddConnection(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/proxy-pools": {
        GET:     () => handleListProxyPools(),
        POST:    (req: Request) => handleCreateProxyPool(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/proxy-pools/:id": {
        PATCH:   (req: BunRequest) => handleUpdateProxyPool(req.params.id!, req),
        DELETE:  (req: BunRequest) => handleDeleteProxyPool(req.params.id!),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/proxy-pools/:id/test": {
        POST:    (req: BunRequest) => handleTestProxyPool(req.params.id!),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/connections/:id": {
        PATCH:   (req: BunRequest) => handleUpdateConnection(req.params.id!, req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/api/proxy/stop": {
        POST:    () => handleProxyStop(),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },

      // â”€â”€ Proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      "/health": {
        GET: async () => {
          const accounts = listAccounts();
          const active = accounts.filter((a) => a.is_active && a.test_status !== "unavailable").length;
          return jsonResponse({ status: "ok", accounts: accounts.length, active });
        },
      },

      "/v1/models": {
        GET: async (req: Request) => jsonResponse({ object: "list", data: await fetchModels(req) }),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },

      "/api/version": {
        GET: async () => {
          const remote = await fetchAndCacheVersion();
          return jsonResponse({ current: CURRENT_VERSION, latest: remote ?? CURRENT_VERSION });
        },
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },

      "/v1/chat/completions": {
        POST: (req: Request) => handleChatCompletions(req),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
    },

    fetch(req) {
      // CORS preflight fallback
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
      return jsonResponse({ error: { message: "Not found", type: "grouter_error", code: 404 } }, 404);
    },
  });
}

/**
 * Start a provider-pinned server on `port`. Requests to /v1/chat/completions
 * are forced to use `provider`, ignoring any provider prefix in the model name.
 */
export function startProviderServer(provider: string, port: number) {
  return Bun.serve({
    port,
    idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
    routes: {
      "/health": {
        GET: () => jsonResponse({ status: "ok", provider, port }),
      },
      "/v1/models": {
        GET: () => {
          const models = getModelsForProvider(provider);
          const freeOnly = getSetting(`provider_free_only_${provider}`) === "true";
          const data = models
            .filter((m) => (freeOnly ? m.is_free : true))
            .map((m) => ({ id: m.id, object: "model", created: 1720000000, owned_by: provider }));
          return jsonResponse({ object: "list", data });
        },
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
      "/v1/chat/completions": {
        POST: (req: Request) => handleChatCompletions(req, provider),
        OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      },
    },
    fetch(req) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
      return jsonResponse({ error: { message: "Not found", type: "grouter_error", code: 404 } }, 404);
    },
  });
}

// Track which providers already have a running dedicated server
const _runningProviderServers = new Set<string>();

/**
 * Start a provider server only if one isn't already running.
 * Safe to call at any time â€” e.g. right after a new connection is added.
 */
export function ensureProviderServer(provider: string): void {
  if (_runningProviderServers.has(provider)) return;
  const port = getProviderPort(provider);
  if (!port) return;
  try {
    startProviderServer(provider, port);
    _runningProviderServers.add(provider);
  } catch (err) {
    console.error(`  ${chalk.yellow("âš ")} Failed to bind ${provider} on :${port} â€” ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Starts the main server plus one dedicated listener per configured provider port. */
export function startAllServers(mainPort: number) {
  const main = startServer(mainPort);
  const providerServers = [] as Array<{ provider: string; port: number }>;
  for (const row of listProviderPorts()) {
    try {
      startProviderServer(row.provider, row.port);
      _runningProviderServers.add(row.provider);
      providerServers.push({ provider: row.provider, port: row.port });
    } catch (err) {
      console.error(`  ${chalk.yellow("âš ")} Failed to bind ${row.provider} on :${row.port} â€” ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { main, providerServers };
}

async function handleChatCompletions(req: Request, pinnedProvider?: string): Promise<Response> {
  const start = Date.now();
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { logReq("POST", "/v1/chat/completions", 400, Date.now() - start); return jsonResponse({ error: { message: "Invalid JSON body" } }, 400); }

  const authHeader = req.headers.get("Authorization");
  const requireAuth = getSetting("require_client_auth") === "true";
  let clientKey = null;

  if (authHeader?.startsWith("Bearer ")) {
    clientKey = getClientKey(authHeader.slice(7).trim());
  }

  if (requireAuth && !clientKey) {
    logReq("POST", "/v1/chat/completions", 401, Date.now() - start);
    return jsonResponse({ error: { message: "Unauthorized. Invalid or missing Client API Key.", type: "invalid_request_error", code: 401 } }, 401);
  }

  const rawModel = typeof body.model === "string" ? body.model : null;
  const { provider, model } = parseProviderModel(rawModel, pinnedProvider);

  if (!provider) {
    logReq("POST", "/v1/chat/completions", 400, Date.now() - start, { model: rawModel });
    return jsonResponse({
      error: {
        message: `Invalid model format: "${rawModel ?? ""}". Use "provider/model" (e.g. "anthropic/claude-sonnet-4-20250514") or send the request to a provider-specific port.`,
        type: "grouter_error",
        code: 400,
      },
    }, 400);
  }

  const stream = body.stream === true;
  const excludeIds = new Set<string>();
  let rotations = 0;

  // Normalise model in body â€” strip provider prefix before sending upstream
  const normalizedBody = { ...body, model };

  let lastFetchError: { provider: string; url: string; message: string } | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const selected = selectAccount(provider, model || null, excludeIds);

    if (!selected) {
      logReq("POST", "/v1/chat/completions", 503, Date.now() - start, { model: rawModel });
      return jsonResponse({ error: { message: `No connections available for provider "${provider}"`, type: "grouter_error", code: 503 } }, 503);
    }
    if (isRateLimitedResult(selected)) {
      logReq("POST", "/v1/chat/completions", 429, Date.now() - start, { model: rawModel, rotated: rotations });
      return jsonResponse(
        { error: { message: `All accounts rate limited. ${selected.retryAfterHuman}`, type: "grouter_error", code: 429 } },
        429, { "Retry-After": selected.retryAfter },
      );
    }
    if (isTemporarilyUnavailableResult(selected)) {
      logReq("POST", "/v1/chat/completions", 503, Date.now() - start, { model: rawModel, rotated: rotations });
      return jsonResponse(
        { error: { message: `All accounts temporarily unavailable. ${selected.retryAfterHuman}`, type: "grouter_error", code: 503 } },
        503, { "Retry-After": selected.retryAfter },
      );
    }

    const label = selected.email?.split("@")[0] ?? selected.display_name ?? selected.id.slice(0, 8);

    // â”€â”€ Build upstream request via per-provider dispatcher â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const account = selected.auth_type === "oauth"
      ? await checkAndRefreshAccount(selected)
      : selected;

    const dispatch = buildUpstream({ account, body: normalizedBody, stream });
    if (dispatch.kind === "unsupported") {
      logReq("POST", "/v1/chat/completions", 501, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
      return jsonResponse({
        error: {
          message: dispatch.reason,
          type:    "provider_not_supported",
          code:    501,
          provider,
        },
      }, 501);
    }
    const upstreamUrl     = dispatch.req.url;
    const upstreamHeaders = dispatch.req.headers;
    const upstreamBody    = dispatch.req.body;

    // Apply proxy pool if assigned to this connection
    const proxyPool = selected.proxy_pool_id ? getProxyPoolById(selected.proxy_pool_id) : null;
    const fetchOptions: Record<string, unknown> = {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
    };
    if (proxyPool?.proxy_url) {
      // @ts-ignore â€” Bun-specific proxy option
      fetchOptions.proxy = proxyPool.proxy_url;
    }

    let upstreamResp: Response;
    try {
      upstreamResp = await fetch(upstreamUrl, fetchOptions as RequestInit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastFetchError = { provider, url: upstreamUrl, message: msg };
      console.log(`  ${chalk.red("âœ–")} fetch failed â†’ ${chalk.cyan(label)} ${chalk.gray(upstreamUrl)} ${chalk.red(msg)}`);
      excludeIds.add(selected.id); rotations++;
      markAccountUnavailable(selected.id, 503, msg, model || null);
      continue;
    }

    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      const { shouldFallback } = markAccountUnavailable(selected.id, upstreamResp.status, errText, model || null);
      if (shouldFallback && attempt < MAX_RETRIES - 1) {
        console.log(`  ${chalk.yellow("â†»")} rotating away from ${chalk.cyan(label)} (${upstreamResp.status})`);
        excludeIds.add(selected.id); rotations++;
        continue;
      }
      logReq("POST", "/v1/chat/completions", upstreamResp.status, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
      const ct = upstreamResp.headers.get("content-type") ?? "";
      if (ct.includes("json")) { try { return jsonResponse(JSON.parse(errText), upstreamResp.status); } catch {/* fall */} }
      return new Response(errText, { status: upstreamResp.status, headers: { "Content-Type": ct || "text/plain", ...corsHeaders() } });
    }

    clearAccountError(selected.id, model || null);

    if (stream) {
      const ms = Date.now() - start;
      const dec = new TextDecoder();
      const enc = new TextEncoder();
      const fmt = dispatch.format;
      const needsTranslation = fmt === "claude" || fmt === "gemini" || fmt === "codex";
      const claudeState = fmt === "claude" ? newClaudeStreamState() : null;
      const geminiState = fmt === "gemini" ? newGeminiStreamState() : null;
      const codexState = fmt === "codex" ? newCodexStreamState() : null;
      let tail = "";
      let lineBuf = "";
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          if (!needsTranslation) {
            ctrl.enqueue(chunk);
            tail += dec.decode(chunk, { stream: true });
            if (tail.length > 4096) tail = tail.slice(-4096);
          } else {
            lineBuf += dec.decode(chunk, { stream: true });
            const lines = lineBuf.split("\n");
            lineBuf = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              const translated = claudeState
                ? claudeChunkToOpenAI(trimmed, claudeState)
                : geminiState
                  ? geminiChunkToOpenAI(trimmed, geminiState)
                  : codexChunkToOpenAI(trimmed, codexState!);
              for (const out of translated) {
                ctrl.enqueue(enc.encode(out));
                tail += out;
              }
            }
            if (tail.length > 4096) tail = tail.slice(-4096);
          }
        },
        flush() {
          const stateUsage = claudeState?.usage ?? geminiState?.usage ?? null;
          const usage = needsTranslation && stateUsage
            ? { prompt: (stateUsage.prompt_tokens as number) ?? 0, completion: (stateUsage.completion_tokens as number) ?? 0, total: (stateUsage.total_tokens as number) ?? 0 }
            : extractUsageFromSSE(tail);
          logReq("POST", "/v1/chat/completions", 200, ms, { model: rawModel, account: label, rotated: rotations, tokens: usage?.total || undefined });
          if (usage) {
            recordUsage({ account_id: selected.id, model: rawModel ?? "", prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.total });
            if (clientKey) updateClientKeyUsage(clientKey.api_key, usage.total);
          }
        },
      });
      upstreamResp.body!.pipeTo(writable).catch(() => {});
      return new Response(readable, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no", ...corsHeaders() },
      });
    }

    let data = (await upstreamResp.json()) as Record<string, unknown>;

    // Translate non-stream responses â†’ OpenAI format
    if (dispatch.format === "claude") data = translateClaudeNonStream(data);
    else if (dispatch.format === "gemini") data = translateGeminiNonStream(data);
    else if (dispatch.format === "codex") data = translateCodexNonStream(data);

    const rawUsage = data["usage"] as Record<string, number> | undefined;
    const promptTok     = rawUsage?.prompt_tokens     ?? 0;
    const completionTok = rawUsage?.completion_tokens ?? 0;
    const totalTok      = rawUsage?.total_tokens      ?? (promptTok + completionTok);
    if (totalTok > 0) {
      recordUsage({ account_id: selected.id, model: rawModel ?? "", prompt_tokens: promptTok, completion_tokens: completionTok, total_tokens: totalTok });
      if (clientKey) updateClientKeyUsage(clientKey.api_key, totalTok);
    }
    logReq("POST", "/v1/chat/completions", 200, Date.now() - start, { model: rawModel, account: label, rotated: rotations, tokens: totalTok || undefined });
    return jsonResponse(data);
  }

  logReq("POST", "/v1/chat/completions", 502, Date.now() - start, { model: rawModel, rotated: rotations });
  if (lastFetchError) {
    return jsonResponse({
      error: {
        message:  `Upstream fetch failed for ${lastFetchError.provider} (${lastFetchError.url}): ${lastFetchError.message}`,
        type:     "upstream_unreachable",
        code:     502,
        provider: lastFetchError.provider,
      },
    }, 502);
  }
  return jsonResponse({ error: { message: "All retry attempts exhausted", type: "grouter_error", code: 503 } }, 503);
}
