import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection } from "../src/types.ts";

const testHome = mkdtempSync(join(tmpdir(), "grouter-rotator-test-"));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;

const { db, setSetting } = await import("../src/db/index.ts");
const { selectAccount, markAccountUnavailable, clearAccountError } = await import("../src/rotator/index.ts");
const { setModelLock } = await import("../src/rotator/lock.ts");

function insertConnection(overrides: Partial<Connection> & { id: string }): Connection {
  const now = new Date().toISOString();
  const { id, ...rest } = overrides;
  const row: Connection = {
    id,
    provider: "openai",
    auth_type: "oauth",
    email: null,
    display_name: null,
    access_token: "token",
    refresh_token: "refresh",
    expires_at: "2099-01-01T00:00:00.000Z",
    resource_url: null,
    api_key: null,
    proxy_pool_id: null,
    provider_data: null,
    priority: 1,
    is_active: 1,
    test_status: "active",
    last_error: null,
    error_code: null,
    last_error_at: null,
    backoff_level: 0,
    consecutive_use_count: 0,
    last_used_at: null,
    created_at: now,
    updated_at: now,
    ...rest,
  };

  db().query(
    `INSERT INTO accounts (
      id, provider, auth_type, email, display_name, access_token, refresh_token, expires_at,
      resource_url, api_key, proxy_pool_id, provider_data, priority, is_active, test_status,
      last_error, error_code, last_error_at, backoff_level, consecutive_use_count,
      last_used_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.provider,
    row.auth_type,
    row.email,
    row.display_name,
    row.access_token,
    row.refresh_token,
    row.expires_at,
    row.resource_url,
    row.api_key,
    row.proxy_pool_id,
    row.provider_data,
    row.priority,
    row.is_active,
    row.test_status,
    row.last_error,
    row.error_code,
    row.last_error_at,
    row.backoff_level,
    row.consecutive_use_count,
    row.last_used_at,
    row.created_at,
    row.updated_at,
  );

  return row;
}

function expectSelectedConnection(
  result: ReturnType<typeof selectAccount>,
): Connection {
  if (!result || "allRateLimited" in result || "allTemporarilyUnavailable" in result) {
    throw new Error(`Expected a connection but received: ${JSON.stringify(result)}`);
  }
  return result;
}

beforeEach(() => {
  db().exec("DELETE FROM model_locks");
  db().exec("DELETE FROM accounts");
  setSetting("strategy", "fill-first");
  setSetting("sticky_limit", "3");
});

afterAll(() => {
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures on Windows file-lock timing.
  }
});

describe("selectAccount", () => {
  test("selects first by priority in fill-first mode and updates usage fields", () => {
    insertConnection({ id: "acc-1", priority: 1 });
    insertConnection({ id: "acc-2", priority: 2 });

    const selected = expectSelectedConnection(selectAccount("openai", null));
    expect(selected.id).toBe("acc-1");

    const updated = db()
      .query<{ consecutive_use_count: number; last_used_at: string | null }, [string]>(
        "SELECT consecutive_use_count, last_used_at FROM accounts WHERE id = ?"
      )
      .get("acc-1");
    expect(updated?.consecutive_use_count).toBe(1);
    expect(updated?.last_used_at).not.toBeNull();
  });

  test("in round-robin mode, falls back to least recently used when sticky limit is reached", () => {
    const now = Date.now();
    setSetting("strategy", "round-robin");
    setSetting("sticky_limit", "2");

    insertConnection({
      id: "acc-oldest",
      priority: 1,
      last_used_at: new Date(now - 60_000).toISOString(),
      consecutive_use_count: 1,
    });
    insertConnection({
      id: "acc-most-recent",
      priority: 2,
      last_used_at: new Date(now).toISOString(),
      consecutive_use_count: 2,
    });

    const selected = expectSelectedConnection(selectAccount("openai", null));
    expect(selected.id).toBe("acc-oldest");
  });

  test("returns allRateLimited when all active accounts are locked by model", () => {
    insertConnection({ id: "acc-1", priority: 1, error_code: 429, last_error: "Too Many Requests" });
    insertConnection({ id: "acc-2", priority: 2, error_code: 429, last_error: "rate_limit exceeded" });

    setModelLock("acc-1", "gpt-4.1", 90_000);
    setModelLock("acc-2", "gpt-4.1", 90_000);

    const result = selectAccount("openai", "gpt-4.1");
    expect(result).not.toBeNull();
    if (!result || !("allRateLimited" in result)) {
      throw new Error(`Expected rate-limited result, got: ${JSON.stringify(result)}`);
    }
    expect(result.allRateLimited).toBe(true);
    expect(result.retryAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("account availability transitions", () => {
  test("markAccountUnavailable updates account state and model lock; clearAccountError restores account", () => {
    insertConnection({ id: "acc-1", priority: 1 });

    const decision = markAccountUnavailable(
      "acc-1",
      429,
      "Too Many Requests from upstream",
      "gpt-4.1",
    );
    expect(decision.shouldFallback).toBe(true);
    expect(decision.cooldownMs).toBeGreaterThan(0);
    expect(decision.newBackoffLevel).toBe(1);

    const unavailable = db()
      .query<{ test_status: string; error_code: number | null; backoff_level: number; last_error: string | null }, [string]>(
        "SELECT test_status, error_code, backoff_level, last_error FROM accounts WHERE id = ?"
      )
      .get("acc-1");
    expect(unavailable?.test_status).toBe("unavailable");
    expect(unavailable?.error_code).toBe(429);
    expect(unavailable?.backoff_level).toBe(1);
    expect(unavailable?.last_error).toContain("Too Many Requests");

    const lockCount = db()
      .query<{ c: number }, [string, string]>(
        "SELECT COUNT(*) as c FROM model_locks WHERE account_id = ? AND model = ?"
      )
      .get("acc-1", "gpt-4.1");
    expect(lockCount?.c).toBe(1);

    clearAccountError("acc-1", "gpt-4.1");

    const recovered = db()
      .query<{ test_status: string; error_code: number | null; last_error: string | null; backoff_level: number }, [string]>(
        "SELECT test_status, error_code, last_error, backoff_level FROM accounts WHERE id = ?"
      )
      .get("acc-1");
    expect(recovered?.test_status).toBe("active");
    expect(recovered?.error_code).toBeNull();
    expect(recovered?.last_error).toBeNull();
    expect(recovered?.backoff_level).toBe(0);

    const lockAfterClear = db()
      .query<{ c: number }, [string, string]>(
        "SELECT COUNT(*) as c FROM model_locks WHERE account_id = ? AND model = ?"
      )
      .get("acc-1", "gpt-4.1");
    expect(lockAfterClear?.c).toBe(0);
  });
});
