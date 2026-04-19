// ── Model Fetcher ────────────────────────────────────────────────────────────
// Fetches the current list of models from a provider's OpenAI-compatible
// /v1/models endpoint, then persists them via db/models.ts.

import { getProvider, type Provider, type ProviderModel } from "../providers/registry.ts";
import { saveProviderModels, getProviderModels, type StoredModel } from "../db/models.ts";
import { listConnectionsByProvider } from "../db/accounts.ts";

/** Result of a model-fetch operation. */
export interface FetchModelsResult {
  provider: string;
  models: { id: string; name: string; is_free: boolean }[];
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
    // No key or no baseUrl — use hardcoded models as fallback
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
        pricing?: { prompt?: string; completion?: string };
      }>;
    };

    if (!body.data || body.data.length === 0) {
      return saveFromRegistry(provider);
    }

    const models = body.data.map((m) => ({
      id: m.id,
      name: m.name || formatModelName(m.id),
      is_free: isModelFree(m),
    }));

    saveProviderModels(providerId, models);

    return { provider: providerId, models, source: "api" };
  } catch (err) {
    console.error(`Model fetch error for ${providerId}:`, err);
    return saveFromRegistry(provider);
  }
}

/**
 * Get models for a provider — from DB if available, otherwise from registry.
 */
export function getModelsForProvider(
  providerId: string,
): { id: string; name: string; is_free: boolean }[] {
  const stored = getProviderModels(providerId);
  if (stored.length > 0) {
    return stored.map((s) => ({
      id: s.model_id,
      name: s.model_name,
      is_free: s.is_free,
    }));
  }

  // Fallback to registry
  const provider = getProvider(providerId);
  if (!provider) return [];
  return provider.models.map((m) => ({
    id: m.id,
    name: m.name,
    is_free: false,
  }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function saveFromRegistry(provider: Provider): FetchModelsResult {
  const models = provider.models.map((m) => ({
    id: m.id,
    name: m.name,
    is_free: false,
  }));
  // Don't persist fallback — leave DB empty so next attempt can fetch live
  return { provider: provider.id, models, source: "fallback" };
}

/** Detect free models from OpenRouter-style pricing. */
function isModelFree(
  m: { pricing?: { prompt?: string; completion?: string } },
): boolean {
  if (!m.pricing) return false;
  const promptCost = parseFloat(m.pricing.prompt ?? "1");
  const completionCost = parseFloat(m.pricing.completion ?? "1");
  return promptCost === 0 && completionCost === 0;
}

/** Convert model IDs like "meta-llama/llama-3.3-70b-instruct" to a readable name. */
function formatModelName(id: string): string {
  const parts = id.split("/");
  const name = parts[parts.length - 1];
  return name
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
