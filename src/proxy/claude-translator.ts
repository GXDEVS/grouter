// OpenAI ↔ Anthropic/Claude translator.
// Used by: kimi-coding (api.kimi.com/coding/v1/messages) and claude (OAuth).
// Also handles /v1/messages ingress: claudeToOpenAI + openaiToClaudeResponse + openaiChunkToClaude.
// Ported from 9router/open-sse/translator/request/openai-to-claude.js +
//            9router/open-sse/translator/response/claude-to-openai.js

import type { Connection } from "../types.ts";

// ── Request: Anthropic /v1/messages → OpenAI /v1/chat/completions ────────────

function claudeContentToOpenAI(role: string, content: unknown): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];

  if (role === "assistant") {
    if (Array.isArray(content)) {
      let text = "";
      const toolCalls: Record<string, unknown>[] = [];
      let tcIdx = 0;
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === "text") text += block.text as string;
        else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id, type: "function", index: tcIdx++,
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          });
        }
      }
      const m: Record<string, unknown> = { role: "assistant", content: text || null };
      if (toolCalls.length) m.tool_calls = toolCalls;
      messages.push(m);
    } else {
      messages.push({ role: "assistant", content: typeof content === "string" ? content : "" });
    }
    return messages;
  }

  // user role
  if (Array.isArray(content)) {
    const toolResults = (content as Record<string, unknown>[]).filter(b => b.type === "tool_result");
    const other = (content as Record<string, unknown>[]).filter(b => b.type !== "tool_result");

    for (const tr of toolResults) {
      let trContent = "";
      if (typeof tr.content === "string") trContent = tr.content;
      else if (Array.isArray(tr.content)) {
        trContent = (tr.content as Record<string, unknown>[])
          .filter(b => b.type === "text").map(b => b.text as string).join("\n");
      }
      messages.push({ role: "tool", tool_call_id: tr.tool_use_id, content: trContent });
    }

    if (other.length) {
      const parts: Record<string, unknown>[] = [];
      for (const block of other) {
        if (block.type === "text" && block.text) parts.push({ type: "text", text: block.text });
        else if (block.type === "image") {
          const src = block.source as Record<string, unknown> | undefined;
          if (src?.type === "base64") parts.push({ type: "image_url", image_url: { url: `data:${src.media_type};base64,${src.data}` } });
          else if (src?.type === "url") parts.push({ type: "image_url", image_url: { url: src.url } });
        }
      }
      if (parts.length === 1 && parts[0].type === "text") messages.push({ role: "user", content: parts[0].text as string });
      else if (parts.length > 0) messages.push({ role: "user", content: parts });
    }
  } else {
    messages.push({ role: "user", content: typeof content === "string" ? content : "" });
  }

  return messages;
}

export function claudeToOpenAI(body: Record<string, unknown>): Record<string, unknown> {
  const msgs: Record<string, unknown>[] = [];

  const system = body.system;
  if (system) {
    let text = "";
    if (typeof system === "string") text = system;
    else if (Array.isArray(system)) {
      text = (system as Record<string, unknown>[]).filter(b => b.type === "text").map(b => b.text as string).join("\n");
    }
    if (text) msgs.push({ role: "system", content: text });
  }

  for (const msg of (body.messages ?? []) as Record<string, unknown>[]) {
    msgs.push(...claudeContentToOpenAI(msg.role as string, msg.content));
  }

  const result: Record<string, unknown> = {
    model: body.model,
    messages: msgs,
    max_tokens: body.max_tokens ?? 8192,
  };

  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.stream !== undefined) result.stream = body.stream;

  if (Array.isArray(body.tools) && (body.tools as unknown[]).length) {
    result.tools = (body.tools as Record<string, unknown>[]).map(t => ({
      type: "function",
      function: { name: t.name, description: t.description ?? "", parameters: t.input_schema ?? { type: "object", properties: {} } },
    }));
  }

  if (body.tool_choice) {
    const tc = body.tool_choice as Record<string, unknown>;
    if (tc.type === "auto") result.tool_choice = "auto";
    else if (tc.type === "any") result.tool_choice = "required";
    else if (tc.type === "none") result.tool_choice = "none";
    else if (tc.type === "tool" && tc.name) result.tool_choice = { type: "function", function: { name: tc.name } };
  }

  return result;
}

// ── Response: OpenAI → Anthropic Message (non-stream) ────────────────────────

export function openaiToClaudeResponse(data: Record<string, unknown>): Record<string, unknown> {
  const choice = ((data.choices as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
  const message = (choice?.message ?? {}) as Record<string, unknown>;

  const content: Record<string, unknown>[] = [];
  if (message.content && typeof message.content === "string") content.push({ type: "text", text: message.content });
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls as Record<string, unknown>[]) {
      const fn = tc.function as Record<string, unknown> | undefined;
      content.push({ type: "tool_use", id: tc.id, name: fn?.name, input: tryJSON(fn?.arguments as string ?? "{}") });
    }
  }

  const fr = choice?.finish_reason as string | undefined;
  const stopReason = fr === "tool_calls" ? "tool_use" : fr === "length" ? "max_tokens" : "end_turn";
  const usage = data.usage as Record<string, number> | undefined;

  return {
    id: data.id ?? `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: data.model ?? "unknown",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: usage?.prompt_tokens ?? 0, output_tokens: usage?.completion_tokens ?? 0 },
  };
}

// ── Response: OpenAI SSE → Anthropic SSE (stream) ────────────────────────────

export interface OpenAIToClaudeStreamState {
  messageId: string;
  model: string;
  blockIndex: number;
  toolBlockMap: Map<number, number>;
  textStarted: boolean;
  toolBlocksClosed: boolean;
  usage: Record<string, number> | null;
}

export function newOpenAIToClaudeStreamState(): OpenAIToClaudeStreamState {
  return { messageId: "", model: "", blockIndex: 0, toolBlockMap: new Map(), textStarted: false, toolBlocksClosed: false, usage: null };
}

function sseClaudeEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

export function openaiChunkToClaude(line: string, state: OpenAIToClaudeStreamState): string[] {
  if (!line.startsWith("data: ")) return [];
  const jsonStr = line.slice(6).trim();

  if (jsonStr === "[DONE]") {
    const results: string[] = [];
    if (state.textStarted) { results.push(sseClaudeEvent("content_block_stop", { index: 0 })); state.textStarted = false; }
    if (!state.toolBlocksClosed) {
      for (const blockIdx of state.toolBlockMap.values()) results.push(sseClaudeEvent("content_block_stop", { index: blockIdx }));
      state.toolBlocksClosed = true;
    }
    const stopReason = state.toolBlockMap.size > 0 ? "tool_use" : "end_turn";
    results.push(sseClaudeEvent("message_delta", {
      delta: { type: "message_delta", stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: state.usage?.completion_tokens ?? 0 },
    }));
    results.push(sseClaudeEvent("message_stop", {}));
    return results;
  }

  let chunk: Record<string, unknown>;
  try { chunk = JSON.parse(jsonStr) as Record<string, unknown>; } catch { return []; }

  const results: string[] = [];
  const choice = ((chunk.choices as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
  const delta = (choice?.delta ?? {}) as Record<string, unknown>;

  // Emit message_start on first chunk
  if (!state.messageId) {
    state.messageId = (chunk.id as string) ?? `msg_${Date.now()}`;
    state.model = (chunk.model as string) ?? "unknown";
    results.push(sseClaudeEvent("message_start", {
      message: {
        id: state.messageId, type: "message", role: "assistant",
        content: [], model: state.model, stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }));
  }

  // Text delta
  if (typeof delta.content === "string" && delta.content) {
    if (!state.textStarted) {
      state.textStarted = true;
      results.push(sseClaudeEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
      if (state.blockIndex < 1) state.blockIndex = 1;
    }
    results.push(sseClaudeEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: delta.content } }));
  }

  // Tool call deltas
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls as Record<string, unknown>[]) {
      const tcIndex = tc.index as number;
      const fn = tc.function as Record<string, unknown> | undefined;

      if (!state.toolBlockMap.has(tcIndex)) {
        const blockIdx = state.blockIndex++;
        state.toolBlockMap.set(tcIndex, blockIdx);
        results.push(sseClaudeEvent("content_block_start", {
          index: blockIdx,
          content_block: { type: "tool_use", id: tc.id ?? "", name: fn?.name ?? "", input: {} },
        }));
      }

      if (fn?.arguments) {
        results.push(sseClaudeEvent("content_block_delta", {
          index: state.toolBlockMap.get(tcIndex)!,
          delta: { type: "input_json_delta", partial_json: fn.arguments },
        }));
      }
    }
  }

  // Accumulate usage
  if (chunk.usage) state.usage = chunk.usage as Record<string, number>;

  // Close blocks on finish_reason
  if (choice?.finish_reason && !state.toolBlocksClosed) {
    if (state.textStarted) { results.push(sseClaudeEvent("content_block_stop", { index: 0 })); state.textStarted = false; }
    for (const blockIdx of state.toolBlockMap.values()) results.push(sseClaudeEvent("content_block_stop", { index: blockIdx }));
    state.toolBlocksClosed = true;
  }

  return results;
}

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
