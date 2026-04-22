import { describe, test, expect } from "bun:test";
import type { Connection } from "../src/types.ts";
import { buildUpstream } from "../src/proxy/upstream.ts";

function buildConnection(overrides: Partial<Connection>): Connection {
  const now = new Date().toISOString();
  return {
    id: "acc-test",
    provider: "openrouter",
    auth_type: "apikey",
    email: null,
    display_name: "Test Account",
    access_token: "",
    refresh_token: "",
    expires_at: now,
    resource_url: null,
    api_key: "sk-test",
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
    ...overrides,
  };
}

describe("buildUpstream", () => {
  test("maps OpenRouter API key requests and normalizes max_output_tokens", () => {
    const result = buildUpstream({
      account: buildConnection({ provider: "openrouter", api_key: "sk-openrouter" }),
      body: { model: "openai/gpt-4o", messages: [], max_output_tokens: 77 },
      stream: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.req.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(result.req.headers.Authorization).toBe("Bearer sk-openrouter");
    expect(result.req.body.max_tokens).toBe(77);
    expect(result.req.body.max_output_tokens).toBeUndefined();
    expect(result.req.body.stream_options).toEqual({ include_usage: true });
  });

  test("strips unsupported OpenAI extra fields for strict compat providers", () => {
    const result = buildUpstream({
      account: buildConnection({ provider: "cerebras", api_key: "sk-cerebras" }),
      body: {
        model: "llama3.1-8b",
        messages: [],
        store: true,
        metadata: { x: 1 },
        service_tier: "default",
        logprobs: true,
        top_logprobs: 5,
        logit_bias: { "1": 100 },
      },
      stream: false,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.req.url).toBe("https://api.cerebras.ai/v1/chat/completions");
    expect(result.req.body.store).toBeUndefined();
    expect(result.req.body.metadata).toBeUndefined();
    expect(result.req.body.service_tier).toBeUndefined();
    expect(result.req.body.logprobs).toBeUndefined();
    expect(result.req.body.top_logprobs).toBeUndefined();
    expect(result.req.body.logit_bias).toBeUndefined();
  });

  test("maps Anthropic API key provider to Claude /v1/messages", () => {
    const result = buildUpstream({
      account: buildConnection({ provider: "anthropic", api_key: "sk-anthropic" }),
      body: { model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hello" }] },
      stream: false,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.format).toBe("claude");
    expect(result.req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(result.req.headers["x-api-key"]).toBe("sk-anthropic");
    expect(result.req.headers.Authorization).toBe("");
  });

  test("returns unsupported for GitHub OAuth account missing Copilot token", () => {
    const result = buildUpstream({
      account: buildConnection({
        provider: "github",
        auth_type: "oauth",
        access_token: "oauth-token",
        api_key: null,
        provider_data: null,
      }),
      body: { model: "gpt-5", messages: [] },
      stream: false,
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("Copilot token missing");
  });

  test("adds ChatGPT-Account-ID header for Codex when account id is available", () => {
    const result = buildUpstream({
      account: buildConnection({
        provider: "codex",
        auth_type: "oauth",
        access_token: "oauth-token",
        api_key: null,
        provider_data: JSON.stringify({ accountId: "acct_123" }),
      }),
      body: { model: "gpt-5.4", messages: [{ role: "user", content: "ping" }] },
      stream: false,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.format).toBe("codex");
    expect(result.req.url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(result.req.headers["ChatGPT-Account-ID"]).toBe("acct_123");
    expect(result.req.body.stream).toBe(false);
  });
});

