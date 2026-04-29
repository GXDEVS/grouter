import { describe, test, expect } from "bun:test";
import { checkFallbackError, formatDuration } from "../src/rotator/fallback.ts";

describe("checkFallbackError", () => {
  test("401 unauthorized → should fallback without cooldown lock", () => {
    // Auth/permission failures (401/402/403) are surfaced quickly instead of
    // being converted into long cooldown locks that mask actionable errors as
    // 503 loops. They still rotate within a single request, but the account
    // is not held in a future cooldown.
    const result = checkFallbackError(401, "Unauthorized", 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(0);
  });

  test("402/403 → should fallback without cooldown lock", () => {
    for (const status of [402, 403]) {
      const result = checkFallbackError(status, "Forbidden", 0);
      expect(result.shouldFallback).toBe(true);
      expect(result.cooldownMs).toBe(0);
    }
  });

  test("413 with payload signals → should NOT fallback (client payload issue)", () => {
    // Groq and similar providers return 413 for request-too-large / context-window
    // / TPM overruns. The proxy compacts/retries the request itself instead of
    // punishing the account, so these don't trigger account cooldown.
    for (const text of [
      "Request too large for context",
      "tokens per minute requested",
      "context length exceeded",
      "Prompt is too long",
    ]) {
      const result = checkFallbackError(413, text, 0);
      expect(result.shouldFallback).toBe(false);
      expect(result.cooldownMs).toBe(0);
    }
  });

  test("413 with structured rate_limit marker → treated as rate limit", () => {
    // When the upstream payload explicitly carries a rate-limit type marker,
    // 413 is reclassified as a rate limit (still backs off exponentially).
    const result = checkFallbackError(413, '{"type":"rate_limit_exceeded"}', 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(result.newBackoffLevel).toBe(1);
  });

  test("429 rate limit → should fallback with exponential backoff", () => {
    const level0 = checkFallbackError(429, "Too Many Requests", 0);
    expect(level0.shouldFallback).toBe(true);
    expect(level0.cooldownMs).toBeGreaterThan(0);
    expect(level0.newBackoffLevel).toBe(1);

    const level1 = checkFallbackError(429, "Too Many Requests", 1);
    expect(level1.cooldownMs).toBeGreaterThan(level0.cooldownMs);
    expect(level1.newBackoffLevel).toBe(2);
  });

  test("429 backoff level is capped at max level (15)", () => {
    const result = checkFallbackError(429, "Too Many Requests", 15);
    expect(result.newBackoffLevel).toBe(15);
  });

  test("500 server error → should fallback with transient cooldown", () => {
    const result = checkFallbackError(500, "Internal Server Error", 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(5000);
  });

  test("502/503/504 → should fallback with transient cooldown", () => {
    for (const status of [502, 503, 504]) {
      const result = checkFallbackError(status, "Server Error", 0);
      expect(result.shouldFallback).toBe(true);
      expect(result.cooldownMs).toBe(5000);
    }
  });

  test("200 OK → should NOT fallback", () => {
    const result = checkFallbackError(200, "", 0);
    expect(result.shouldFallback).toBe(false);
    expect(result.cooldownMs).toBe(0);
  });

  test("400 bad request → should NOT fallback (client error, not provider issue)", () => {
    const result = checkFallbackError(400, "Bad Request", 0);
    expect(result.shouldFallback).toBe(false);
    expect(result.cooldownMs).toBe(0);
  });
});

describe("formatDuration", () => {
  test("formats seconds correctly", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(30000)).toBe("30s");
  });

  test("formats minutes correctly (uses Math.ceil)", () => {
    expect(formatDuration(60000)).toBe("1m");
    expect(formatDuration(90000)).toBe("2m"); // Math.ceil(90000/60000) = 2
    expect(formatDuration(15 * 60 * 1000)).toBe("15m");
  });

  test("formats hours correctly", () => {
    expect(formatDuration(60 * 60 * 1000)).toBe("1h");
  });
});
