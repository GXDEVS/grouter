import { db, getStrategy, getStickyLimit } from "../db/index.ts";
import { updateAccount } from "../db/accounts.ts";
import { isModelLockActive, setModelLock, clearModelLock, getEarliestLockUntil } from "./lock.ts";
import { checkFallbackError, formatDuration } from "./fallback.ts";
import type { Connection, QwenAccount, RateLimitedResult, FallbackDecision } from "../types.ts";

export function selectAccount(
  provider: string,
  model: string | null,
  excludeIds?: Set<string>,
): Connection | RateLimitedResult | null {
  const strategy = getStrategy();
  const stickyLimit = getStickyLimit();

  const all = db()
    .query<Connection, [string]>(
      "SELECT * FROM accounts WHERE is_active = 1 AND provider = ? ORDER BY priority ASC"
    )
    .all(provider);

  const candidates = all.filter((a) => {
    if (excludeIds?.has(a.id)) return false;
    if (isModelLockActive(a.id, model)) return false;
    return true;
  });

  if (candidates.length === 0) {
    const anyLocked = all.some((a) => !excludeIds?.has(a.id) && isModelLockActive(a.id, model));
    if (anyLocked) {
      const earliest = getEarliestLockUntil(model);
      const retryAfter = earliest ?? new Date(Date.now() + 60_000).toISOString();
      const diff = earliest ? new Date(earliest).getTime() - Date.now() : 60_000;
      return { allRateLimited: true, retryAfter, retryAfterHuman: `reset after ${formatDuration(diff)}` };
    }
    return null;
  }

  let selected: Connection;

  if (strategy === "round-robin" && candidates.length > 0) {
    const withUsage = [...candidates].filter((a) => a.last_used_at);
    const withoutUsage = [...candidates].filter((a) => !a.last_used_at);

    // Prefer accounts never used first, then least-recently-used
    if (withoutUsage.length > 0) {
      selected = withoutUsage[0]!;
    } else {
      const sorted = withUsage.sort(
        (a, b) => new Date(a.last_used_at!).getTime() - new Date(b.last_used_at!).getTime()
      );
      // Check if most-recently-used is under sticky limit
      const mostRecent = withUsage.sort(
        (a, b) => new Date(b.last_used_at!).getTime() - new Date(a.last_used_at!).getTime()
      )[0];
      selected = (mostRecent && mostRecent.consecutive_use_count < stickyLimit)
        ? mostRecent
        : (sorted[0] ?? candidates[0]!);
    }
  } else {
    selected = candidates[0]!; // fill-first: already sorted by priority
  }

  // Update usage tracking
  const isSticky =
    strategy === "round-robin" &&
    selected.last_used_at !== null &&
    selected.consecutive_use_count < stickyLimit;

  updateAccount(selected.id, {
    last_used_at: new Date().toISOString(),
    consecutive_use_count: isSticky ? selected.consecutive_use_count + 1 : 1,
  });

  return selected;
}

export function markAccountUnavailable(
  accountId: string,
  status: number,
  errorText: string,
  model: string | null,
): FallbackDecision {
  const account = db()
    .query<{ backoff_level: number }, [string]>("SELECT backoff_level FROM accounts WHERE id = ?")
    .get(accountId);

  const decision = checkFallbackError(status, errorText, account?.backoff_level ?? 0);

  const patch: Partial<QwenAccount> = {
    last_error: errorText.slice(0, 500),
    error_code: status,
    last_error_at: new Date().toISOString(),
  };

  if (decision.cooldownMs > 0) {
    patch.test_status = "unavailable";
    setModelLock(accountId, model, decision.cooldownMs);
  }

  if (decision.newBackoffLevel !== undefined) {
    patch.backoff_level = decision.newBackoffLevel;
  }

  updateAccount(accountId, patch);
  return decision;
}

export function clearAccountError(accountId: string, model: string | null): void {
  updateAccount(accountId, {
    test_status: "active",
    last_error:  null,
    error_code:  null,
    backoff_level: 0,
  });
  if (model) clearModelLock(accountId, model);
}
