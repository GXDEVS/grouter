import { getAdapter } from "../auth/providers/index.ts";
import {
  addApiKeyConnection,
  getConnectionCountByProvider,
  listConnectionsByProvider,
  removeAccount,
} from "../db/accounts.ts";
import { getProviderPort, releaseProviderPortIfEmpty } from "../db/ports.ts";
import { getSetting, setSetting } from "../db/index.ts";
import { clearModelsCache, ensureProviderServer } from "../proxy/server.ts";
import { fetchAndSaveProviderModels, getModelsForProvider } from "../providers/model-fetcher.ts";
import {
  getProviderLock,
  getTopFreeProviderRank,
  isCustomProviderId,
  providerHasFreeModelsById,
  PROVIDERS,
  removeCustomProvider,
  saveCustomProvider,
  updateCustomProvider,
  type Provider,
} from "../providers/registry.ts";
import { errorResponse, handleApiError, json, readJson } from "./api-http.ts";

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

export function handleGetProviders(): Response {
  const counts = getConnectionCountByProvider();
  const list = Object.values(PROVIDERS).map((provider) => {
    const adapter = getAdapter(provider.id);
    const models = getModelsForProvider(provider.id);
    const freeModelsCount = models.filter((model) => model.is_free).length;
    const totalModelsCount = models.length;
    const hasFreeModels = totalModelsCount > 0
      ? freeModelsCount > 0
      : providerHasFreeModelsById(provider.id);
    const topFreeRank = getTopFreeProviderRank(provider.id);
    return {
      id: provider.id,
      name: provider.name,
      description: provider.description,
      category: provider.category,
      authType: provider.authType,
      oauthFlow: adapter?.flow ?? null,
      color: provider.color,
      logo: provider.logo ?? null,
      apiKeyUrl: provider.apiKeyUrl ?? null,
      baseUrl: isCustomProviderId(provider.id) ? provider.baseUrl : null,
      isCustom: isCustomProviderId(provider.id),
      deprecated: provider.deprecated ?? false,
      deprecationReason: provider.deprecationReason ?? null,
      underConstruction: provider.underConstruction ?? false,
      underConstructionReason: provider.underConstructionReason ?? null,
      models: provider.models,
      connections: counts[provider.id] ?? 0,
      port: getProviderPort(provider.id),
      requiresMeta: provider.requiresMeta ?? null,
      freeTier: hasFreeModels ? (provider.freeTier ?? null) : null,
      hasFreeModels,
      freeModelsCount,
      totalModelsCount,
      topFreeRank,
    };
  });
  return json({ providers: list });
}

export function handleGetProviderConnections(id: string): Response {
  const provider = PROVIDERS[id];
  if (!provider) return errorResponse(404, `Unknown provider: ${id}`);
  const connections = listConnectionsByProvider(id).map((connection) => ({
    id: connection.id,
    display_name: connection.display_name,
    email: connection.email,
    auth_type: connection.auth_type,
    api_key_mask: connection.api_key ? maskApiKey(connection.api_key) : null,
    is_active: connection.is_active,
    test_status: connection.test_status,
    priority: connection.priority,
    proxy_pool_id: connection.proxy_pool_id ?? null,
    created_at: connection.created_at,
  }));
  return json({
    provider: { id: provider.id, name: provider.name, color: provider.color, logo: provider.logo ?? null, port: getProviderPort(provider.id) },
    connections,
  });
}

function sanitizeColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}

function sanitizeIcon(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim();
  if (!v) return null;
  // Allow URLs (http/https) or iconify id (e.g. "solar:server-bold-duotone").
  if (v.startsWith("/") || v.startsWith("http")) return v;
  if (/^[a-z0-9-]+:[a-z0-9._-]+$/i.test(v)) return v;
  return null;
}

export async function handleCreateCustomProvider(req: Request): Promise<Response> {
  try {
    const body = await readJson<{
      name?: string;
      url?: string;
      logo?: string;
      color?: string;
    }>(req);
    if (!body.name) return errorResponse(400, "name is required");
    if (!body.url) return errorResponse(400, "url is required");

    const safeId = "custom_" + crypto.randomUUID().slice(0, 8) + "_" + body.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const provider: Provider = {
      id: safeId,
      name: body.name,
      description: "Custom provider",
      category: "apikey",
      authType: "apikey",
      color: sanitizeColor(body.color) ?? "#94a3b8",
      baseUrl: body.url,
      logo: sanitizeIcon(body.logo) ?? "solar:server-square-bold-duotone",
      models: [{ id: "default", name: "Default" }],
    };

    saveCustomProvider(provider);
    return json(provider);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function handleUpdateCustomProvider(id: string, req: Request): Promise<Response> {
  if (!isCustomProviderId(id)) return errorResponse(400, "Not a custom provider");
  if (!PROVIDERS[id]) return errorResponse(404, `Unknown provider: ${id}`);
  try {
    const body = await readJson<{
      name?: string;
      url?: string;
      logo?: string;
      color?: string;
    }>(req);

    const patch: Partial<Pick<Provider, "name" | "baseUrl" | "color" | "logo">> = {};
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.url === "string" && body.url.trim()) {
      if (!body.url.startsWith("http")) return errorResponse(400, "url must start with http:// or https://");
      patch.baseUrl = body.url.trim();
    }
    const color = sanitizeColor(body.color);
    if (color) patch.color = color;
    if (body.logo !== undefined) {
      const logo = sanitizeIcon(body.logo);
      patch.logo = logo ?? "solar:server-square-bold-duotone";
    }

    const updated = updateCustomProvider(id, patch);
    if (!updated) return errorResponse(404, `Custom provider not found: ${id}`);
    clearModelsCache();
    return json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export function handleDeleteCustomProvider(id: string): Response {
  if (!isCustomProviderId(id)) return errorResponse(400, "Not a custom provider");
  if (!PROVIDERS[id]) return errorResponse(404, `Unknown provider: ${id}`);

  // Drop any connections registered under this custom provider.
  const connections = listConnectionsByProvider(id);
  for (const conn of connections) removeAccount(conn.id);
  releaseProviderPortIfEmpty(id);

  const ok = removeCustomProvider(id);
  if (!ok) return errorResponse(404, `Custom provider not found: ${id}`);
  clearModelsCache();
  return json({ ok: true, removed: id, removedConnections: connections.length });
}

export async function handleAddConnection(req: Request): Promise<Response> {
  try {
    const body = await readJson<{ provider?: string; api_key?: string; display_name?: string }>(req);
    if (!body.provider) return errorResponse(400, "provider is required");
    if (!body.api_key) return errorResponse(400, "api_key is required");

    const provider = PROVIDERS[body.provider];
    if (!provider) return errorResponse(400, `Unknown provider: ${body.provider}`);
    const addLock = getProviderLock(provider);
    if (addLock) return errorResponse(addLock.kind === "deprecated" ? 410 : 503, addLock.reason);
    if (provider.authType !== "apikey") return errorResponse(400, "Use OAuth flow for this provider");

    const connection = addApiKeyConnection({
      provider: body.provider,
      api_key: body.api_key.trim(),
      display_name: body.display_name ?? null,
    });
    const port = getProviderPort(body.provider);

    fetchAndSaveProviderModels(body.provider, body.api_key.trim()).catch(() => {});
    ensureProviderServer(body.provider);

    return json({ ok: true, connection, port });
  } catch (err) {
    return handleApiError(err);
  }
}

export function handleGetProviderModels(id: string): Response {
  const provider = PROVIDERS[id];
  if (!provider) return errorResponse(404, `Unknown provider: ${id}`);
  const models = getModelsForProvider(id);
  const freeOnly = getSetting(`provider_free_only_${id}`) === "true";
  return json({ provider: id, models, free_only: freeOnly });
}

export async function handleProviderConfig(id: string, req: Request): Promise<Response> {
  const provider = PROVIDERS[id];
  if (!provider) return errorResponse(404, `Unknown provider: ${id}`);
  try {
    const body = await readJson<{ free_only?: boolean }>(req);
    if (typeof body.free_only === "boolean") {
      setSetting(`provider_free_only_${id}`, body.free_only ? "true" : "false");
      clearModelsCache();
    }
    return json({ ok: true, free_only: body.free_only });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function handleRefreshProviderModels(id: string): Promise<Response> {
  const provider = PROVIDERS[id];
  if (!provider) return errorResponse(404, `Unknown provider: ${id}`);
  try {
    const result = await fetchAndSaveProviderModels(id);
    clearModelsCache();
    return json({ provider: id, models: result.models, source: result.source });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function handleRefreshProviderModelsBatch(req: Request): Promise<Response> {
  try {
    const body = await readJson<{ providers?: string[] }>(req, {});
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

    clearModelsCache();
    const success = results.filter((result) => result.ok).length;
    return json({
      ok: success === results.length,
      summary: { total: results.length, success, failed: results.length - success },
      results,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
