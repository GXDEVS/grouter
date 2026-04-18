// Per-provider upstream URL + headers + body transformer.
// Centralises everything that used to be Qwen-specific in server.ts so each
// provider can have its own dispatch rules (mirrors 9router's executors).
//
// Coverage:
//   ✅ openai-compat  — qwen, iflow, qoder, github (Copilot), kilocode, opencode,
//                       cline, openrouter, openai (apikey), groq, deepseek, nvidia, ollama,
//                       gemini (apikey via /v1beta/openai/), gitlab (apikey or OAuth Bearer).
//   ⚠️ claude-format   — claude (OAuth), anthropic (apikey), kimi-coding.
//                       Needs OpenAI→Anthropic translator. Returns 501 for now.
//   ⚠️ codex-responses — codex. Uses /responses endpoint, needs translator.
//   ⚠️ kiro            — AWS CodeWhisperer event-stream binary. Needs translator.
//   ⚠️ cursor          — Connect-RPC over proto. Needs translator.

import { platform, arch } from "node:os";
import type { Connection } from "../types.ts";
import { buildQwenHeaders, buildQwenUrl, QWEN_SYSTEM_MSG } from "../constants.ts";
import {
  openaiToClaude,
  buildClaudeHeaders,
  buildKimiCodingHeaders,
} from "./claude-translator.ts";

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

function parseProviderData(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}

// ── Header helpers ───────────────────────────────────────────────────────────

function mapStainlessOs(): string {
  const p = platform();
  if (p === "darwin") return "MacOS";
  if (p === "win32")  return "Windows";
  return "Linux";
}

function buildKimiHeaders(): Record<string, string> {
  return {
    "X-Msh-Platform":     "9router",
    "X-Msh-Version":      "2.1.2",
    "X-Msh-Device-Model": `${platform()} ${arch()}`,
    "X-Msh-Device-Id":    `kimi-${Date.now()}`,
  };
}

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

function openaiCompat(
  url: string,
  token: string,
  body: Record<string, unknown>,
  stream: boolean,
  extraHeaders: Record<string, string> = {},
): UpstreamRequest {
  const out: Record<string, unknown> = { ...body };
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
    const urls: Record<string, string> = {
      openrouter: "https://openrouter.ai/api/v1/chat/completions",
      openai:     "https://api.openai.com/v1/chat/completions",
      groq:       "https://api.groq.com/openai/v1/chat/completions",
      deepseek:   "https://api.deepseek.com/v1/chat/completions",
      nvidia:     "https://integrate.api.nvidia.com/v1/chat/completions",
      ollama:     "https://ollama.com/v1/chat/completions",
      gemini:     "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
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

    case "codex":
      return { kind: "unsupported", reason: "Codex OAuth uses OpenAI's /responses endpoint. The translator is not yet implemented." };
    case "kiro":
      return { kind: "unsupported", reason: "Kiro uses AWS CodeWhisperer's event-stream format. The translator is not yet implemented." };
    case "cursor":
      return { kind: "unsupported", reason: "Cursor uses a Connect-RPC proto format. The translator is not yet implemented." };
  }

  return { kind: "unsupported", reason: `No upstream dispatch for provider "${provider}"` };
}
