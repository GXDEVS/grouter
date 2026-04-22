import { describe, test, expect } from "bun:test";
import {
  buildQwenHeaders,
  buildQwenUrl,
  buildQwenApiBase,
  qwenUserAgent,
  estimateCostUSD,
  QWEN_MODELS_OAUTH,
  QWEN_SYSTEM_MSG,
  TOKEN_EXPIRY_BUFFER_MS,
  COOLDOWN_UNAUTHORIZED_MS,
  COOLDOWN_PAYMENT_MS,
  COOLDOWN_TRANSIENT_MS,
  RATE_LIMIT_BACKOFF_BASE_MS,
  RATE_LIMIT_BACKOFF_MAX_MS,
  RATE_LIMIT_BACKOFF_MAX_LEVEL,
} from "../src/constants.ts";

describe("Qwen headers", () => {
  test("buildQwenHeaders includes required stainless headers", () => {
    const headers = buildQwenHeaders("test-token", true);
    expect(headers["Authorization"]).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Accept"]).toBe("text/event-stream");
    expect(headers["X-Stainless-Runtime"]).toBe("node");
    expect(headers["X-Stainless-Lang"]).toBe("js");
    expect(headers["X-DashScope-AuthType"]).toBe("qwen-oauth");
  });

  test("buildQwenHeaders non-stream uses application/json Accept", () => {
    const headers = buildQwenHeaders("test-token", false);
    expect(headers["Accept"]).toBe("application/json");
  });

  test("qwenUserAgent has correct format", () => {
    const ua = qwenUserAgent();
    expect(ua).toMatch(/^QwenCode\/\d+\.\d+\.\d+ \(/);
  });
});

describe("Qwen URL builders", () => {
  test("buildQwenApiBase with null returns default", () => {
    expect(buildQwenApiBase(null)).toBe("https://portal.qwen.ai/v1");
  });

  test("buildQwenApiBase with custom URL", () => {
    expect(buildQwenApiBase("https://custom.api.com/v1")).toBe("https://custom.api.com/v1");
  });

  test("buildQwenApiBase strips trailing slash", () => {
    expect(buildQwenApiBase("https://custom.api.com/v1/")).toBe("https://custom.api.com/v1");
  });

  test("buildQwenUrl produces completions endpoint", () => {
    expect(buildQwenUrl(null)).toBe("https://portal.qwen.ai/v1/chat/completions");
  });
});

describe("Constants values", () => {
  test("TOKEN_EXPIRY_BUFFER_MS is 5 minutes", () => {
    expect(TOKEN_EXPIRY_BUFFER_MS).toBe(5 * 60 * 1000);
  });

  test("COOLDOWN_UNAUTHORIZED_MS is 15 minutes", () => {
    expect(COOLDOWN_UNAUTHORIZED_MS).toBe(15 * 60 * 1000);
  });

  test("COOLDOWN_PAYMENT_MS is 1 hour", () => {
    expect(COOLDOWN_PAYMENT_MS).toBe(60 * 60 * 1000);
  });

  test("COOLDOWN_TRANSIENT_MS is 5 seconds", () => {
    expect(COOLDOWN_TRANSIENT_MS).toBe(5000);
  });

  test("Rate limit backoff has sane bounds", () => {
    expect(RATE_LIMIT_BACKOFF_BASE_MS).toBe(1000);
    expect(RATE_LIMIT_BACKOFF_MAX_MS).toBe(120000);
    expect(RATE_LIMIT_BACKOFF_MAX_LEVEL).toBe(15);
  });

  test("QWEN_MODELS_OAUTH contains expected models", () => {
    expect(QWEN_MODELS_OAUTH).toBeInstanceOf(Array);
    expect(QWEN_MODELS_OAUTH.length).toBeGreaterThan(0);
    expect(QWEN_MODELS_OAUTH).toContain("qwen3-coder-plus");
  });

  test("QWEN_SYSTEM_MSG has correct shape", () => {
    expect(QWEN_SYSTEM_MSG.role).toBe("system");
    expect(QWEN_SYSTEM_MSG.content).toBeInstanceOf(Array);
  });
});

describe("estimateCostUSD", () => {
  test("returns 0 for zero tokens", () => {
    expect(estimateCostUSD("qwen3-coder-plus", 0, 0)).toBe(0);
  });

  test("returns positive cost for non-zero tokens", () => {
    const cost = estimateCostUSD("qwen3-coder-plus", 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  test("uses default pricing for unknown models", () => {
    const cost = estimateCostUSD("unknown-model", 1_000_000, 1_000_000);
    expect(cost).toBeGreaterThan(0);
  });
});
