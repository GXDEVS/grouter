import chalk from "chalk";
import { buildQwenHeaders, buildQwenUrl, buildQwenModelsUrl, QWEN_MODELS_OAUTH, QWEN_SYSTEM_MSG } from "../constants.ts";
import { buildUpstream } from "./upstream.ts";
import { claudeChunkToOpenAI, newClaudeStreamState, translateClaudeNonStream } from "./claude-translator.ts";
import { codexChunkToOpenAI, newCodexStreamState, translateCodexNonStream } from "./codex-translator.ts";
import { geminiChunkToOpenAI, newGeminiStreamState, translateGeminiNonStream } from "./gemini-translator.ts";
import { getSetting } from "../db/index.ts";
import { CURRENT_VERSION, fetchAndCacheVersion } from "../update/checker.ts";
import { selectAccount, markAccountUnavailable, clearAccountError } from "../rotator/index.ts";
import { clearModelLocks } from "../rotator/lock.ts";
import { checkAndRefreshAccount } from "../token/refresh.ts";
import { getAdapter } from "../auth/providers/index.ts";
import { isRateLimitedResult, isTemporarilyUnavailableResult, type Connection } from "../types.ts";
import { listAccounts, updateAccount } from "../db/accounts.ts";
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
const DISABLED_PROVIDER_IDS = new Set<string>();
const UPSTREAM_FIRST_BYTE_TIMEOUT_MS = 20_000;
const UPSTREAM_STREAM_IDLE_TIMEOUT_MS = 45_000;
const UPSTREAM_REQUEST_TOTAL_TIMEOUT_MS = 120_000;

type UpstreamTimeoutCategory = "first_byte_timeout" | "stream_idle_timeout" | "request_total_timeout";
type UpstreamAbortReason = UpstreamTimeoutCategory | "client_cancelled";

function timeoutCategoryMessage(category: UpstreamTimeoutCategory): string {
  if (category === "first_byte_timeout") return "No upstream data received before first-byte deadline.";
  if (category === "stream_idle_timeout") return "Upstream stream stalled past idle deadline.";
  return "Upstream request exceeded total deadline.";
}

function streamHasDoneFrame(tail: string): boolean {
  return /data:\s*\[DONE\]/.test(tail);
}

function logUpstreamTimeout(meta: {
  category: UpstreamTimeoutCategory;
  provider: string;
  account: string;
  model: string | null;
  attempt: number;
}): void {
  const model = meta.model || "-";
  console.log(
    `  ${chalk.red("✖")} upstream timeout ${chalk.yellow(meta.category)} provider=${chalk.cyan(meta.provider)} account=${chalk.cyan(meta.account)} model=${chalk.magenta(model)} attempt=${meta.attempt}/${MAX_RETRIES}`,
  );
}

function upstreamTimeoutResponse(provider: string, category: UpstreamTimeoutCategory, model: string | null): Response {
  return jsonResponse({
    error: {
      message: `${timeoutCategoryMessage(category)} (${provider})`,
      type: "upstream_timeout",
      code: 504,
      provider,
      timeout_category: category,
      model,
    },
  }, 504);
}

// â”€â”€ Model cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let modelsCache: { data: unknown[]; at: number } | null = null;
const MODELS_TTL = 10 * 60 * 1000;

/**
 * Aggregate models from ALL providers that have active connections.
 * Each model is prefixed: "provider/model-id".
 * Uses DB-stored models when available, otherwise falls back to registry.
 */
async function fetchModels(req?: Request) {
  if ((globalThis as any).__grouterClearModelsCache) {
    modelsCache = null;
    (globalThis as any).__grouterClearModelsCache = false;
  }
  
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

function detectPinnedProviderPrefixMismatch(
  rawModel: string | null,
  pinnedProvider?: string,
): { requestedProvider: string; strippedModel: string } | null {
  if (!pinnedProvider || !rawModel) return null;
  const trimmed = rawModel.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return null;
  const requestedProvider = trimmed.slice(0, slash).toLowerCase();
  const strippedModel = trimmed.slice(slash + 1);
  if (
    requestedProvider &&
    requestedProvider !== pinnedProvider.toLowerCase() &&
    Object.prototype.hasOwnProperty.call(PROVIDERS, requestedProvider)
  ) {
    const pinnedModels = getModelsForProvider(pinnedProvider);
    if (pinnedModels.length > 0) {
      const normalizedRaw = trimmed.toLowerCase();
      const normalizedStripped = strippedModel.toLowerCase();
      // Avoid false positives on provider-pinned ports where the same token is
      // a model namespace (e.g. "Qwen/...") rather than a provider prefix.
      const rawMatchesPinned = pinnedModels.some((m) => m.id.toLowerCase() === normalizedRaw);
      const strippedMatchesPinned = pinnedModels.some((m) => m.id.toLowerCase() === normalizedStripped);
      const namespaceUsedByPinned = pinnedModels.some((m) => m.id.toLowerCase().startsWith(`${requestedProvider}/`));
      if (rawMatchesPinned || strippedMatchesPinned || namespaceUsedByPinned) {
        return null;
      }
    }
    return {
      requestedProvider,
      strippedModel,
    };
  }
  return null;
}

const GEMINI_MODEL_FALLBACKS: Record<string, string[]> = {
  "gemini-3.1-pro-preview": ["gemini-2.5-pro", "gemini-2.5-flash"],
  "gemini-3.1-flash-preview": ["gemini-2.5-flash", "gemini-2.5-pro"],
  "gemini-2.5-pro": ["gemini-2.5-flash"],
};

function isGeminiModelCapacityError(provider: string, status: number, errorText: string): boolean {
  if (provider !== "gemini-cli" || (status !== 429 && status !== 503)) return false;
  const lower = errorText.toLowerCase();
  return (
    lower.includes("reason\":\"model_capacity_exhausted") ||
    lower.includes("model_capacity_exhausted") ||
    lower.includes("no capacity available for model") ||
    lower.includes("resource_exhausted")
  );
}

function nextGeminiFallbackModel(currentModel: string, tried: Set<string>): string | null {
  const candidates = GEMINI_MODEL_FALLBACKS[currentModel] ?? ["gemini-2.5-pro", "gemini-2.5-flash"];
  for (const candidate of candidates) {
    if (candidate !== currentModel && !tried.has(candidate)) return candidate;
  }
  return null;
}

function isLargeRequestError(status: number, errorText: string): boolean {
  if (status !== 400 && status !== 413 && status !== 422) return false;
  const lower = errorText.toLowerCase();
  return (
    lower.includes("request too large") ||
    lower.includes("payload too large") ||
    lower.includes("prompt is too long") ||
    lower.includes("context length") ||
    lower.includes("context window") ||
    lower.includes("too many input tokens") ||
    lower.includes("max 20mb") ||
    (lower.includes("tokens per minute") && lower.includes("requested")) ||
    lower.includes("\"type\":\"tokens\"")
  );
}

function trimLargeRequestFields(body: Record<string, unknown>): { body: Record<string, unknown>; removed: string[] } {
  const out: Record<string, unknown> = { ...body };
  const removed: string[] = [];
  const drop = (key: string) => {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      delete out[key];
      removed.push(key);
    }
  };
  drop("tools");
  drop("tool_choice");
  drop("parallel_tool_calls");
  drop("response_format");
  drop("metadata");
  drop("store");
  drop("logprobs");
  drop("top_logprobs");
  return { body: out, removed };
}

function compactLargeRequestContent(content: unknown, maxChars = 6_000): unknown {
  if (typeof content === "string") {
    return content.length > maxChars ? content.slice(-maxChars) : content;
  }
  if (!Array.isArray(content)) return content;
  const compacted = content
    .filter((item) => item && typeof item === "object" && ((item as Record<string, unknown>).type === "text" || !("type" in (item as Record<string, unknown>))))
    .map((item) => {
      if (!item || typeof item !== "object") return item;
      const rec = { ...(item as Record<string, unknown>) };
      if (typeof rec.text === "string" && rec.text.length > maxChars) {
        rec.text = rec.text.slice(-maxChars);
      }
      return rec;
    });
  return compacted.length > 0 ? compacted : content;
}

function compactLargeRequestMessages(body: Record<string, unknown>): { body: Record<string, unknown>; changed: boolean } {
  const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : null;
  if (!messages || messages.length === 0) return { body, changed: false };

  const sanitized = messages.map((msg) => {
    const rec: Record<string, unknown> = { ...msg };
    delete rec.tool_calls;
    delete rec.function_call;
    delete rec.audio;
    rec.content = compactLargeRequestContent(rec.content);
    return rec;
  });

  const systemLike = sanitized.filter((m) => {
    const role = typeof m.role === "string" ? m.role : "";
    return role === "system" || role === "developer";
  });
  const tail = sanitized.slice(-8);
  const lastUser = [...sanitized].reverse().find((m) => m.role === "user") ?? null;

  const selected: Array<Record<string, unknown>> = [];
  if (systemLike.length > 0) selected.push(systemLike[systemLike.length - 1]!);
  for (const m of tail) selected.push(m);
  if (lastUser && !selected.includes(lastUser)) selected.push(lastUser);

  const deduped: Array<Record<string, unknown>> = [];
  const seen = new Set<Record<string, unknown>>();
  for (const m of selected) {
    if (seen.has(m)) continue;
    seen.add(m);
    deduped.push(m);
  }

  const reduced = deduped.length > 0 ? deduped : sanitized.slice(-2);
  const out: Record<string, unknown> = { ...body, messages: reduced };
  // Reduce completion target to leave room for prompt on strict TPM tiers.
  if (typeof out.max_tokens !== "number" && typeof out.max_completion_tokens !== "number") {
    out.max_tokens = 512;
  }
  return { body: out, changed: true };
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

function injectSystemMsg(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return { ...body, messages: [QWEN_SYSTEM_MSG, ...messages] };
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

function hasTerminalDoneFrame(tail: string): boolean {
  return /(^|\r?\n)data:\s*\[DONE\]\s*(\r?\n|$)/m.test(tail);
}

function parseProviderData(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { return null; }
}

async function forceRefreshOAuthAccount(account: Connection): Promise<Connection | null> {
  if (account.auth_type !== "oauth") return null;
  const adapter = getAdapter(account.provider);
  if (!adapter?.refresh) return null;

  const providerData = parseProviderData(account.provider_data);
  const refreshed = await adapter.refresh({
    refreshToken: account.refresh_token || null,
    providerData,
  });
  if (!refreshed) return null;

  const patch: Partial<Connection> = {
    access_token: refreshed.accessToken,
    refresh_token: refreshed.refreshToken ?? account.refresh_token,
    expires_at: refreshed.expiresAt,
  };
  if (refreshed.resourceUrl) patch.resource_url = refreshed.resourceUrl;
  if (refreshed.apiKey !== undefined) patch.api_key = refreshed.apiKey;
  if (refreshed.providerData) {
    const merged = { ...(providerData ?? {}), ...refreshed.providerData };
    patch.provider_data = JSON.stringify(merged);
  }

  updateAccount(account.id, patch);
  return { ...account, ...patch };
}

function isCodexTokenRevokedError(lastError: string | null): boolean {
  if (!lastError) return false;
  const lower = lastError.toLowerCase();
  return lower.includes("token_revoked") || lower.includes("invalidated oauth token");
}

function clearStaleCodexTokenRevokedState(): number {
  const all = listAccounts();
  const stale = all.filter((a) =>
    a.provider === "codex" &&
    a.is_active === 1 &&
    a.error_code === 401 &&
    isCodexTokenRevokedError(a.last_error),
  );
  if (stale.length === 0) return 0;

  for (const acc of stale) {
    clearModelLocks(acc.id);
    updateAccount(acc.id, {
      test_status: "active",
      last_error: null,
      error_code: null,
      last_error_at: null,
      backoff_level: 0,
    });
  }
  return stale.length;
}

function toAbortError(reason: unknown, fallback = "The operation was aborted."): Error {
  if (reason instanceof Error) return reason;
  return new DOMException(fallback, "AbortError");
}

function isAbortErrorLike(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === "AbortError";
  return err instanceof Error && (err.name === "AbortError" || err.message.toLowerCase().includes("abort"));
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
          if (DISABLED_PROVIDER_IDS.has(id)) {
            return jsonResponse({
              error: `${id} is disabled in this build. Reconfigure OpenClaude to another provider/port.`,
              provider: id,
            }, 410);
          }
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
  if (DISABLED_PROVIDER_IDS.has(provider)) return;
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
    if (DISABLED_PROVIDER_IDS.has(row.provider)) {
      continue;
    }
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
  const pinnedPrefixMismatch = detectPinnedProviderPrefixMismatch(rawModel, pinnedProvider);

  if (pinnedPrefixMismatch) {
    logReq("POST", "/v1/chat/completions", 400, Date.now() - start, { model: rawModel });
    return jsonResponse({
      error: {
        message:
          `This endpoint is pinned to provider "${pinnedProvider}". ` +
          `Received model "${rawModel}" for provider "${pinnedPrefixMismatch.requestedProvider}". ` +
          `Use "${pinnedPrefixMismatch.strippedModel}" on this port or send the request to the "${pinnedPrefixMismatch.requestedProvider}" provider port.`,
        type: "grouter_error",
        code: 400,
      },
    }, 400);
  }

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
  if (DISABLED_PROVIDER_IDS.has(provider)) {
    logReq("POST", "/v1/chat/completions", 410, Date.now() - start, { model: rawModel });
    return jsonResponse({
      error: {
        message: `Provider "${provider}" is disabled in this build. Please switch to another provider (e.g. sambanova on port 3108).`,
        type: "grouter_error",
        code: 410,
      },
    }, 410);
  }

  const stream = body.stream === true;
  const excludeIds = new Set<string>();
  let rotations = 0;
  let currentModel = model;
  let requestBodyBase: Record<string, unknown> = body;
  let usedGroqTrimRetry = false;
  let usedGroqContextRetry = false;
  let usedCodex401AccountHeaderRetry = false;
  let usedCodex401ForcedRefreshRetry = false;
  let usedCodexHighModelFallback = false;
  const triedGeminiModels = new Set<string>();
  if (provider === "gemini-cli" && currentModel) {
    triedGeminiModels.add(currentModel);
  }

  let lastFetchError: { provider: string; url: string; message: string } | null = null;
  let lastTimeoutError: { category: UpstreamTimeoutCategory; model: string | null } | null = null;

  const tryGeminiModelFallback = (reason: string): boolean => {
    if (provider !== "gemini-cli" || !currentModel) return false;
    const fallbackModel = nextGeminiFallbackModel(currentModel, triedGeminiModels);
    if (!fallbackModel) return false;
    console.log(
      `  ${chalk.yellow("->")} switching Gemini model ${chalk.magenta(currentModel)} -> ${chalk.magenta(fallbackModel)} ${chalk.gray(`(${reason})`)}`,
    );
    triedGeminiModels.add(fallbackModel);
    currentModel = fallbackModel;
    excludeIds.clear();
    return true;
  };
  const emitLastTimeoutResponse = (): Response | null => {
    if (!lastTimeoutError) return null;
    logReq("POST", "/v1/chat/completions", 504, Date.now() - start, { model: rawModel, rotated: rotations });
    return upstreamTimeoutResponse(provider, lastTimeoutError.category, lastTimeoutError.model);
  };

  if (provider === "codex") {
    const cleared = clearStaleCodexTokenRevokedState();
    if (cleared > 0) {
      console.log(`  ${chalk.yellow("->")} cleared ${cleared} stale Codex token_revoked account lock(s)`);
    }
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const selected = selectAccount(provider, currentModel || null, excludeIds);

    if (!selected) {
      // If this attempt excluded prior candidates (rotation), re-check without
      // exclusion so we can surface accurate pool cooldown state (429/503)
      // instead of "no connections".
      if (excludeIds.size > 0) {
        const poolState = selectAccount(provider, currentModel || null);
        if (isRateLimitedResult(poolState)) {
          if (attempt < MAX_RETRIES - 1 && tryGeminiModelFallback("pool rate limited")) {
            continue;
          }
          logReq("POST", "/v1/chat/completions", 429, Date.now() - start, { model: rawModel, rotated: rotations });
          return jsonResponse(
            { error: { message: `All accounts rate limited. ${poolState.retryAfterHuman}`, type: "grouter_error", code: 429 } },
            429, { "Retry-After": poolState.retryAfter },
          );
        }
        if (isTemporarilyUnavailableResult(poolState)) {
          if (attempt < MAX_RETRIES - 1 && tryGeminiModelFallback("pool temporarily unavailable")) {
            continue;
          }
          const timeoutResp = emitLastTimeoutResponse();
          if (timeoutResp) return timeoutResp;
          logReq("POST", "/v1/chat/completions", 503, Date.now() - start, { model: rawModel, rotated: rotations });
          return jsonResponse(
            { error: { message: `All accounts temporarily unavailable. ${poolState.retryAfterHuman}`, type: "grouter_error", code: 503 } },
            503, { "Retry-After": poolState.retryAfter },
          );
        }
      }

      logReq("POST", "/v1/chat/completions", 503, Date.now() - start, { model: rawModel });
      return jsonResponse({ error: { message: `No connections available for provider "${provider}"`, type: "grouter_error", code: 503 } }, 503);
    }
    if (isRateLimitedResult(selected)) {
      if (attempt < MAX_RETRIES - 1 && tryGeminiModelFallback("rate limited")) {
        continue;
      }
      logReq("POST", "/v1/chat/completions", 429, Date.now() - start, { model: rawModel, rotated: rotations });
      return jsonResponse(
        { error: { message: `All accounts rate limited. ${selected.retryAfterHuman}`, type: "grouter_error", code: 429 } },
        429, { "Retry-After": selected.retryAfter },
      );
    }
    if (isTemporarilyUnavailableResult(selected)) {
      if (attempt < MAX_RETRIES - 1 && tryGeminiModelFallback("temporarily unavailable")) {
        continue;
      }
      const timeoutResp = emitLastTimeoutResponse();
      if (timeoutResp) return timeoutResp;
      logReq("POST", "/v1/chat/completions", 503, Date.now() - start, { model: rawModel, rotated: rotations });
      return jsonResponse(
        { error: { message: `All accounts temporarily unavailable. ${selected.retryAfterHuman}`, type: "grouter_error", code: 503 } },
        503, { "Retry-After": selected.retryAfter },
      );
    }

    const label = selected.email?.split("@")[0] ?? selected.display_name ?? selected.id.slice(0, 8);
    const hasAlternativeAccount = (): boolean => {
      const probeExclude = new Set(excludeIds);
      probeExclude.add(selected.id);
      const probe = selectAccount(provider, currentModel || null, probeExclude);
      return !!probe && !isRateLimitedResult(probe) && !isTemporarilyUnavailableResult(probe);
    };

    // Build upstream request via per-provider dispatcher
    const account = selected.auth_type === "oauth"
      ? await checkAndRefreshAccount(selected)
      : selected;

    // Normalize model before sending upstream by removing provider prefix.
    const normalizedBody = { ...requestBodyBase, model: currentModel };
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
    if (provider === "codex" && usedCodex401AccountHeaderRetry) {
      delete upstreamHeaders["ChatGPT-Account-ID"];
    }

    // Apply proxy pool if assigned to this connection
    const proxyPool = selected.proxy_pool_id ? getProxyPoolById(selected.proxy_pool_id) : null;
    const fetchOptions: Record<string, unknown> = {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
    };
    if (proxyPool?.proxy_url) {
      // @ts-ignore - Bun-specific proxy option
      fetchOptions.proxy = proxyPool.proxy_url;
    }

    const abortController = new AbortController();
    let abortReason: UpstreamAbortReason | null = null;
    let requestTotalTimer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => {
        abortReason = abortReason ?? "request_total_timeout";
        abortController.abort();
      },
      UPSTREAM_REQUEST_TOTAL_TIMEOUT_MS,
    );
    const clearRequestTotalTimer = () => {
      if (requestTotalTimer) {
        clearTimeout(requestTotalTimer);
        requestTotalTimer = null;
      }
    };
    const abortForTimeout = (category: UpstreamTimeoutCategory) => {
      if (abortReason) return;
      abortReason = category;
      abortController.abort();
    };
    const abortForClientCancel = () => {
      if (abortReason) return;
      abortReason = "client_cancelled";
      abortController.abort();
    };
    const onTimeoutBeforeClientResponse = (category: UpstreamTimeoutCategory): Response | "retry" => {
      lastTimeoutError = { category, model: currentModel || rawModel };
      logUpstreamTimeout({
        category,
        provider,
        account: label,
        model: currentModel || rawModel,
        attempt: attempt + 1,
      });
      const { shouldFallback } = markAccountUnavailable(selected.id, 503, `upstream timeout (${category})`, currentModel || null);
      if (shouldFallback && attempt < MAX_RETRIES - 1 && hasAlternativeAccount()) {
        console.log(`  ${chalk.yellow("->")} rotating away from ${chalk.cyan(label)} (${category})`);
        excludeIds.add(selected.id);
        rotations++;
        return "retry";
      }
      logReq("POST", "/v1/chat/completions", 504, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
      return upstreamTimeoutResponse(provider, category, currentModel || rawModel);
    };
    const clientSignal = req.signal;
    const removeClientAbortListener = () => {
      if (clientSignal) clientSignal.removeEventListener("abort", abortForClientCancel);
    };
    if (clientSignal) clientSignal.addEventListener("abort", abortForClientCancel, { once: true });

    fetchOptions.signal = abortController.signal;
    let fetchFirstByteTimer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => abortForTimeout("first_byte_timeout"),
      UPSTREAM_FIRST_BYTE_TIMEOUT_MS,
    );
    const clearFetchFirstByteTimer = () => {
      if (fetchFirstByteTimer) {
        clearTimeout(fetchFirstByteTimer);
        fetchFirstByteTimer = null;
      }
    };

    let upstreamResp: Response;
    try {
      upstreamResp = await fetch(upstreamUrl, fetchOptions as RequestInit);
    } catch (err) {
      clearFetchFirstByteTimer();
      clearRequestTotalTimer();
      removeClientAbortListener();
      if (abortReason === "client_cancelled") {
        return new Response(null, { status: 499 });
      }
      if (abortReason && abortReason !== "client_cancelled") {
        const timeoutResult = onTimeoutBeforeClientResponse(abortReason);
        if (timeoutResult === "retry") continue;
        return timeoutResult;
      }
      const msg = err instanceof Error ? err.message : String(err);
      lastFetchError = { provider, url: upstreamUrl, message: msg };
      console.log(`  ${chalk.red("x")} fetch failed -> ${chalk.cyan(label)} ${chalk.gray(upstreamUrl)} ${chalk.red(msg)}`);
      markAccountUnavailable(selected.id, 503, msg, currentModel || null);
      if (attempt < MAX_RETRIES - 1 && hasAlternativeAccount()) {
        excludeIds.add(selected.id);
        rotations++;
        continue;
      }
      logReq("POST", "/v1/chat/completions", 502, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
      return jsonResponse({
        error: {
          message: `Upstream fetch failed for ${provider} (${upstreamUrl}): ${msg}`,
          type: "upstream_unreachable",
          code: 502,
          provider,
        },
      }, 502);
    }
    clearFetchFirstByteTimer();

    if (!upstreamResp.ok) {
      let errText = "";
      try {
        errText = await upstreamResp.text();
      } catch (err) {
        clearRequestTotalTimer();
        removeClientAbortListener();
        if (abortReason === "client_cancelled") {
          return new Response(null, { status: 499 });
        }
        if (abortReason && abortReason !== "client_cancelled") {
          const timeoutResult = onTimeoutBeforeClientResponse(abortReason);
          if (timeoutResult === "retry") continue;
          return timeoutResult;
        }
        const msg = err instanceof Error ? err.message : String(err);
        lastFetchError = { provider, url: upstreamUrl, message: msg };
        console.log(`  ${chalk.red("x")} upstream error body read failed -> ${chalk.cyan(label)} ${chalk.red(msg)}`);
        markAccountUnavailable(selected.id, 503, msg, currentModel || null);
        if (attempt < MAX_RETRIES - 1 && hasAlternativeAccount()) {
          excludeIds.add(selected.id);
          rotations++;
          continue;
        }
        logReq("POST", "/v1/chat/completions", 502, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
        return jsonResponse({
          error: {
            message: `Upstream fetch failed for ${provider} (${upstreamUrl}): ${msg}`,
            type: "upstream_unreachable",
            code: 502,
            provider,
          },
        }, 502);
      }
      clearRequestTotalTimer();

      if (
        provider === "codex" &&
        upstreamResp.status === 400 &&
        !usedCodexHighModelFallback &&
        typeof currentModel === "string" &&
        currentModel.endsWith("-high") &&
        attempt < MAX_RETRIES - 1
      ) {
        const lowerErr = errText.toLowerCase();
        if (
          lowerErr.includes("model") &&
          (lowerErr.includes("not found") || lowerErr.includes("unsupported") || lowerErr.includes("invalid"))
        ) {
          const fallbackModel = currentModel.replace(/-high$/, "");
          if (fallbackModel !== currentModel) {
            usedCodexHighModelFallback = true;
            currentModel = fallbackModel;
            requestBodyBase = { ...requestBodyBase, model: currentModel };
            console.log(
              `  ${chalk.yellow("->")} retrying ${chalk.cyan(label)} with model fallback ${chalk.magenta(currentModel)} after 400`,
            );
            removeClientAbortListener();
            continue;
          }
        }
      }

      if (provider === "codex" && upstreamResp.status === 401) {
        if (
          !usedCodex401AccountHeaderRetry &&
          typeof upstreamHeaders["ChatGPT-Account-ID"] === "string" &&
          upstreamHeaders["ChatGPT-Account-ID"] &&
          attempt < MAX_RETRIES - 1
        ) {
          usedCodex401AccountHeaderRetry = true;
          console.log(`  ${chalk.yellow("->")} retrying ${chalk.cyan(label)} without ChatGPT-Account-ID after 401`);
          removeClientAbortListener();
          continue;
        }

        if (!usedCodex401ForcedRefreshRetry && attempt < MAX_RETRIES - 1) {
          try {
            const refreshed = await forceRefreshOAuthAccount(selected);
            if (refreshed) {
              usedCodex401ForcedRefreshRetry = true;
              console.log(`  ${chalk.yellow("->")} retrying ${chalk.cyan(label)} after forced OAuth refresh (401)`);
              removeClientAbortListener();
              continue;
            }
            console.log(`  ${chalk.yellow("!")} codex forced refresh returned no token for ${chalk.cyan(label)} (401)`);
          } catch (refreshErr) {
            const msg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
            console.log(`  ${chalk.yellow("!")} codex forced refresh failed for ${chalk.cyan(label)}: ${chalk.red(msg)}`);
          }
        }

        // Codex 401 can be token/header drift; avoid long cooldown lock and return actionable status.
        removeClientAbortListener();
        logReq("POST", "/v1/chat/completions", upstreamResp.status, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
        const ct = upstreamResp.headers.get("content-type") ?? "";
        if (ct.includes("json")) { try { return jsonResponse(JSON.parse(errText), upstreamResp.status); } catch {/* fall */} }
        return new Response(errText, { status: upstreamResp.status, headers: { "Content-Type": ct || "text/plain", ...corsHeaders() } });
      }

      if (isLargeRequestError(upstreamResp.status, errText) && !usedGroqTrimRetry && attempt < MAX_RETRIES - 1) {
        const trimmed = trimLargeRequestFields(requestBodyBase);
        if (trimmed.removed.length > 0) {
          usedGroqTrimRetry = true;
          requestBodyBase = trimmed.body;
          console.log(
            `  ${chalk.yellow("->")} retrying ${chalk.cyan(label)} after trimming large fields: ${chalk.gray(trimmed.removed.join(", "))}`,
          );
          removeClientAbortListener();
          continue;
        }
      }
      if (isLargeRequestError(upstreamResp.status, errText) && !usedGroqContextRetry && attempt < MAX_RETRIES - 1) {
        const compacted = compactLargeRequestMessages(requestBodyBase);
        if (compacted.changed) {
          usedGroqContextRetry = true;
          requestBodyBase = compacted.body;
          console.log(
            `  ${chalk.yellow("->")} retrying ${chalk.cyan(label)} after compacting message history for large request limits`,
          );
          removeClientAbortListener();
          continue;
        }
      }
      if (isGeminiModelCapacityError(provider, upstreamResp.status, errText)) {
        if (attempt < MAX_RETRIES - 1 && tryGeminiModelFallback(`capacity exhausted (${upstreamResp.status})`)) {
          removeClientAbortListener();
          continue;
        }
        removeClientAbortListener();
        logReq("POST", "/v1/chat/completions", upstreamResp.status, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
        const ct = upstreamResp.headers.get("content-type") ?? "";
        if (ct.includes("json")) { try { return jsonResponse(JSON.parse(errText), upstreamResp.status); } catch {/* fall */} }
        return new Response(errText, { status: upstreamResp.status, headers: { "Content-Type": ct || "text/plain", ...corsHeaders() } });
      }
      const { shouldFallback } = markAccountUnavailable(selected.id, upstreamResp.status, errText, currentModel || null);
      if (shouldFallback && attempt < MAX_RETRIES - 1 && hasAlternativeAccount()) {
        console.log(`  ${chalk.yellow("->")} rotating away from ${chalk.cyan(label)} (${upstreamResp.status})`);
        excludeIds.add(selected.id); rotations++;
        removeClientAbortListener();
        continue;
      }
      removeClientAbortListener();
      logReq("POST", "/v1/chat/completions", upstreamResp.status, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
      const ct = upstreamResp.headers.get("content-type") ?? "";
      if (ct.includes("json")) { try { return jsonResponse(JSON.parse(errText), upstreamResp.status); } catch {/* fall */} }
      return new Response(errText, { status: upstreamResp.status, headers: { "Content-Type": ct || "text/plain", ...corsHeaders() } });
    }

    clearAccountError(selected.id, currentModel || null);

    if (stream) {
      const ms = Date.now() - start;
      if (!upstreamResp.body) {
        clearRequestTotalTimer();
        const msg = "Upstream returned an empty body for stream request";
        const { shouldFallback } = markAccountUnavailable(selected.id, 503, msg, currentModel || null);
        if (shouldFallback && attempt < MAX_RETRIES - 1 && hasAlternativeAccount()) {
          excludeIds.add(selected.id);
          rotations++;
          removeClientAbortListener();
          continue;
        }
        removeClientAbortListener();
        logReq("POST", "/v1/chat/completions", 502, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
        return jsonResponse({ error: { message: msg, type: "upstream_invalid_response", code: 502 } }, 502);
      }

      const upstreamReader = upstreamResp.body.getReader();
      let firstRead: ReadableStreamReadResult<Uint8Array> = { done: true, value: undefined };
      let streamFirstByteTimer: ReturnType<typeof setTimeout> | null = setTimeout(
        () => abortForTimeout("first_byte_timeout"),
        UPSTREAM_FIRST_BYTE_TIMEOUT_MS,
      );
      const clearStreamFirstByteTimer = () => {
        if (streamFirstByteTimer) {
          clearTimeout(streamFirstByteTimer);
          streamFirstByteTimer = null;
        }
      };
      try {
        firstRead = await upstreamReader.read();
      } catch (err) {
        clearStreamFirstByteTimer();
        clearRequestTotalTimer();
        try { await upstreamReader.cancel(err); } catch {}
        upstreamReader.releaseLock();
        removeClientAbortListener();
        if (abortReason === "client_cancelled") {
          return new Response(null, { status: 499 });
        }
        if (abortReason && abortReason !== "client_cancelled") {
          const timeoutResult = onTimeoutBeforeClientResponse(abortReason);
          if (timeoutResult === "retry") continue;
          return timeoutResult;
        }
        const msg = err instanceof Error ? err.message : String(err);
        lastFetchError = { provider, url: upstreamUrl, message: msg };
        console.log(`  ${chalk.red("x")} stream first-byte read failed -> ${chalk.cyan(label)} ${chalk.red(msg)}`);
        markAccountUnavailable(selected.id, 503, msg, currentModel || null);
        if (attempt < MAX_RETRIES - 1 && hasAlternativeAccount()) {
          excludeIds.add(selected.id);
          rotations++;
          removeClientAbortListener();
          continue;
        }
        removeClientAbortListener();
        logReq("POST", "/v1/chat/completions", 502, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
        return jsonResponse({
          error: {
            message: `Upstream fetch failed for ${provider} (${upstreamUrl}): ${msg}`,
            type: "upstream_unreachable",
            code: 502,
            provider,
          },
        }, 502);
      }
      clearStreamFirstByteTimer();

      const dec = new TextDecoder();
      const enc = new TextEncoder();
      const fmt = dispatch.format;
      const needsTranslation = fmt === "claude" || fmt === "gemini" || fmt === "codex";
      const claudeState = fmt === "claude" ? newClaudeStreamState() : null;
      const geminiState = fmt === "gemini" ? newGeminiStreamState() : null;
      const codexState = fmt === "codex" ? newCodexStreamState() : null;
      let tail = "";
      let lineBuf = "";
      let sseEventLines: string[] = [];
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          if (!needsTranslation) {
            ctrl.enqueue(chunk);
            tail += dec.decode(chunk, { stream: true });
            if (tail.length > 4096) tail = tail.slice(-4096);
          } else {
            const emitTranslatedLines = (payloadLines: string[]) => {
              if (payloadLines.length === 0) return;
              for (const payloadLine of payloadLines) {
                const trimmedPayload = payloadLine.trim();
                if (!trimmedPayload) continue;
                const translated = claudeState
                  ? claudeChunkToOpenAI(trimmedPayload, claudeState)
                  : geminiState
                    ? geminiChunkToOpenAI(trimmedPayload, geminiState)
                    : codexChunkToOpenAI(trimmedPayload, codexState!);
                for (const out of translated) {
                  ctrl.enqueue(enc.encode(out));
                  tail += out;
                }
              }
              if (tail.length > 4096) tail = tail.slice(-4096);
            };

            const processDecoded = (decoded: string) => {
              lineBuf += decoded;
              const lines = lineBuf.split("\n");
              lineBuf = lines.pop() ?? "";
              for (const rawLine of lines) {
                const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
                if (line.startsWith("data:") || line.startsWith("event:") || line.startsWith("id:") || line.startsWith("retry:") || line.startsWith(":")) {
                  sseEventLines.push(line);
                  continue;
                }
                if (line.trim() === "") {
                  if (sseEventLines.length > 0) {
                    emitTranslatedLines(sseEventLines);
                    sseEventLines = [];
                  }
                  continue;
                }
                // Fallback for plain line-delimited JSON streams.
                emitTranslatedLines([line]);
              }
            };

            processDecoded(dec.decode(chunk, { stream: true }));
          }
        },
        flush(ctrl) {
          if (needsTranslation) {
            const remainingDecoded = dec.decode();
            if (remainingDecoded) {
              lineBuf += remainingDecoded;
            }

            const emitTranslatedLines = (payloadLines: string[]) => {
              if (payloadLines.length === 0) return;
              for (const payloadLine of payloadLines) {
                const trimmedPayload = payloadLine.trim();
                if (!trimmedPayload) continue;
                const translated = claudeState
                  ? claudeChunkToOpenAI(trimmedPayload, claudeState)
                  : geminiState
                    ? geminiChunkToOpenAI(trimmedPayload, geminiState)
                    : codexChunkToOpenAI(trimmedPayload, codexState!);
                for (const out of translated) {
                  ctrl.enqueue(enc.encode(out));
                  tail += out;
                }
              }
              if (tail.length > 4096) tail = tail.slice(-4096);
            };

            if (lineBuf.trim()) {
              const trailing = lineBuf.endsWith("\r") ? lineBuf.slice(0, -1) : lineBuf;
              if (trailing.startsWith("data:") || trailing.startsWith("event:") || trailing.startsWith("id:") || trailing.startsWith("retry:") || trailing.startsWith(":")) {
                sseEventLines.push(trailing);
              } else if (trailing.trim() !== "") {
                emitTranslatedLines([trailing]);
              }
            }
            lineBuf = "";

            if (sseEventLines.length > 0) {
              emitTranslatedLines(sseEventLines);
              sseEventLines = [];
            }

            // Some upstreams may terminate the HTTP stream without an explicit
            // terminal SSE frame. Ensure clients always receive a final chunk
            // and [DONE] so they don't hang waiting forever.
            if (claudeState && !claudeState.finishReasonSent) {
              const modelName = claudeState.model || (typeof rawModel === "string" ? rawModel : "claude");
              const finalChunk: Record<string, unknown> = {
                id: `chatcmpl-${claudeState.messageId || Date.now().toString(36)}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: modelName,
                choices: [{ index: 0, delta: {}, finish_reason: claudeState.finishReason ?? "stop" }],
              };
              if (claudeState.usage) finalChunk.usage = claudeState.usage;
              const finalWire = `data: ${JSON.stringify(finalChunk)}\n\n`;
              const doneWire = "data: [DONE]\n\n";
              ctrl.enqueue(enc.encode(finalWire));
              ctrl.enqueue(enc.encode(doneWire));
              tail += finalWire + doneWire;
              claudeState.finishReasonSent = true;
            } else if (geminiState && !geminiState.finished) {
              const finalChunk: Record<string, unknown> = {
                id: geminiState.id,
                object: "chat.completion.chunk",
                created: geminiState.created,
                model: geminiState.model,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              };
              if (geminiState.usage) finalChunk.usage = geminiState.usage;
              const finalWire = `data: ${JSON.stringify(finalChunk)}\n\n`;
              const doneWire = "data: [DONE]\n\n";
              ctrl.enqueue(enc.encode(finalWire));
              ctrl.enqueue(enc.encode(doneWire));
              tail += finalWire + doneWire;
              geminiState.finished = true;
            } else if (codexState && !codexState.completed) {
              const finalChunk: Record<string, unknown> = {
                id: codexState.id,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: codexState.model,
                choices: [{ index: 0, delta: {}, finish_reason: codexState.sawToolDelta ? "tool_calls" : "stop" }],
              };
              const finalWire = `data: ${JSON.stringify(finalChunk)}\n\n`;
              const doneWire = "data: [DONE]\n\n";
              ctrl.enqueue(enc.encode(finalWire));
              ctrl.enqueue(enc.encode(doneWire));
              tail += finalWire + doneWire;
              codexState.completed = true;
            }
          } else {
            tail += dec.decode();
            if (!streamHasDoneFrame(tail)) {
              const doneWire = "data: [DONE]\n\n";
              ctrl.enqueue(enc.encode(doneWire));
              tail += doneWire;
            }
            if (tail.length > 4096) tail = tail.slice(-4096);
          }

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

      const writer = writable.getWriter();
      void (async () => {
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        const writeDoneWire = async () => {
          try {
            await writer.write(enc.encode("data: [DONE]\n\n"));
          } catch {}
        };
        const clearIdleTimer = () => {
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
        };
        const armIdleTimer = () => {
          clearIdleTimer();
          idleTimer = setTimeout(
            () => abortForTimeout("stream_idle_timeout"),
            UPSTREAM_STREAM_IDLE_TIMEOUT_MS,
          );
        };
        const readWithIdleTimeout = async () => {
          armIdleTimer();
          try {
            return await upstreamReader.read();
          } finally {
            clearIdleTimer();
          }
        };
        const writeWithIdleTimeout = async (chunk: Uint8Array) => {
          armIdleTimer();
          try {
            await writer.write(chunk);
          } finally {
            clearIdleTimer();
          }
        };
        void writer.closed.catch(() => {
          abortForClientCancel();
        });
        try {
          if (!firstRead.done && firstRead.value) {
            await writeWithIdleTimeout(firstRead.value);
          }
          while (true) {
            const { done, value } = await readWithIdleTimeout();
            if (done) break;
            if (value) await writeWithIdleTimeout(value);
          }
          await writer.close();
        } catch (err) {
          if (abortReason && abortReason !== "client_cancelled") {
            lastTimeoutError = { category: abortReason, model: currentModel || rawModel };
            logUpstreamTimeout({
              category: abortReason,
              provider,
              account: label,
              model: currentModel || rawModel,
              attempt: attempt + 1,
            });
            markAccountUnavailable(selected.id, 503, `upstream timeout (${abortReason})`, currentModel || null);
            await writeDoneWire();
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            if (abortReason !== "client_cancelled") {
              console.log(`  ${chalk.red("x")} stream pump failed -> ${chalk.cyan(label)} ${chalk.red(msg)}`);
              markAccountUnavailable(selected.id, 503, msg, currentModel || null);
              await writeDoneWire();
            }
          }
          try {
            if (abortReason === "client_cancelled") await writer.abort(err);
            else await writer.close();
          } catch {}
          try { await upstreamReader.cancel(err); } catch {}
        } finally {
          clearIdleTimer();
          clearRequestTotalTimer();
          removeClientAbortListener();
          upstreamReader.releaseLock();
        }
      })();

      return new Response(readable, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no", ...corsHeaders() },
      });
    }

    let data: Record<string, unknown>;
    try {
      data = (await upstreamResp.json()) as Record<string, unknown>;
    } catch (err) {
      clearRequestTotalTimer();
      removeClientAbortListener();
      if (abortReason === "client_cancelled") {
        return new Response(null, { status: 499 });
      }
      if (abortReason && abortReason !== "client_cancelled") {
        const timeoutResult = onTimeoutBeforeClientResponse(abortReason);
        if (timeoutResult === "retry") continue;
        return timeoutResult;
      }
      const msg = err instanceof Error ? err.message : String(err);
      logReq("POST", "/v1/chat/completions", 502, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
      return jsonResponse({
        error: {
          message: `Invalid upstream JSON response from ${provider}: ${msg}`,
          type: "upstream_invalid_response",
          code: 502,
          provider,
        },
      }, 502);
    }
    clearRequestTotalTimer();
    removeClientAbortListener();

    // Translate non-stream responses -> OpenAI format
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

  if (lastTimeoutError) {
    logReq("POST", "/v1/chat/completions", 504, Date.now() - start, { model: rawModel, rotated: rotations });
    return upstreamTimeoutResponse(provider, lastTimeoutError.category, lastTimeoutError.model);
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
