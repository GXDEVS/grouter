// Anthropic /v1/messages endpoint.
//
// Strategy: double-translation. The incoming Anthropic Messages body is
// converted to OpenAI chat.completions, handed off to handleChatCompletions
// (which carries all the rotation/timeout/retry/fallback logic), then the
// OpenAI response is translated back to Anthropic shape on the way out.
//
// The translators (claudeToOpenAI, openaiToClaudeResponse, openaiChunkToClaude)
// live in claude-translator.ts.

import {
  claudeToOpenAI,
  newOpenAIToClaudeStreamState,
  openaiChunkToClaude,
  openaiToClaudeResponse,
} from "./claude-translator.ts";
import { handleChatCompletions } from "./chat-handler.ts";
import { corsHeaders, jsonResponse, logReq } from "./server-helpers.ts";

export async function handleMessages(req: Request, pinnedProvider?: string): Promise<Response> {
  const start = Date.now();

  let anthropicBody: Record<string, unknown>;
  try {
    anthropicBody = (await req.json()) as Record<string, unknown>;
  } catch {
    logReq("POST", "/v1/messages", 400, Date.now() - start);
    return jsonResponse({ error: { message: "Invalid JSON body", type: "invalid_request_error", code: 400 } }, 400);
  }

  const stream = anthropicBody.stream === true;
  const openaiBody = claudeToOpenAI(anthropicBody);
  if (stream) openaiBody.stream = true;

  // Forward to chat completions with the translated body. We rebuild the
  // Request so the inner handler reads the OpenAI shape, but keep the same
  // method/headers/signal so client-cancel propagation, Authorization, and
  // any other relevant headers survive the indirection.
  const innerHeaders = new Headers(req.headers);
  innerHeaders.set("Content-Type", "application/json");
  innerHeaders.delete("Content-Length");
  const innerReq = new Request(req.url, {
    method: "POST",
    headers: innerHeaders,
    body: JSON.stringify(openaiBody),
    signal: req.signal,
  });

  const innerResp = await handleChatCompletions(innerReq, pinnedProvider);

  // Pass through non-200 errors as-is; the inner handler already shaped them.
  if (!innerResp.ok) return innerResp;

  if (stream) return wrapStreamResponse(innerResp, anthropicBody);
  return await wrapJsonResponse(innerResp);
}

async function wrapJsonResponse(innerResp: Response): Promise<Response> {
  const openaiData = (await innerResp.json()) as Record<string, unknown>;
  const anthropicResp = openaiToClaudeResponse(openaiData);
  return jsonResponse(anthropicResp);
}

function wrapStreamResponse(innerResp: Response, anthropicBody: Record<string, unknown>): Response {
  if (!innerResp.body) {
    return jsonResponse({
      error: { message: "Upstream returned an empty body for stream request", type: "upstream_invalid_response", code: 502 },
    }, 502);
  }

  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const state = newOpenAIToClaudeStreamState();
  // Pre-seed the state model from the request so message_start has a useful
  // value even if upstream chunks omit `model`.
  if (typeof anthropicBody.model === "string") state.model = anthropicBody.model;

  let lineBuf = "";

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      lineBuf += dec.decode(chunk, { stream: true });
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (!line.trim()) continue;
        for (const out of openaiChunkToClaude(line, state)) {
          ctrl.enqueue(enc.encode(out));
        }
      }
    },
    flush(ctrl) {
      const remaining = dec.decode();
      if (remaining) lineBuf += remaining;
      if (lineBuf.trim()) {
        const trailing = lineBuf.endsWith("\r") ? lineBuf.slice(0, -1) : lineBuf;
        for (const out of openaiChunkToClaude(trailing, state)) {
          ctrl.enqueue(enc.encode(out));
        }
      }
      // If upstream finished without emitting [DONE], synthesise the closing
      // Anthropic events so clients don't hang.
      if (!state.toolBlocksClosed) {
        for (const out of openaiChunkToClaude("data: [DONE]", state)) {
          ctrl.enqueue(enc.encode(out));
        }
      }
    },
  });

  innerResp.body.pipeTo(transform.writable).catch(() => {});

  return new Response(transform.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...corsHeaders(),
    },
  });
}
