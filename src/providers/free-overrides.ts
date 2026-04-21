export type FreeProviderSource =
  | "api_pricing"
  | "override"
  | "provider_policy"
  | "registry_flag"
  | "name_hint"
  | "none";

export interface FreeModelOverride {
  isFree: boolean;
  verifiedAt: string;
  sourceUrl: string;
  note?: string;
}

export interface ProviderFreeOverride {
  allModelsFree?: {
    isFree: boolean;
    verifiedAt: string;
    sourceUrl: string;
    note?: string;
  };
  models?: Record<string, FreeModelOverride>;
}

function normalizeModelKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

function dropProviderPrefix(modelId: string): string {
  const idx = modelId.indexOf("/");
  return idx === -1 ? modelId : modelId.slice(idx + 1);
}

function modelKeyMatches(left: string, right: string): boolean {
  const l = normalizeModelKey(left);
  const r = normalizeModelKey(right);
  if (!l || !r) return false;
  if (l === r) return true;
  const lNoPrefix = dropProviderPrefix(l);
  const rNoPrefix = dropProviderPrefix(r);
  if (lNoPrefix === rNoPrefix) return true;
  return l.endsWith("/" + rNoPrefix) || r.endsWith("/" + lNoPrefix);
}

export const FREE_OVERRIDES: Record<string, ProviderFreeOverride> = {
  openrouter: {
    models: {
      "deepseek/deepseek-r1": {
        isFree: true,
        verifiedAt: "2026-04-20",
        sourceUrl: "https://openrouter.ai/collections/free-models",
        note: "OpenRouter free collection.",
      },
      "meta-llama/llama-3.3-70b-instruct": {
        isFree: true,
        verifiedAt: "2026-04-20",
        sourceUrl: "https://openrouter.ai/collections/free-models",
        note: "OpenRouter free collection.",
      },
    },
  },
  cerebras: {
    models: {
      "llama3.1-8b": {
        isFree: true,
        verifiedAt: "2026-04-20",
        sourceUrl: "https://www.cerebras.ai/pricing",
        note: "Cerebras pricing page lists a Free tier.",
      },
    },
  },
  mistral: {
    models: {
      "ministral-3b-latest": {
        isFree: true,
        verifiedAt: "2026-04-20",
        sourceUrl: "https://help.mistral.ai/en/articles/450104-how-can-i-try-the-api-for-free-with-the-experiment-plan",
        note: "Free Experiment plan available for API prototyping.",
      },
      "mistral-small-latest": {
        isFree: true,
        verifiedAt: "2026-04-20",
        sourceUrl: "https://help.mistral.ai/en/articles/450104-how-can-i-try-the-api-for-free-with-the-experiment-plan",
        note: "Free Experiment plan available for API prototyping.",
      },
      "ministral-8b-latest": {
        isFree: true,
        verifiedAt: "2026-04-20",
        sourceUrl: "https://help.mistral.ai/en/articles/450104-how-can-i-try-the-api-for-free-with-the-experiment-plan",
        note: "Free Experiment plan available for API prototyping.",
      },
    },
  },
  huggingface: {
    allModelsFree: {
      isFree: true,
      verifiedAt: "2026-04-20",
      sourceUrl: "https://huggingface.co/inference-api/",
      note: "All models on router.huggingface.co/v1 are free with rate limits.",
    },
  },
  together: {
    models: {
      "meta-llama/Llama-3.3-70B-Instruct-Turbo": {
        isFree: false,
        verifiedAt: "2026-04-20",
        sourceUrl: "https://support.together.ai/articles/1862638756-changes-to-free-tier-and-billing-july-2025",
        note: "Support article indicates no free trial.",
      },
    },
  },
  "github-models": {
    allModelsFree: {
      isFree: true,
      verifiedAt: "2026-04-20",
      sourceUrl: "https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models",
      note: "GitHub provides free API usage for prototyping, with rate limits.",
    },
  },
  sambanova: {
    allModelsFree: {
      isFree: true,
      verifiedAt: "2026-04-20",
      sourceUrl: "https://cloud.sambanova.ai/plans",
      note: "SambaNova provides free starter API credits (time/credit limited).",
    },
  },
};

export function getProviderFreeOverride(providerId: string): ProviderFreeOverride | null {
  return FREE_OVERRIDES[providerId] ?? null;
}

export function getModelFreeOverride(providerId: string, modelId: string): FreeModelOverride | null {
  const models = FREE_OVERRIDES[providerId]?.models;
  if (!models) return null;
  if (models[modelId]) return models[modelId];
  for (const [overrideId, override] of Object.entries(models)) {
    if (modelKeyMatches(overrideId, modelId)) return override;
  }
  return null;
}

export interface FreeProviderCandidate {
  providerId: string;
  displayName: string;
  openaiCompatible: boolean;
  freeTierActive: boolean;
  docsUrl: string;
  integrated: boolean;
  stability: "stable" | "beta";
}

export const FREE_PROVIDER_CANDIDATES: FreeProviderCandidate[] = [
  { providerId: "opencode", displayName: "OpenCode", openaiCompatible: true, freeTierActive: true, docsUrl: "https://opencode.ai/", integrated: true, stability: "stable" },
  { providerId: "openrouter", displayName: "OpenRouter", openaiCompatible: true, freeTierActive: true, docsUrl: "https://openrouter.ai/docs/guides/guides/get-started/free-models-router-playground", integrated: true, stability: "stable" },
  { providerId: "cerebras", displayName: "Cerebras", openaiCompatible: true, freeTierActive: true, docsUrl: "https://www.cerebras.ai/pricing", integrated: true, stability: "stable" },
  { providerId: "mistral", displayName: "Mistral", openaiCompatible: true, freeTierActive: true, docsUrl: "https://help.mistral.ai/en/articles/450104-how-can-i-try-the-api-for-free-with-the-experiment-plan", integrated: true, stability: "stable" },
  { providerId: "huggingface", displayName: "Hugging Face", openaiCompatible: true, freeTierActive: true, docsUrl: "https://huggingface.co/inference-api/", integrated: true, stability: "stable" },
  { providerId: "modal", displayName: "Modal", openaiCompatible: true, freeTierActive: true, docsUrl: "https://modal.com/pricing", integrated: true, stability: "stable" },
  { providerId: "kiro", displayName: "Kiro", openaiCompatible: true, freeTierActive: true, docsUrl: "https://kiro.dev/", integrated: true, stability: "beta" },
  { providerId: "iflow", displayName: "iFlow", openaiCompatible: true, freeTierActive: true, docsUrl: "https://iflow.cn/", integrated: true, stability: "beta" },
  { providerId: "kimi-coding", displayName: "Kimi Coding", openaiCompatible: true, freeTierActive: true, docsUrl: "https://www.kimi.com/", integrated: true, stability: "beta" },
  { providerId: "kilocode", displayName: "KiloCode", openaiCompatible: true, freeTierActive: true, docsUrl: "https://www.kilocode.ai/", integrated: true, stability: "beta" },
  { providerId: "nvidia", displayName: "NVIDIA NIM", openaiCompatible: true, freeTierActive: true, docsUrl: "https://build.nvidia.com/", integrated: true, stability: "stable" },
  { providerId: "gemini", displayName: "Google Gemini", openaiCompatible: true, freeTierActive: true, docsUrl: "https://aistudio.google.com/app/apikey", integrated: true, stability: "stable" },
  { providerId: "github-models", displayName: "GitHub Models", openaiCompatible: true, freeTierActive: true, docsUrl: "https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models", integrated: true, stability: "stable" },
  { providerId: "sambanova", displayName: "SambaNova", openaiCompatible: true, freeTierActive: true, docsUrl: "https://cloud.sambanova.ai/plans", integrated: true, stability: "stable" },
];

function candidateScore(c: FreeProviderCandidate): number {
  const compat = c.openaiCompatible ? 50 : 0;
  const freeTier = c.freeTierActive ? 35 : 0;
  const integrated = c.integrated ? 10 : 0;
  const stability = c.stability === "stable" ? 5 : 0;
  return compat + freeTier + integrated + stability;
}

export function getTopFreeProviderIds(limit = 10): string[] {
  return [...FREE_PROVIDER_CANDIDATES]
    .filter((c) => c.openaiCompatible && c.freeTierActive)
    .sort((a, b) => {
      const scoreDiff = candidateScore(b) - candidateScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return a.displayName.localeCompare(b.displayName);
    })
    .slice(0, limit)
    .map((c) => c.providerId);
}

export function getTopFreeProviderRankMap(limit = 10): Map<string, number> {
  const ranked = getTopFreeProviderIds(limit);
  const map = new Map<string, number>();
  for (let i = 0; i < ranked.length; i++) map.set(ranked[i], i + 1);
  return map;
}
