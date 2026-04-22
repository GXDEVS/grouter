// Per-provider upstream URL + headers + body transformer.
// Centralises everything that used to be Qwen-specific in server.ts so each
// provider can have its own dispatch rules (mirrors 9router's executors).
// Also supports dynamic fallback for custom providers via registry baseUrl.
//
// Coverage:
//   ✅ openai-compat  — qwen, iflow, qoder, github (Copilot), kilocode, opencode,
//                       cline, openrouter, openai (apikey), groq, deepseek, nvidia, ollama,
//                       gemini (apikey via /v1beta/openai/), gitlab (apikey or OAuth Bearer),
//                       github-models, sambanova.
//   ⚠️ claude-format   — claude (OAuth), anthropic (apikey), kimi-coding.
//                       Needs OpenAI→Anthropic translator. Returns 501 for now.
//   ⚠️ codex-responses — codex. Uses /responses endpoint, needs translator.
//   ⚠️ kiro            — AWS CodeWhisperer event-stream binary. Needs translator.
//   ⚠️ cursor          — Connect-RPC over proto. Needs translator.

import { arch } from "node:os";
import type { Connection } from "../types.ts";
import { parseProviderData, decodeJwtPayload, mapPlatformOs } from "../utils.ts";
import { buildQwenHeaders, buildQwenUrl, QWEN_SYSTEM_MSG } from "../constants.ts";
import { getProvider } from "../providers/registry.ts";
import {
  openaiToClaude,
  buildClaudeHeaders,
  buildKimiCodingHeaders,
} from "./claude-translator.ts";
import { openaiToCodexResponses } from "./codex-translator.ts";
import { openaiToGemini } from "./gemini-translator.ts";

export interface UpstreamRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export type UpstreamResult =
  | { kind: "ok"; req: UpstreamRequest; format?: string }
  | { kind: "unsupported"; reason: string };

interface BuildContext {
  account: Connection;
  body: Record<string, unknown>;
  stream: boolean;
}



function extractCodexAccountId(token: string, providerData: Record<string, unknown> | null): string | null {
  const fromProviderData = typeof providerData?.accountId === "string" ? providerData.accountId : null;
  if (fromProviderData) return fromProviderData;

  const idToken = typeof providerData?.idToken === "string" ? providerData.idToken : null;
  const idTokenPayload = idToken ? decodeJwtPayload(idToken) : null;
  const idTokenAuthClaim = idTokenPayload?.["https://api.openai.com/auth"];
  if (idTokenAuthClaim && typeof idTokenAuthClaim === "object") {
    const rec = idTokenAuthClaim as Record<string, unknown>;
    if (typeof rec.chatgpt_account_id === "string") return rec.chatgpt_account_id;
    if (typeof rec.account_id === "string") return rec.account_id;
  }

  const accessPayload = decodeJwtPayload(token);
  const accessAuthClaim = accessPayload?.["https://api.openai.com/auth"];
  if (accessAuthClaim && typeof accessAuthClaim === "object") {
    const rec = accessAuthClaim as Record<string, unknown>;
    if (typeof rec.chatgpt_account_id === "string") return rec.chatgpt_account_id;
    if (typeof rec.account_id === "string") return rec.account_id;
  }

  return null;
}



// ── Header helpers ───────────────────────────────────────────────────────────



function buildCopilotHeaders(copilotToken: string, stream: boolean): Record<string, string> {
  return {
    "Content-Type":                       "application/json",
    "Authorization":                      `Bearer ${copilotToken}`,
    "Accept":                             stream ? "text/event-stream" : "application/json",
    "copilot-integration-id":             "vscode-chat",
    "editor-version":                     "vscode/1.110.0",
    "editor-plugin-version":              "copilot-chat/0.38.0",
    "user-agent":                         "GitHubCopilotChat/0.38.0",
    "openai-intent":                      "conversation-panel",
    "x-github-api-version":               "2025-04-01",
    "x-vscode-user-agent-library-version":"electron-fetch",
    "X-Initiator":                        "user",
  };
}

// Fields that some stricter OpenAI-compat providers reject
const OPENAI_EXTRA_FIELDS = ["store", "metadata", "service_tier", "logprobs", "top_logprobs", "logit_bias"];

// Providers that don't accept OpenAI-specific extra fields
const STRICT_COMPAT_PROVIDERS = new Set(["cerebras", "mistral", "together", "chutes", "huggingface", "sambanova"]);

function stripExtraFields(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  for (const field of OPENAI_EXTRA_FIELDS) delete out[field];
  return out;
}

function openaiCompat(
  url: string,
  token: string,
  body: Record<string, unknown>,
  stream: boolean,
  extraHeaders: Record<string, string> = {},
  strict = false,
): UpstreamRequest {
  const out: Record<string, unknown> = strict ? stripExtraFields(body) : { ...body };
  // Some clients send Responses-style token caps to /chat/completions.
  // Normalize to chat-completions-compatible fields before forwarding.
  const maxOutput = out.max_output_tokens;
  if (typeof maxOutput === "number" && Number.isFinite(maxOutput) && maxOutput > 0) {
    if (typeof out.max_tokens !== "number" && typeof out.max_completion_tokens !== "number") {
      out.max_tokens = Math.floor(maxOutput);
    }
    delete out.max_output_tokens;
  }
  if (stream) out.stream_options = { include_usage: true };
  return {
    url,
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
      "Accept":        stream ? "text/event-stream" : "application/json",
      ...extraHeaders,
    },
    body: out,
  };
}

// ── Provider-specific builders ────────────────────────────────────────────────

function buildQwen(ctx: BuildContext): UpstreamRequest {
  const body: Record<string, unknown> = { ...ctx.body, messages: [QWEN_SYSTEM_MSG, ...((ctx.body.messages as unknown[]) ?? [])] };
  if (ctx.stream) body.stream_options = { include_usage: true };
  return {
    url:     buildQwenUrl(ctx.account.resource_url),
    headers: buildQwenHeaders(ctx.account.access_token, ctx.stream),
    body,
  };
}

function resolveCodexResponsesUrl(baseUrl: string | null | undefined): string {
  const base = (baseUrl ?? "https://chatgpt.com/backend-api/codex").replace(/\/$/, "");
  return base.endsWith("/responses") ? base : `${base}/responses`;
}

function buildCodexHeaders(token: string, accountId: string | null, stream: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "Accept": stream ? "text/event-stream" : "application/json",
    "originator": "codex_cli_rs",
    "User-Agent": `codex_cli_rs/0.0.1 (${mapPlatformOs()}; ${arch()})`,
  };
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;
  return headers;
}

function buildGithub(ctx: BuildContext): UpstreamResult {
  // GitHub Copilot uses a short-lived copilotToken fetched from copilot_internal/v2/token.
  // We stored it in provider_data on the first exchange; if missing, refresh via /copilot_internal.
  const pd = parseProviderData(ctx.account.provider_data);
  const copilotToken = pd?.copilotToken as string | undefined;
  if (!copilotToken) {
    return { kind: "unsupported", reason: "Copilot token missing — reconnect GitHub Copilot via the dashboard." };
  }
  const body: Record<string, unknown> = { ...ctx.body };
  if (ctx.stream) body.stream_options = { include_usage: true };
  return {
    kind: "ok",
    req: {
      url:     "https://api.githubcopilot.com/chat/completions",
      headers: buildCopilotHeaders(copilotToken, ctx.stream),
      body,
    },
  };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export function buildUpstream(ctx: BuildContext): UpstreamResult {
  const provider = ctx.account.provider;

  // API key providers → plain OpenAI-compat
  if (ctx.account.auth_type === "apikey") {
    const apiKey = ctx.account.api_key ?? "";
    if (provider === "github-models") {
      return {
        kind: "ok",
        req: openaiCompat(
          "https://models.github.ai/inference/chat/completions",
          apiKey,
          ctx.body,
          ctx.stream,
          {
            "X-GitHub-Api-Version": "2022-11-28",
            Accept: ctx.stream ? "text/event-stream" : "application/vnd.github+json",
          },
        ),
      };
    }
    const urls: Record<string, string> = {
      openrouter: "https://openrouter.ai/api/v1/chat/completions",
      openai:     "https://api.openai.com/v1/chat/completions",
      groq:       "https://api.groq.com/openai/v1/chat/completions",
      deepseek:   "https://api.deepseek.com/v1/chat/completions",
      nvidia:     "https://integrate.api.nvidia.com/v1/chat/completions",
      ollama:     "https://ollama.com/v1/chat/completions",
      gemini:     "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      modal:      "https://api.us-west-2.modal.direct/v1/chat/completions",
      sambanova:  "https://api.sambanova.ai/v1/chat/completions",
    };
    const url = urls[provider];
    if (url) {
      return { kind: "ok", req: openaiCompat(url, apiKey, ctx.body, ctx.stream) };
    }
    // Anthropic API-key — translate to Claude /v1/messages format
    if (provider === "anthropic") {
      const model = (ctx.body.model as string) ?? "claude-sonnet-4-6";
      return {
        kind: "ok",
        req: {
          url:     "https://api.anthropic.com/v1/messages",
          headers: { ...buildClaudeHeaders("", ctx.stream), "x-api-key": apiKey, Authorization: "" },
          body:    openaiToClaude(model, ctx.body, ctx.stream),
        },
        format: "claude",
      };
    }
    // Dynamic fallback: use baseUrl from registry (for custom providers etc.)
    const def = getProvider(provider);
    if (def?.baseUrl) {
      const base = def.baseUrl.replace(/\/$/, "");
      const dynamicUrl = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
      const strict = STRICT_COMPAT_PROVIDERS.has(provider);
      return { kind: "ok", req: openaiCompat(dynamicUrl, apiKey, ctx.body, ctx.stream, {}, strict) };
    }
    return { kind: "unsupported", reason: `No upstream mapping for provider ${provider}` };
  }

  // OAuth providers — dispatch per id
  const token = ctx.account.access_token;
  switch (provider) {
    case "qwen":
      return { kind: "ok", req: buildQwen(ctx) };

    case "iflow": {
      // iFlow OAuth yields a long-lived apiKey stored in api_key column
      const key = ctx.account.api_key || token;
      return {
        kind: "ok",
        req: openaiCompat("https://apis.iflow.cn/v1/chat/completions", key, ctx.body, ctx.stream, {
          "User-Agent": "iFlow-Cli",
        }),
      };
    }

    case "qoder": {
      const key = ctx.account.api_key || token;
      return {
        kind: "ok",
        req: openaiCompat("https://api.qoder.com/v1/chat/completions", key, ctx.body, ctx.stream, {
          "User-Agent": "Qoder-Cli",
        }),
      };
    }

    case "kilocode": {
      const pd = parseProviderData(ctx.account.provider_data);
      const extra: Record<string, string> = {};
      if (pd?.orgId) extra["X-Kilocode-OrganizationID"] = pd.orgId as string;
      return {
        kind: "ok",
        req: openaiCompat("https://api.kilo.ai/api/openrouter/chat/completions", token, ctx.body, ctx.stream, extra),
      };
    }

    case "opencode":
      return {
        kind: "ok",
        req: openaiCompat("https://opencode.ai/zen/v1/chat/completions", token || "public", ctx.body, ctx.stream),
      };

    case "cline":
      return {
        kind: "ok",
        req: openaiCompat("https://api.cline.bot/api/v1/chat/completions", token, ctx.body, ctx.stream),
      };

    case "gitlab":
      return {
        kind: "ok",
        req: openaiCompat("https://gitlab.com/api/v4/chat/completions", token, ctx.body, ctx.stream),
      };

    case "github":
      return buildGithub(ctx);

    // ── Formats that need translation (501 for now) ───────────────────────
    case "claude": {
      const model = (ctx.body.model as string) ?? "claude-sonnet-4-6";
      return {
        kind: "ok",
        req: {
          url:     "https://api.anthropic.com/v1/messages",
          headers: buildClaudeHeaders(token, ctx.stream),
          body:    openaiToClaude(model, ctx.body, ctx.stream),
        },
        format: "claude",
      };
    }

    case "kimi-coding": {
      const model = (ctx.body.model as string) ?? "kimi-k2.5";
      return {
        kind: "ok",
        req: {
          url:     "https://api.kimi.com/coding/v1/messages",
          headers: buildKimiCodingHeaders(token, ctx.stream),
          body:    openaiToClaude(model, ctx.body, ctx.stream),
        },
        format: "claude",
      };
    }

    case "gemini-cli": {
      const model = (ctx.body.model as string) ?? "gemini-2.5-flash";
      const pd = parseProviderData(ctx.account.provider_data);
      const project = (pd?.cloudProject as string | undefined) ?? null;
      const path = ctx.stream ? ":streamGenerateContent?alt=sse" : ":generateContent";
      return {
        kind: "ok",
        req: {
          url:     `https://cloudcode-pa.googleapis.com/v1internal${path}`,
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${token}`,
            Accept:          ctx.stream ? "text/event-stream" : "application/json",
          },
          body:    openaiToGemini(model, ctx.body, project),
        },
        format: "gemini",
      };
    }

    case "codex": {
      const pd = parseProviderData(ctx.account.provider_data);
      const accountId = extractCodexAccountId(token, pd);
      return {
        kind: "ok",
        req: {
          url: resolveCodexResponsesUrl(getProvider("codex")?.baseUrl ?? null),
          headers: buildCodexHeaders(token, accountId, ctx.stream),
          body: openaiToCodexResponses(ctx.body, ctx.stream),
        },
        format: "codex",
      };
    }
    case "kiro":
      return { kind: "unsupported", reason: "Kiro uses AWS CodeWhisperer's event-stream format. The translator is not yet implemented." };
    case "cursor":
      return { kind: "unsupported", reason: "Cursor uses a Connect-RPC proto format. The translator is not yet implemented." };
  }

  return { kind: "unsupported", reason: `No upstream dispatch for provider "${provider}"` };
}
