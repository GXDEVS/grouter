import chalk from "chalk";
import { getClientKey, updateClientKeyUsage } from "../db/client_keys.ts";
import { getSetting } from "../db/index.ts";
import { getProxyPoolById } from "../db/pools.ts";
import { recordUsage } from "../db/usage.ts";
import { selectAccount, markAccountUnavailable, clearAccountError } from "../rotator/index.ts";
import { checkAndRefreshAccount } from "../token/refresh.ts";
import { isRateLimitedResult, isTemporarilyUnavailableResult } from "../types.ts";
import { claudeChunkToOpenAI, newClaudeStreamState, translateClaudeNonStream } from "./claude-translator.ts";
import { codexChunkToOpenAI, newCodexStreamState, translateCodexNonStream } from "./codex-translator.ts";
import { geminiChunkToOpenAI, newGeminiStreamState, translateGeminiNonStream } from "./gemini-translator.ts";
import { MAX_RETRIES, corsHeaders, jsonResponse, logReq, parseProviderModel } from "./server-helpers.ts";
import { buildUpstream } from "./upstream.ts";

interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// Extracts usage from the tail of a streaming SSE response.
// Searches for the last `"usage":` object to avoid false positives from
// model-generated content and handles chunk fragmentation by working on
// an accumulated buffer instead of individual chunks.
function extractUsageFromSSE(tail: string): TokenUsage | null {
  const idx = tail.lastIndexOf('"usage":');
  if (idx === -1) return null;
  const slice = tail.slice(idx, idx + 256);
  const prompt = parseInt(slice.match(/"prompt_tokens"\s*:\s*(\d+)/)?.[1] ?? "0", 10);
  const completion = parseInt(slice.match(/"completion_tokens"\s*:\s*(\d+)/)?.[1] ?? "0", 10);
  const total = parseInt(slice.match(/"total_tokens"\s*:\s*(\d+)/)?.[1] ?? "0", 10) || (prompt + completion);
  if (!prompt && !completion) return null;
  return { prompt, completion, total };
}

export async function handleChatCompletions(req: Request, pinnedProvider?: string): Promise<Response> {
  const start = Date.now();
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    logReq("POST", "/v1/chat/completions", 400, Date.now() - start);
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400);
  }

  const authHeader = req.headers.get("Authorization");
  const requireAuth = getSetting("require_client_auth") === "true";
  let clientKey = null;

  if (authHeader?.startsWith("Bearer ")) {
    clientKey = getClientKey(authHeader.slice(7).trim());
  }

  if (requireAuth && !clientKey) {
    logReq("POST", "/v1/chat/completions", 401, Date.now() - start);
    return jsonResponse({ error: { message: "Unauthorized. Invalid or missing Client API Key.", type: "invalid_request_error", code: 401 } }, 401);
  }

  const rawModel = typeof body.model === "string" ? body.model : null;
  const { provider, model } = parseProviderModel(rawModel, pinnedProvider);

  if (!provider) {
    logReq("POST", "/v1/chat/completions", 400, Date.now() - start, { model: rawModel });
    return jsonResponse({
      error: {
        message: `Invalid model format: "${rawModel ?? ""}". Use "provider/model" (e.g. "anthropic/claude-sonnet-4-20250514") or send the request to a provider-specific port.`,
        type: "grouter_error",
        code: 400,
      },
    }, 400);
  }

  const stream = body.stream === true;
  const excludeIds = new Set<string>();
  let rotations = 0;
  // Normalize model in body: strip provider prefix before sending upstream.
  const normalizedBody = { ...body, model };

  let lastFetchError: { provider: string; url: string; message: string } | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const selected = selectAccount(provider, model || null, excludeIds);

    if (!selected) {
      logReq("POST", "/v1/chat/completions", 503, Date.now() - start, { model: rawModel });
      return jsonResponse({ error: { message: `No connections available for provider "${provider}"`, type: "grouter_error", code: 503 } }, 503);
    }
    if (isRateLimitedResult(selected)) {
      logReq("POST", "/v1/chat/completions", 429, Date.now() - start, { model: rawModel, rotated: rotations });
      return jsonResponse(
        { error: { message: `All accounts rate limited. ${selected.retryAfterHuman}`, type: "grouter_error", code: 429 } },
        429,
        { "Retry-After": selected.retryAfter },
      );
    }
    if (isTemporarilyUnavailableResult(selected)) {
      logReq("POST", "/v1/chat/completions", 503, Date.now() - start, { model: rawModel, rotated: rotations });
      return jsonResponse(
        { error: { message: `All accounts temporarily unavailable. ${selected.retryAfterHuman}`, type: "grouter_error", code: 503 } },
        503,
        { "Retry-After": selected.retryAfter },
      );
    }

    const label = selected.email?.split("@")[0] ?? selected.display_name ?? selected.id.slice(0, 8);
    // Build upstream request via per-provider dispatcher.
    const account = selected.auth_type === "oauth"
      ? await checkAndRefreshAccount(selected)
      : selected;

    const dispatch = buildUpstream({ account, body: normalizedBody, stream });
    if (dispatch.kind === "unsupported") {
      logReq("POST", "/v1/chat/completions", 501, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
      return jsonResponse({
        error: {
          message: dispatch.reason,
          type: "provider_not_supported",
          code: 501,
          provider,
        },
      }, 501);
    }
    const upstreamUrl = dispatch.req.url;
    const upstreamHeaders = dispatch.req.headers;
    const upstreamBody = dispatch.req.body;
    // Apply proxy pool if assigned to this connection.
    const proxyPool = selected.proxy_pool_id ? getProxyPoolById(selected.proxy_pool_id) : null;
    const fetchOptions: Record<string, unknown> = {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
    };
    if (proxyPool?.proxy_url) {
      // @ts-ignore Bun-specific proxy option
      fetchOptions.proxy = proxyPool.proxy_url;
    }

    let upstreamResp: Response;
    try {
      upstreamResp = await fetch(upstreamUrl, fetchOptions as RequestInit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastFetchError = { provider, url: upstreamUrl, message: msg };
      console.log(`  ${chalk.red("FAIL")} fetch failed -> ${chalk.cyan(label)} ${chalk.gray(upstreamUrl)} ${chalk.red(msg)}`);
      excludeIds.add(selected.id);
      rotations++;
      markAccountUnavailable(selected.id, 503, msg, model || null);
      continue;
    }

    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text();
      const { shouldFallback } = markAccountUnavailable(selected.id, upstreamResp.status, errText, model || null);
      if (shouldFallback && attempt < MAX_RETRIES - 1) {
        console.log(`  ${chalk.yellow("RETRY")} rotating away from ${chalk.cyan(label)} (${upstreamResp.status})`);
        excludeIds.add(selected.id);
        rotations++;
        continue;
      }
      logReq("POST", "/v1/chat/completions", upstreamResp.status, Date.now() - start, { model: rawModel, account: label, rotated: rotations });
      const ct = upstreamResp.headers.get("content-type") ?? "";
      if (ct.includes("json")) {
        try {
          return jsonResponse(JSON.parse(errText), upstreamResp.status);
        } catch {
          // fall through with plain text response
        }
      }
      return new Response(errText, { status: upstreamResp.status, headers: { "Content-Type": ct || "text/plain", ...corsHeaders() } });
    }

    clearAccountError(selected.id, model || null);

    if (stream) {
      const ms = Date.now() - start;
      const dec = new TextDecoder();
      const enc = new TextEncoder();
      const fmt = dispatch.format;
      const needsTranslation = fmt === "claude" || fmt === "gemini" || fmt === "codex";
      const claudeState = fmt === "claude" ? newClaudeStreamState() : null;
      const geminiState = fmt === "gemini" ? newGeminiStreamState() : null;
      const codexState = fmt === "codex" ? newCodexStreamState() : null;
      let tail = "";
      let lineBuf = "";
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          if (!needsTranslation) {
            ctrl.enqueue(chunk);
            tail += dec.decode(chunk, { stream: true });
            if (tail.length > 4096) tail = tail.slice(-4096);
          } else {
            lineBuf += dec.decode(chunk, { stream: true });
            const lines = lineBuf.split("\n");
            lineBuf = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              const translated = claudeState
                ? claudeChunkToOpenAI(trimmed, claudeState)
                : geminiState
                  ? geminiChunkToOpenAI(trimmed, geminiState)
                  : codexChunkToOpenAI(trimmed, codexState!);
              for (const out of translated) {
                ctrl.enqueue(enc.encode(out));
                tail += out;
              }
            }
            if (tail.length > 4096) tail = tail.slice(-4096);
          }
        },
        flush() {
          const stateUsage = claudeState?.usage ?? geminiState?.usage ?? null;
          const usage = needsTranslation && stateUsage
            ? {
                prompt: (stateUsage.prompt_tokens as number) ?? 0,
                completion: (stateUsage.completion_tokens as number) ?? 0,
                total: (stateUsage.total_tokens as number) ?? 0,
              }
            : extractUsageFromSSE(tail);
          logReq("POST", "/v1/chat/completions", 200, ms, { model: rawModel, account: label, rotated: rotations, tokens: usage?.total || undefined });
          if (usage) {
            recordUsage({
              account_id: selected.id,
              model: rawModel ?? "",
              prompt_tokens: usage.prompt,
              completion_tokens: usage.completion,
              total_tokens: usage.total,
            });
            if (clientKey) updateClientKeyUsage(clientKey.api_key, usage.total);
          }
        },
      });
      upstreamResp.body!.pipeTo(writable).catch(() => {});
      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          ...corsHeaders(),
        },
      });
    }

    let data = (await upstreamResp.json()) as Record<string, unknown>;
    // Translate non-stream responses to OpenAI format.
    if (dispatch.format === "claude") data = translateClaudeNonStream(data);
    else if (dispatch.format === "gemini") data = translateGeminiNonStream(data);
    else if (dispatch.format === "codex") data = translateCodexNonStream(data);

    const rawUsage = data.usage as Record<string, number> | undefined;
    const promptTok = rawUsage?.prompt_tokens ?? 0;
    const completionTok = rawUsage?.completion_tokens ?? 0;
    const totalTok = rawUsage?.total_tokens ?? (promptTok + completionTok);
    if (totalTok > 0) {
      recordUsage({
        account_id: selected.id,
        model: rawModel ?? "",
        prompt_tokens: promptTok,
        completion_tokens: completionTok,
        total_tokens: totalTok,
      });
      if (clientKey) updateClientKeyUsage(clientKey.api_key, totalTok);
    }
    logReq("POST", "/v1/chat/completions", 200, Date.now() - start, { model: rawModel, account: label, rotated: rotations, tokens: totalTok || undefined });
    return jsonResponse(data);
  }

  logReq("POST", "/v1/chat/completions", 502, Date.now() - start, { model: rawModel, rotated: rotations });
  if (lastFetchError) {
    return jsonResponse({
      error: {
        message: `Upstream fetch failed for ${lastFetchError.provider} (${lastFetchError.url}): ${lastFetchError.message}`,
        type: "upstream_unreachable",
        code: 502,
        provider: lastFetchError.provider,
      },
    }, 502);
  }
  return jsonResponse({ error: { message: "All retry attempts exhausted", type: "grouter_error", code: 503 } }, 503);
}
