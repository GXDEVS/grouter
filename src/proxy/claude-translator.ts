// OpenAI ↔ Anthropic/Claude translator.
// Used by: kimi-coding (api.kimi.com/coding/v1/messages) and claude (OAuth).
// Ported from 9router/open-sse/translator/request/openai-to-claude.js +
//            9router/open-sse/translator/response/claude-to-openai.js

import type { Connection } from "../types.ts";

// ── Request: OpenAI → Claude /v1/messages ────────────────────────────────────

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((c: { type: string; text?: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("\n");
  return "";
}

function tryJSON(s: unknown): unknown {
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return s; }
}

function contentBlocks(msg: Record<string, unknown>): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const role = msg.role as string;

  if (role === "tool") {
    blocks.push({ type: "tool_result", tool_use_id: msg.tool_call_id, content: msg.content });
    return blocks;
  }

  if (role === "user") {
    if (typeof msg.content === "string") {
      if (msg.content) blocks.push({ type: "text", text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as Record<string, unknown>[]) {
        if (part.type === "text" && part.text) blocks.push({ type: "text", text: part.text });
        else if (part.type === "image_url") {
          const url = (part.image_url as { url?: string })?.url ?? "";
          const m = url.match(/^data:([^;]+);base64,(.+)$/);
          if (m) blocks.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
          else if (url.startsWith("http")) blocks.push({ type: "image", source: { type: "url", url } });
        }
      }
    }
    return blocks;
  }

  // assistant
  if (Array.isArray(msg.content)) {
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "text" && part.text) blocks.push({ type: "text", text: part.text });
      else if (part.type === "tool_use") blocks.push({ type: "tool_use", id: part.id, name: part.name, input: part.input });
      else if (part.type === "thinking") { const { cache_control: _, ...rest } = part; blocks.push(rest); }
    }
  } else if (msg.content) {
    const t = typeof msg.content === "string" ? msg.content : extractText(msg.content);
    if (t) blocks.push({ type: "text", text: t });
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls as { type: string; id: string; function: { name: string; arguments: string } }[]) {
      if (tc.type === "function") {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: tryJSON(tc.function.arguments) });
      }
    }
  }

  return blocks;
}

export function openaiToClaude(
  model: string,
  body: Record<string, unknown>,
  stream: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    model,
    max_tokens: (body.max_tokens as number | undefined) ?? 8192,
    stream,
  };

  if (body.temperature !== undefined) result.temperature = body.temperature;

  // System
  const systemParts: string[] = [];
  const messages = (body.messages ?? []) as Record<string, unknown>[];
  for (const msg of messages) { if (msg.role === "system") systemParts.push(extractText(msg.content)); }
  if (systemParts.length) result.system = [{ type: "text", text: systemParts.join("\n") }];

  // Messages (merge consecutive same-role, separate tool_result)
  const nonSystem = messages.filter(m => m.role !== "system");
  const out: Record<string, unknown>[] = [];
  let curRole: string | undefined;
  let curParts: Record<string, unknown>[] = [];

  const flush = () => {
    if (curRole && curParts.length) { out.push({ role: curRole, content: curParts }); curParts = []; }
  };

  for (const msg of nonSystem) {
    const newRole = (msg.role === "user" || msg.role === "tool") ? "user" : "assistant";
    const blocks = contentBlocks(msg);
    const hasToolResult = blocks.some(b => b.type === "tool_result");

    if (hasToolResult) {
      flush();
      out.push({ role: "user", content: blocks.filter(b => b.type === "tool_result") });
      const other = blocks.filter(b => b.type !== "tool_result");
      if (other.length) { curRole = newRole; curParts.push(...other); }
      continue;
    }
    if (curRole !== newRole) { flush(); curRole = newRole; }
    curParts.push(...blocks);
    if (blocks.some(b => b.type === "tool_use")) flush();
  }
  flush();
  result.messages = out;

  // Tools
  if (Array.isArray(body.tools) && (body.tools as unknown[]).length) {
    result.tools = (body.tools as Record<string, unknown>[]).map(t => {
      if (t.type === "function" && t.function) {
        const fn = t.function as { name: string; description?: string; parameters?: unknown };
        return { name: fn.name, description: fn.description ?? "", input_schema: fn.parameters ?? { type: "object", properties: {} } };
      }
      return t;
    });
  }

  if (body.tool_choice) {
    const c = body.tool_choice;
    if (c === "auto" || c === "none") result.tool_choice = { type: "auto" };
    else if (c === "required") result.tool_choice = { type: "any" };
    else if (typeof c === "object" && (c as { function?: { name: string } }).function) result.tool_choice = { type: "tool", name: (c as { function: { name: string } }).function.name };
  }

  if (body.thinking) result.thinking = body.thinking;

  return result;
}

// ── Headers ──────────────────────────────────────────────────────────────────

export function buildClaudeHeaders(token: string, stream: boolean): Record<string, string> {
  return {
    "Content-Type":       "application/json",
    "Authorization":      `Bearer ${token}`,
    "Anthropic-Version":  "2023-06-01",
    "Anthropic-Beta":     "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-scope-2026-01-05",
    "Accept":             stream ? "text/event-stream" : "application/json",
  };
}

export function buildKimiCodingHeaders(token: string, stream: boolean): Record<string, string> {
  return {
    "Content-Type":       "application/json",
    "Authorization":      `Bearer ${token}`,
    "Anthropic-Version":  "2023-06-01",
    "Anthropic-Beta":     "claude-code-20250219,interleaved-thinking-2025-05-14",
    "X-Msh-Platform":    "9router",
    "X-Msh-Version":     "2.1.2",
    "X-Msh-Device-Model":`${process.platform} ${process.arch}`,
    "X-Msh-Device-Id":   `kimi-${Date.now()}`,
    "Accept":             stream ? "text/event-stream" : "application/json",
  };
}

// ── Response: Claude SSE → OpenAI SSE ────────────────────────────────────────

export interface ClaudeStreamState {
  messageId: string;
  model: string;
  toolCallIndex: number;
  toolCalls: Map<number, Record<string, unknown>>;
  inThinkingBlock: boolean;
  currentBlockIndex: number;
  usage: Record<string, number> | null;
  finishReason: string | null;
  finishReasonSent: boolean;
  serverToolBlockIndex: number;
  _pendingEvent?: string;
}

export function newClaudeStreamState(): ClaudeStreamState {
  return {
    messageId: "", model: "", toolCallIndex: 0,
    toolCalls: new Map(), inThinkingBlock: false, currentBlockIndex: -1,
    usage: null, finishReason: null, finishReasonSent: false, serverToolBlockIndex: -1,
  };
}

export function claudeChunkToOpenAI(rawLine: string, state: ClaudeStreamState): string[] {
  // Claude SSE format: "event: <type>\ndata: <json>"
  // We accumulate lines and process when we have both event + data.
  if (rawLine.startsWith("event: ")) {
    state._pendingEvent = rawLine.slice(7).trim();
    return [];
  }
  if (!rawLine.startsWith("data: ")) return [];
  const jsonStr = rawLine.slice(6).trim();
  if (!jsonStr || jsonStr === "[DONE]") return ["data: [DONE]\n\n"];

  let chunk: Record<string, unknown>;
  try { chunk = JSON.parse(jsonStr) as Record<string, unknown>; } catch { return []; }

  // If we captured an event type from the previous line, inject it
  if ((state as unknown as { _pendingEvent?: string })._pendingEvent) {
    if (!chunk.type) chunk.type = (state as unknown as { _pendingEvent?: string })._pendingEvent;
    delete (state as unknown as { _pendingEvent?: string })._pendingEvent;
  }

  const results: string[] = [];
  const event = chunk.type as string;

  function sseOut(delta: unknown, fr: string | null = null): string {
    return `data: ${JSON.stringify({
      id: `chatcmpl-${state.messageId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model,
      choices: [{ index: 0, delta, finish_reason: fr }],
    })}\n\n`;
  }

  switch (event) {
    case "message_start": {
      const msg = chunk.message as Record<string, unknown> | undefined;
      state.messageId = (msg?.id as string) ?? `msg_${Date.now()}`;
      state.model = (msg?.model as string) ?? "claude";
      state.toolCallIndex = 0;
      results.push(sseOut({ role: "assistant" }));
      break;
    }
    case "content_block_start": {
      const block = chunk.content_block as Record<string, unknown> | undefined;
      if (block?.type === "server_tool_use") { state.serverToolBlockIndex = chunk.index as number; break; }
      if (block?.type === "thinking") {
        state.inThinkingBlock = true;
        state.currentBlockIndex = chunk.index as number;
      } else if (block?.type === "tool_use") {
        const idx = state.toolCallIndex++;
        const tc = { index: idx, id: block.id, type: "function", function: { name: block.name, arguments: "" } };
        state.toolCalls.set(chunk.index as number, tc);
        results.push(sseOut({ tool_calls: [tc] }));
      }
      break;
    }
    case "content_block_delta": {
      if (chunk.index === state.serverToolBlockIndex) break;
      const delta = chunk.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && delta.text) results.push(sseOut({ content: delta.text }));
      else if (delta?.type === "thinking_delta" && delta.thinking) results.push(sseOut({ reasoning_content: delta.thinking }));
      else if (delta?.type === "input_json_delta" && delta.partial_json) {
        const tc = state.toolCalls.get(chunk.index as number);
        if (tc) {
          (tc.function as { arguments: string }).arguments += delta.partial_json as string;
          results.push(sseOut({ tool_calls: [{ index: (tc as { index: number }).index, id: tc.id, function: { arguments: delta.partial_json } }] }));
        }
      }
      break;
    }
    case "content_block_stop": {
      if (chunk.index === state.serverToolBlockIndex) { state.serverToolBlockIndex = -1; break; }
      if (state.inThinkingBlock && chunk.index === state.currentBlockIndex) state.inThinkingBlock = false;
      break;
    }
    case "message_delta": {
      const usage = chunk.usage as Record<string, number> | undefined;
      if (usage) {
        const inp = usage.input_tokens ?? 0;
        const out = usage.output_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const cacheCreate = usage.cache_creation_input_tokens ?? 0;
        state.usage = { prompt_tokens: inp + cacheRead + cacheCreate, completion_tokens: out, total_tokens: inp + cacheRead + cacheCreate + out };
      }
      const stopReason = (chunk.delta as Record<string, unknown> | undefined)?.stop_reason as string | undefined;
      if (stopReason) {
        state.finishReason = stopReason === "end_turn" ? "stop" : stopReason === "max_tokens" ? "length" : stopReason === "tool_use" ? "tool_calls" : "stop";
        const final: Record<string, unknown> = {
          id: `chatcmpl-${state.messageId}`, object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000), model: state.model,
          choices: [{ index: 0, delta: {}, finish_reason: state.finishReason }],
        };
        if (state.usage) final.usage = state.usage;
        results.push(`data: ${JSON.stringify(final)}\n\n`);
        state.finishReasonSent = true;
      }
      break;
    }
    case "message_stop": {
      if (!state.finishReasonSent) {
        const fr = state.finishReason ?? (state.toolCalls.size > 0 ? "tool_calls" : "stop");
        const final: Record<string, unknown> = {
          id: `chatcmpl-${state.messageId}`, object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000), model: state.model,
          choices: [{ index: 0, delta: {}, finish_reason: fr }],
        };
        if (state.usage) final.usage = state.usage;
        results.push(`data: ${JSON.stringify(final)}\n\n`);
        state.finishReasonSent = true;
      }
      results.push("data: [DONE]\n\n");
      break;
    }
  }

  return results;
}

// ── Non-stream Claude → OpenAI ──────────────────────────────────────────────

export function translateClaudeNonStream(raw: Record<string, unknown>): Record<string, unknown> {
  const content = raw.content as Record<string, unknown>[] | undefined;
  let text = "";
  let reasoning = "";
  const toolCalls: unknown[] = [];
  let fnIdx = 0;

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "text" && block.text) text += block.text;
      else if (block.type === "thinking" && block.thinking) reasoning += block.thinking as string;
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id, index: fnIdx++, type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
      }
    }
  }

  const usage = raw.usage as Record<string, number> | undefined;
  const inp = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
  const out = usage?.output_tokens ?? 0;
  const sr = raw.stop_reason as string | undefined;
  let fr = sr === "end_turn" ? "stop" : sr === "max_tokens" ? "length" : sr === "tool_use" ? "tool_calls" : "stop";

  const message: Record<string, unknown> = { role: "assistant", content: text || null };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.length) message.tool_calls = toolCalls;

  return {
    id: `chatcmpl-${(raw.id as string) ?? Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: (raw.model as string) ?? "claude",
    choices: [{ index: 0, message, finish_reason: fr }],
    usage: { prompt_tokens: inp, completion_tokens: out, total_tokens: inp + out },
  };
}
