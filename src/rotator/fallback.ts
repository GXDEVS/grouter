import {
  COOLDOWN_UNAUTHORIZED_MS, COOLDOWN_PAYMENT_MS, COOLDOWN_TRANSIENT_MS,
  COOLDOWN_NOT_FOUND_MS, RATE_LIMIT_BACKOFF_BASE_MS, RATE_LIMIT_BACKOFF_MAX_MS,
  RATE_LIMIT_BACKOFF_MAX_LEVEL,
} from "../constants.ts";
import type { FallbackDecision } from "../types.ts";

export function getExponentialCooldown(level: number): number {
  return Math.min(RATE_LIMIT_BACKOFF_BASE_MS * Math.pow(2, level), RATE_LIMIT_BACKOFF_MAX_MS);
}

export function checkFallbackError(status: number, errorText: string, backoffLevel = 0): FallbackDecision {
  const lower = errorText.toLowerCase();

  if (status === 401) return { shouldFallback: true, cooldownMs: COOLDOWN_UNAUTHORIZED_MS };
  if (status === 402 || status === 403) return { shouldFallback: true, cooldownMs: COOLDOWN_PAYMENT_MS };
  // 404 model_not_found = wrong model ID, not a provider issue — no cooldown, just pass error through
  if (status === 404) return { shouldFallback: false, cooldownMs: 0 };
  // 422 Unprocessable Entity = bad request parameters sent by client, not a provider issue — no cooldown
  if (status === 422) return { shouldFallback: false, cooldownMs: 0 };

  if (status === 429 || lower.includes("rate limit") || lower.includes("quota exceeded") || lower.includes("too many requests")) {
    const newLevel = Math.min(backoffLevel + 1, RATE_LIMIT_BACKOFF_MAX_LEVEL);
    return { shouldFallback: true, cooldownMs: getExponentialCooldown(backoffLevel), newBackoffLevel: newLevel };
  }

  if (status >= 500 || lower.includes("timeout")) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_TRANSIENT_MS };
  }

  if (lower.includes("request not allowed")) return { shouldFallback: true, cooldownMs: COOLDOWN_UNAUTHORIZED_MS };

  return { shouldFallback: false, cooldownMs: 0 };
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "expired";
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.ceil(ms / 60_000)}m`;
  return `${Math.ceil(ms / 3_600_000)}h`;
}
