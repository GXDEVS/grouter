import chalk from "chalk";
import { gunzipSync } from "node:zlib";
import { listAccounts } from "../db/accounts.ts";
import { getSetting } from "../db/index.ts";
import { getProviderPort, listProviderPorts } from "../db/ports.ts";
import { getModelsForProvider } from "../providers/model-fetcher.ts";
import { CURRENT_VERSION, fetchAndCacheVersion } from "../update/checker.ts";
import {
  handleAccountRemove,
  handleAccountToggle,
  handleAddConnection,
  handleAuthAuthorize,
  handleAuthCallback,
  handleAuthImport,
  handleAuthPoll,
  handleAuthStart,
  handleCreateClientKey,
  handleCreateCustomProvider,
  handleCreateProxyPool,
  handleDeleteClientKey,
  handleDeleteProxyPool,
  handleGetConfig,
  handleGetProviderConnections,
  handleGetProviderModels,
  handleGetProviders,
  handleListClientKeys,
  handleListProxyPools,
  handleProviderConfig,
  handleProxyStop,
  handleRefreshProviderModels,
  handleRefreshProviderModelsBatch,
  handleSetConfig,
  handleSetupDone,
  handleSetupStatus,
  handleStatus,
  handleTestProxyPool,
  handleUnlockAll,
  handleUpdateClientKey,
  handleUpdateConnection,
  handleUpdateProxyPool,
} from "../web/api.ts";
import { serveLogo } from "../web/logos.ts";
import {
  ANIMATION_GZIP_B64,
  ANIMATION_GZIP_LENGTH,
  ANIMATION_RAW_LENGTH,
  ANIMATION_RAW_SHA1,
} from "../public/animation-embedded.ts";
import { handleChatCompletions } from "./chat-handler.ts";
import { clearModelsCache, fetchModels } from "./models.ts";
import { DISABLED_PROVIDER_IDS, SERVER_IDLE_TIMEOUT_SECONDS, corsHeaders, jsonResponse } from "./server-helpers.ts";
import type { BunRequest } from "./server-helpers.ts";

// HTML pages embedded at build time.
// @ts-ignore
import DASHBOARD_HTML from "../web/dashboard.html" with { type: "text" };
// @ts-ignore
import WIZARD_HTML from "../web/wizard.html" with { type: "text" };

function serveWizard(): Response {
  return new Response(WIZARD_HTML as unknown as string, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function serveDashboard(): Response {
  return new Response(DASHBOARD_HTML as unknown as string, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const ANIMATION_GZIP_BYTES = Buffer.from(ANIMATION_GZIP_B64, "base64");
const ANIMATION_BYTES = gunzipSync(ANIMATION_GZIP_BYTES);
const ANIMATION_ETAG = `"${ANIMATION_RAW_SHA1}"`;
if (ANIMATION_GZIP_BYTES.length !== ANIMATION_GZIP_LENGTH) {
  throw new Error("Invalid embedded animation gzip payload length");
}
if (ANIMATION_BYTES.length !== ANIMATION_RAW_LENGTH) {
  throw new Error("Invalid embedded animation raw payload length");
}

function hasMatchingEtag(req: Request, etag: string): boolean {
  const ifNoneMatch = req.headers.get("if-none-match");
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((part) => part.trim())
    .some((candidate) => candidate === etag || candidate === "*");
}

function serveAnimation(req: Request): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=86400",
    ETag: ANIMATION_ETAG,
    Vary: "Accept-Encoding",
  };
  if (hasMatchingEtag(req, ANIMATION_ETAG)) {
    return new Response(null, { status: 304, headers });
  }
  const acceptEncoding = req.headers.get("accept-encoding") ?? "";
  if (acceptEncoding.includes("gzip")) {
    return new Response(ANIMATION_GZIP_BYTES, {
      headers: { ...headers, "Content-Encoding": "gzip" },
    });
  }
  return new Response(ANIMATION_BYTES, { headers });
}

function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export { clearModelsCache };

export function startServer(port: number) {
  return Bun.serve({
    port,
    idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
    routes: {
      // Dashboard.
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
        GET: (req: Request) => serveAnimation(req),
      },
      "/public/logos/:file": {
        GET: (req: BunRequest) => serveLogo(req.params.file!, req),
      },
      "/dashboard": { GET: () => serveDashboard() },

      // Dashboard API.
      "/api/status": { GET: () => handleStatus() },
      "/api/auth/start": { POST: (req: Request) => handleAuthStart(req) },
      "/api/auth/poll": { POST: (req: Request) => handleAuthPoll(req) },
      "/api/auth/authorize": { POST: (req: Request) => handleAuthAuthorize(req) },
      "/api/auth/callback": { GET: (req: Request) => handleAuthCallback(req) },
      "/api/auth/import": { POST: (req: Request) => handleAuthImport(req) },
      "/api/accounts/:id/toggle": { POST: (req: BunRequest) => handleAccountToggle(req.params.id!) },
      "/api/accounts/:id": { DELETE: (req: BunRequest) => handleAccountRemove(req.params.id!) },
      "/api/setup-status": { GET: () => handleSetupStatus() },
      "/api/setup-done": { POST: () => handleSetupDone() },
      "/api/client-keys": {
        GET: () => handleListClientKeys(),
        POST: (req: Request) => handleCreateClientKey(req),
      },
      "/api/client-keys/:key": {
        PATCH: (req: BunRequest) => handleUpdateClientKey(req, req.params.key!),
        DELETE: (req: BunRequest) => handleDeleteClientKey(req.params.key!),
      },
      "/api/config": {
        GET: () => handleGetConfig(),
        POST: (req: Request) => handleSetConfig(req),
      },
      "/api/unlock": { POST: () => handleUnlockAll() },
      "/api/providers": { GET: () => handleGetProviders() },
      "/api/providers/custom": { POST: (req: Request) => handleCreateCustomProvider(req) },
      "/api/providers/:id/connections": { GET: (req: BunRequest) => handleGetProviderConnections(req.params.id!) },
      "/api/providers/:id/models": { GET: (req: BunRequest) => handleGetProviderModels(req.params.id!) },
      "/api/providers/:id/refresh-models": { POST: (req: BunRequest) => handleRefreshProviderModels(req.params.id!) },
      "/api/providers/refresh-models": { POST: (req: Request) => handleRefreshProviderModelsBatch(req) },
      "/api/providers/:id/config": { POST: (req: BunRequest) => handleProviderConfig(req.params.id!, req) },
      "/api/providers/:id/wake": {
        POST: (req: BunRequest) => {
          const id = req.params.id!;
          if (DISABLED_PROVIDER_IDS.has(id)) {
            return jsonResponse({
              error: `${id} is disabled in this build.`,
              provider: id,
            }, 410);
          }
          ensureProviderServer(id);
          const providerPort = getProviderPort(id);
          return jsonResponse({ ok: true, provider: id, port: providerPort });
        },
      },
      "/api/connections": { POST: (req: Request) => handleAddConnection(req) },
      "/api/proxy-pools": {
        GET: () => handleListProxyPools(),
        POST: (req: Request) => handleCreateProxyPool(req),
      },
      "/api/proxy-pools/:id": {
        PATCH: (req: BunRequest) => handleUpdateProxyPool(req.params.id!, req),
        DELETE: (req: BunRequest) => handleDeleteProxyPool(req.params.id!),
      },
      "/api/proxy-pools/:id/test": { POST: (req: BunRequest) => handleTestProxyPool(req.params.id!) },
      "/api/connections/:id": { PATCH: (req: BunRequest) => handleUpdateConnection(req.params.id!, req) },
      "/api/proxy/stop": { POST: () => handleProxyStop() },

      // Proxy API.
      "/health": {
        GET: async () => {
          const accounts = listAccounts();
          const active = accounts.filter((account) => account.is_active && account.test_status !== "unavailable").length;
          return jsonResponse({ status: "ok", accounts: accounts.length, active });
        },
      },
      "/v1/models": {
        GET: async (req: Request) => jsonResponse({ object: "list", data: await fetchModels(req) }),
      },
      "/api/version": {
        GET: async () => {
          const remote = await fetchAndCacheVersion();
          return jsonResponse({ current: CURRENT_VERSION, latest: remote ?? CURRENT_VERSION });
        },
      },
      "/v1/chat/completions": {
        POST: (req: Request) => handleChatCompletions(req),
      },
    },
    fetch(req) {
      if (req.method === "OPTIONS") return preflight();
      return jsonResponse({ error: { message: "Not found", type: "grouter_error", code: 404 } }, 404);
    },
  });
}

/**
 * Start a provider-pinned server on `port`. Requests to /v1/chat/completions
 * are forced to use `provider`, ignoring any provider prefix in the model name.
 */
export function startProviderServer(provider: string, port: number) {
  if (DISABLED_PROVIDER_IDS.has(provider)) {
    throw new Error(`provider ${provider} is disabled`);
  }
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
            .filter((model) => (freeOnly ? model.is_free : true))
            .map((model) => ({ id: model.id, object: "model", created: 1720000000, owned_by: provider }));
          return jsonResponse({ object: "list", data });
        },
      },
      "/v1/chat/completions": {
        POST: (req: Request) => handleChatCompletions(req, provider),
      },
    },
    fetch(req) {
      if (req.method === "OPTIONS") return preflight();
      return jsonResponse({ error: { message: "Not found", type: "grouter_error", code: 404 } }, 404);
    },
  });
}

// Track which providers already have a running dedicated server.
const runningProviderServers = new Set<string>();

/**
 * Start a provider server only if one isn't already running.
 * Safe to call at any time, e.g. right after a new connection is added.
 */
export function ensureProviderServer(provider: string): void {
  if (DISABLED_PROVIDER_IDS.has(provider)) return;
  if (runningProviderServers.has(provider)) return;
  const port = getProviderPort(provider);
  if (!port) return;
  try {
    startProviderServer(provider, port);
    runningProviderServers.add(provider);
  } catch (err) {
    console.error(`  ${chalk.yellow("WARN")} Failed to bind ${provider} on :${port} - ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Starts the main server plus one dedicated listener per configured provider port. */
export function startAllServers(mainPort: number) {
  const main = startServer(mainPort);
  const providerServers = [] as Array<{ provider: string; port: number }>;
  for (const row of listProviderPorts()) {
    if (DISABLED_PROVIDER_IDS.has(row.provider)) continue;
    try {
      startProviderServer(row.provider, row.port);
      runningProviderServers.add(row.provider);
      providerServers.push({ provider: row.provider, port: row.port });
    } catch (err) {
      console.error(`  ${chalk.yellow("WARN")} Failed to bind ${row.provider} on :${row.port} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { main, providerServers };
}

