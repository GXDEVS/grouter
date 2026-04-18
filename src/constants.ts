export const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
export const QWEN_DEVICE_CODE_URL = "https://chat.qwen.ai/api/v1/oauth2/device/code";
export const QWEN_TOKEN_URL = "https://chat.qwen.ai/api/v1/oauth2/token";
export const QWEN_SCOPE = "openid profile email model.completion";
export const QWEN_DEFAULT_API_BASE = "https://portal.qwen.ai/v1";
export const QWEN_CODE_VERSION = "0.13.2";

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// Cooldowns
export const COOLDOWN_UNAUTHORIZED_MS = 15 * 60 * 1000;
export const COOLDOWN_PAYMENT_MS = 60 * 60 * 1000;
export const COOLDOWN_TRANSIENT_MS = 5_000;
export const COOLDOWN_NOT_FOUND_MS = 15 * 60 * 1000;
export const RATE_LIMIT_BACKOFF_BASE_MS = 1_000;
export const RATE_LIMIT_BACKOFF_MAX_MS = 2 * 60 * 1000;
export const RATE_LIMIT_BACKOFF_MAX_LEVEL = 15;

// Stainless headers required by portal.qwen.ai OAuth
const STAINLESS = {
  runtimeVersion: "v22.17.0",
  lang: "js",
  packageVersion: "5.11.0",
  retryCount: "0",
  runtime: "node",
};

function stainlessOs(): string {
  if (process.platform === "darwin") return "MacOS";
  if (process.platform === "win32") return "Windows";
  return "Linux";
}

export function qwenUserAgent(): string {
  return `QwenCode/${QWEN_CODE_VERSION} (${process.platform}; ${process.arch})`;
}

export function buildQwenHeaders(accessToken: string, stream = true): Record<string, string> {
  const ua = qwenUserAgent();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": ua,
    "X-DashScope-UserAgent": ua,
    "X-DashScope-AuthType": "qwen-oauth",
    "X-DashScope-CacheControl": "enable",
    "X-Stainless-Runtime": STAINLESS.runtime,
    "X-Stainless-Runtime-Version": STAINLESS.runtimeVersion,
    "X-Stainless-Lang": STAINLESS.lang,
    "X-Stainless-Arch": process.arch,
    "X-Stainless-Os": stainlessOs(),
    "X-Stainless-Package-Version": STAINLESS.packageVersion,
    "X-Stainless-Retry-Count": STAINLESS.retryCount,
    Accept: stream ? "text/event-stream" : "application/json",
  };
}

export function buildQwenApiBase(resourceUrl: string | null): string {
  if (!resourceUrl) return QWEN_DEFAULT_API_BASE;
  const raw = resourceUrl.trim();
  if (raw.startsWith("http")) return raw.replace(/\/$/, "");
  return `https://${raw.replace(/\/$/, "")}/v1`;
}

export function buildQwenUrl(resourceUrl: string | null): string {
  return `${buildQwenApiBase(resourceUrl)}/chat/completions`;
}

export function buildQwenModelsUrl(resourceUrl: string | null): string {
  return `${buildQwenApiBase(resourceUrl)}/models`;
}

// Known models for Qwen OAuth portal (QwenCode IDE endpoint)
export const QWEN_MODELS_OAUTH = [
  "qwen3-coder-plus",
  "qwen3-coder-flash",
  "vision-model",
  "coder-model",
];

// Estimated pricing per million tokens (USD) — for cost display only.
// These accounts are OAuth (free), values are informational equivalents.
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "qwen3-coder-plus":  { input: 3.5,  output: 7.0  },
  "qwen3-coder-flash": { input: 0.5,  output: 1.5  },
  "vision-model":      { input: 2.0,  output: 6.0  },
  "coder-model":       { input: 1.0,  output: 3.0  },
};
const DEFAULT_PRICING = { input: 1.0, output: 3.0 };

export function estimateCostUSD(model: string, promptTokens: number, completionTokens: number): number {
  const p = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output;
}

// System message required by Qwen API
export const QWEN_SYSTEM_MSG = {
  role: "system",
  content: [{ type: "text", text: "", cache_control: { type: "ephemeral" } }],
};
