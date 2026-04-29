import { describe, test, expect } from "bun:test";
import type { Connection } from "../src/types.ts";
import {
  isRateLimitedResult,
  isTemporarilyUnavailableResult,
} from "../src/types.ts";

describe("Type guards", () => {
  test("isRateLimitedResult returns true for valid shape", () => {
    const result = { allRateLimited: true as const, retryAfter: "2026-01-01", retryAfterHuman: "5m" };
    expect(isRateLimitedResult(result)).toBe(true);
  });

  test("isRateLimitedResult returns false for null/undefined/primitives", () => {
    expect(isRateLimitedResult(null)).toBe(false);
    expect(isRateLimitedResult(undefined)).toBe(false);
    expect(isRateLimitedResult("string")).toBe(false);
    expect(isRateLimitedResult(42)).toBe(false);
    expect(isRateLimitedResult({})).toBe(false);
  });

  test("isTemporarilyUnavailableResult returns true for valid shape", () => {
    const result = { allTemporarilyUnavailable: true as const, retryAfter: "2026-01-01", retryAfterHuman: "30s" };
    expect(isTemporarilyUnavailableResult(result)).toBe(true);
  });

  test("isTemporarilyUnavailableResult returns false for invalid shapes", () => {
    expect(isTemporarilyUnavailableResult(null)).toBe(false);
    expect(isTemporarilyUnavailableResult({})).toBe(false);
    expect(isTemporarilyUnavailableResult({ allRateLimited: true })).toBe(false);
  });
});

describe("Connection interface shape", () => {
  test("Connection has all required fields", () => {
    const conn: Connection = {
      id: "test-id",
      provider: "qwen",
      auth_type: "oauth",
      email: "test@example.com",
      display_name: "Test",
      access_token: "token",
      refresh_token: "refresh",
      expires_at: new Date().toISOString(),
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
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(conn.provider).toBe("qwen");
    expect(conn.is_active).toBe(1);
    expect(conn.backoff_level).toBe(0);
  });
});
