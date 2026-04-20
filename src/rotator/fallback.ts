import {
  COOLDOWN_UNAUTHORIZED_MS,
  COOLDOWN_PAYMENT_MS,
  COOLDOWN_TRANSIENT_MS,
  RATE_LIMIT_BACKOFF_BASE_MS,
  RATE_LIMIT_BACKOFF_MAX_MS,
  RATE_LIMIT_BACKOFF_MAX_LEVEL,
} from "../constants.ts";
import type { FallbackDecision } from "../types.ts";

export function getExponentialCooldown(level: number): number {
  return Math.min(RATE_LIMIT_BACKOFF_BASE_MS * Math.pow(2, level), RATE_LIMIT_BACKOFF_MAX_MS);
}

function isRateLimitSignal(status: number, lowerErrorText: string): boolean {
  if (status === 429) return true;

  const structuredMarkers = [
    '"type":"rate_limit',
    '"code":"rate_limit',
    "rate_limit_exceeded",
    "rate limit reached",
  ];
  const hasStructuredMarker = structuredMarkers.some((m) => lowerErrorText.includes(m));
  if (hasStructuredMarker && (status === 400 || status === 403 || status === 503 || status === 529)) {
    return true;
  }

  // Some gateways return 503/529 with textual rate-limit errors.
  if ((status === 503 || status === 529) && (
    lowerErrorText.includes("too many requests") ||
    lowerErrorText.includes("quota exceeded")
  )) {
    return true;
  }

  return false;
}

export function checkFallbackError(status: number, errorText: string, backoffLevel = 0): FallbackDecision {
  const lower = errorText.toLowerCase();

  if (status === 401) return { shouldFallback: true, cooldownMs: COOLDOWN_UNAUTHORIZED_MS };
  // 404 model_not_found = wrong model ID, not provider outage, so do not lock account.
  if (status === 404) return { shouldFallback: false, cooldownMs: 0 };
  // 422 invalid request body/params is client-side and should not trigger account cooldown.
  if (status === 422) return { shouldFallback: false, cooldownMs: 0 };

  if (isRateLimitSignal(status, lower)) {
    const newLevel = Math.min(backoffLevel + 1, RATE_LIMIT_BACKOFF_MAX_LEVEL);
    return {
      shouldFallback: true,
      cooldownMs: getExponentialCooldown(backoffLevel),
      newBackoffLevel: newLevel,
    };
  }

  if (lower.includes("request not allowed")) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_UNAUTHORIZED_MS };
  }

  if (status === 402 || status === 403) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_PAYMENT_MS };
  }

  if (status >= 500 || lower.includes("timeout")) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_TRANSIENT_MS };
  }

  return { shouldFallback: false, cooldownMs: 0 };
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "expired";
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.ceil(ms / 60_000)}m`;
  return `${Math.ceil(ms / 3_600_000)}h`;
}
