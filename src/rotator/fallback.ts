import {
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
  if (hasStructuredMarker && (status === 400 || status === 403 || status === 413 || status === 503 || status === 529)) {
    return true;
  }

  // Some providers (e.g. Groq) return 413 when the request blows past TPM/prompt limits.
  if (status === 413 && (
    lowerErrorText.includes("request too large") ||
    lowerErrorText.includes("tokens per minute") ||
    lowerErrorText.includes("context length")
  )) {
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

  // Auth/permission failures should be surfaced quickly (401/402/403),
  // not converted into minute-long cooldown locks that become opaque 503 loops.
  // 401/402/403 should not place accounts into cooldown locks.
  // Returning fallback=true with cooldown=0 still allows in-request rotation
  // across other accounts, but prevents future instant 503 "all unavailable".
  if (status === 401 || status === 402 || status === 403) {
    return { shouldFallback: true, cooldownMs: 0 };
  }
  // 404 model_not_found = wrong model ID, not provider outage, so do not lock account.
  if (status === 404) return { shouldFallback: false, cooldownMs: 0 };
  // 422 invalid request body/params is client-side and should not trigger account cooldown.
  if (status === 422) return { shouldFallback: false, cooldownMs: 0 };
  // 413 request-too-large is generally a client payload issue (prompt/tool schema/context),
  // so return it directly instead of putting the account into cooldown rotation.
  if (status === 413 && (
    lower.includes("request too large") ||
    lower.includes("tokens per minute") ||
    lower.includes("context length") ||
    lower.includes("prompt is too long")
  )) {
    return { shouldFallback: false, cooldownMs: 0 };
  }

  if (isRateLimitSignal(status, lower)) {
    const newLevel = Math.min(backoffLevel + 1, RATE_LIMIT_BACKOFF_MAX_LEVEL);
    return {
      shouldFallback: true,
      cooldownMs: getExponentialCooldown(backoffLevel),
      newBackoffLevel: newLevel,
    };
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
