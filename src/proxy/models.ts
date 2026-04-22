import { QWEN_MODELS_OAUTH } from "../constants.ts";
import { getConnectionCountByProvider } from "../db/accounts.ts";
import { getClientKey } from "../db/client_keys.ts";
import { getSetting } from "../db/index.ts";
import { getModelsForProvider } from "../providers/model-fetcher.ts";
import { PROVIDERS } from "../providers/registry.ts";

let modelsCache: { data: unknown[]; at: number } | null = null;
const MODELS_TTL = 10 * 60 * 1000;

/** Invalidates the in-memory models cache. Called by API handlers after config changes. */
export function clearModelsCache(): void {
  modelsCache = null;
}

/**
 * Aggregate models from all providers that have active connections.
 * Each model is prefixed as "provider/model-id".
 */
export async function fetchModels(req?: Request): Promise<unknown[]> {
  let baseData: unknown[] = [];
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL) {
    baseData = modelsCache.data;
  } else {
    const counts = getConnectionCountByProvider();
    const data: unknown[] = [];

    for (const [providerId, provider] of Object.entries(PROVIDERS)) {
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
  }

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
          const allowed = JSON.parse(clientKey.allowed_providers) as string[];
          if (allowed.length > 0) {
            return baseData.filter((modelEntry) => {
              const modelId = (modelEntry as { id?: string }).id;
              const providerId = typeof modelId === "string" ? modelId.split("/")[0] : undefined;
              return !!providerId && allowed.includes(providerId);
            });
          }
        } catch {
          // Ignore malformed allowed_providers values and fall back to full list.
        }
      }
    } else if (requireAuth) {
      return [];
    }
  }

  return baseData;
}
