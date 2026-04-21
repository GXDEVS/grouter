// Model Fetcher
// Fetches the current list of models from a provider's OpenAI-compatible
// /v1/models endpoint, then persists them via db/models.ts.

import {
  findProviderModelById,
  getProvider,
  isProviderModelFree,
  looksLikeFreeModelId,
  type Provider,
} from "../providers/registry.ts";
import { saveProviderModels, getProviderModels } from "../db/models.ts";
import { listConnectionsByProvider } from "../db/accounts.ts";
import {
  getModelFreeOverride,
  getProviderFreeOverride,
  type FreeProviderSource,
} from "../providers/free-overrides.ts";

export interface ProviderModelInfo {
  id: string;
  name: string;
  is_free: boolean;
  free_source: FreeProviderSource;
  last_verified_at: string;
  free_hint: boolean;
}

type ModelPricingShape = Record<string, string | number | null | undefined>;

/** Result of a model-fetch operation. */
export interface FetchModelsResult {
  provider: string;
  models: ProviderModelInfo[];
  source: "api" | "fallback";
}

/**
 * Fetch models from a provider's /v1/models endpoint using a stored API key.
 * Falls back to the hardcoded registry models if the fetch fails.
 */
export async function fetchAndSaveProviderModels(
  providerId: string,
  apiKey?: string,
): Promise<FetchModelsResult> {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  // Find an API key if not provided
  let key = apiKey;
  if (!key) {
    const connections = listConnectionsByProvider(providerId);
    const active = connections.find((c) => c.is_active === 1 && c.api_key);
    key = active?.api_key ?? undefined;
  }

  if (!key || !provider.baseUrl) {
    // No key or no baseUrl - use hardcoded models as fallback
    return saveFromRegistry(provider);
  }

  try {
    const base = provider.baseUrl.replace(/\/$/, "");
    const modelsUrl = `${base}/models`;

    const resp = await fetch(modelsUrl, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      console.error(
        `Model fetch failed for ${providerId}: ${resp.status} ${resp.statusText}`,
      );
      return saveFromRegistry(provider);
    }

    const body = (await resp.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        pricing?: ModelPricingShape;
      }>;
    };

    if (!body.data || body.data.length === 0) {
      return saveFromRegistry(provider);
    }

    const models = body.data.map((m) =>
      buildModelInfo(provider, m.id, m.name || formatModelName(m.id), m.pricing),
    );

    saveProviderModels(
      providerId,
      models.map((m) => ({
        id: m.id,
        name: m.name,
        is_free: m.is_free,
        free_source: m.free_source,
        free_verified_at: m.last_verified_at,
      })),
    );

    return { provider: providerId, models, source: "api" };
  } catch (err) {
    console.error(`Model fetch error for ${providerId}:`, err);
    return saveFromRegistry(provider);
  }
}

/**
 * Get models for a provider - from DB if available, otherwise from registry.
 */
export function getModelsForProvider(providerId: string): ProviderModelInfo[] {
  const provider = getProvider(providerId);
  const stored = getProviderModels(providerId);
  if (stored.length > 0) {
    return stored.map((s) => {
      const modelName = s.model_name || formatModelName(s.model_id);
      const storedSource = normalizeFreeSource(s.free_source);
      const storedVerifiedAt = normalizeVerifiedAt(s.free_verified_at, s.updated_at);

      // Keep positive API-pricing results from live fetches, but recompute all
      // other rows so override updates apply without waiting for a manual refresh.
      if (provider && !(storedSource === "api_pricing" && s.is_free)) {
        const classified = classifyFree(provider, s.model_id, modelName);
        return {
          id: s.model_id,
          name: modelName,
          is_free: classified.isFree,
          free_source: classified.source,
          last_verified_at: classified.verifiedAt,
          free_hint: looksLikeFreeModelId(s.model_id) || looksLikeFreeModelId(modelName),
        };
      }

      return {
        id: s.model_id,
        name: modelName,
        is_free: s.is_free,
        free_source: storedSource,
        last_verified_at: storedVerifiedAt,
        free_hint: looksLikeFreeModelId(s.model_id) || looksLikeFreeModelId(modelName),
      };
    });
  }

  // Fallback to registry
  if (!provider) return [];
  return provider.models.map((m) => buildModelInfo(provider, m.id, m.name));
}

// Helpers

function saveFromRegistry(provider: Provider): FetchModelsResult {
  const models = provider.models.map((m) => buildModelInfo(provider, m.id, m.name));
  // Don't persist fallback - leave DB empty so next attempt can fetch live
  return { provider: provider.id, models, source: "fallback" };
}

function buildModelInfo(
  provider: Provider,
  modelId: string,
  modelName: string,
  pricing?: ModelPricingShape,
): ProviderModelInfo {
  const freeHint = looksLikeFreeModelId(modelId) || looksLikeFreeModelId(modelName);
  const classified = classifyFree(provider, modelId, modelName, pricing);
  return {
    id: modelId,
    name: modelName,
    is_free: classified.isFree,
    free_source: classified.source,
    last_verified_at: classified.verifiedAt,
    free_hint: freeHint,
  };
}

function classifyFree(
  provider: Provider,
  modelId: string,
  modelName: string,
  pricing?: ModelPricingShape,
): { isFree: boolean; source: FreeProviderSource; verifiedAt: string } {
  const now = new Date().toISOString();

  if (hasZeroPricing(pricing)) {
    return { isFree: true, source: "api_pricing", verifiedAt: now };
  }

  const modelOverride = getModelFreeOverride(provider.id, modelId);
  if (modelOverride) {
    return {
      isFree: modelOverride.isFree,
      source: "override",
      verifiedAt: normalizeVerifiedAt(modelOverride.verifiedAt, now),
    };
  }

  const providerOverride = getProviderFreeOverride(provider.id);
  if (providerOverride?.allModelsFree?.isFree) {
    return {
      isFree: true,
      source: "provider_policy",
      verifiedAt: normalizeVerifiedAt(providerOverride.allModelsFree.verifiedAt, now),
    };
  }

  if (provider.category === "free" || provider.allModelsFree) {
    return { isFree: true, source: "provider_policy", verifiedAt: now };
  }

  const listedModel = findProviderModelById(provider, modelId);
  if (listedModel && isProviderModelFree(listedModel, provider)) {
    return { isFree: true, source: "registry_flag", verifiedAt: now };
  }

  // Some providers expose dedicated "-free" IDs in live catalogs that are not
  // always present in static fallback lists.
  if ((provider.hasFreeModels || provider.freeTier) && (looksLikeFreeModelId(modelId) || looksLikeFreeModelId(modelName))) {
    return { isFree: true, source: "name_hint", verifiedAt: now };
  }

  return { isFree: false, source: "none", verifiedAt: now };
}

function hasZeroPricing(pricing?: ModelPricingShape): boolean {
  if (!pricing || typeof pricing !== "object") return false;
  const candidates = [
    "prompt",
    "completion",
    "input",
    "output",
    "prompt_cost",
    "completion_cost",
    "input_cost",
    "output_cost",
  ] as const;
  const values: number[] = [];
  for (const key of candidates) {
    const raw = pricing[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Number.parseFloat(String(raw));
    if (Number.isFinite(n)) values.push(n);
  }
  if (!values.length) return false;
  return values.every((v) => v === 0);
}

function normalizeVerifiedAt(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.trim()) return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

function normalizeFreeSource(raw: string | null | undefined): FreeProviderSource {
  switch (raw) {
    case "api_pricing":
    case "override":
    case "provider_policy":
    case "registry_flag":
    case "name_hint":
    case "none":
      return raw;
    default:
      return "none";
  }
}

/** Convert model IDs like "meta-llama/llama-3.3-70b-instruct" to a readable name. */
function formatModelName(id: string): string {
  const parts = id.split("/");
  const name = parts[parts.length - 1] ?? id;
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
