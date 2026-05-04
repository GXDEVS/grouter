// OpenAI <-> AWS CodeWhisperer/Kiro translator
// Converts between OpenAI Chat Completions format and AWS CodeWhisperer streaming format,
// including tool calls (function calling) on both directions.
//
// Based on SDK: @aws/codewhisperer-streaming-client@1.0.39
// Commands: GenerateAssistantResponseCommand
// Events: ChatResponseStream (assistantResponseEvent, toolUseEvent, contextUsageEvent, ...)

import {
  CodeWhispererStreamingClient,
  GenerateAssistantResponseCommand,
  type GenerateAssistantResponseCommandInput,
  type GenerateAssistantResponseResponse,
  type ChatResponseStream,
  type ChatMessage,
  type ConversationState,
  type Tool,
  type ToolResult,
  type UserInputMessage,
  type AssistantResponseMessage,
} from "@aws/codewhisperer-streaming-client";

// ─────────────────────────────────────────────────────────────────────
// Model extraction
// ─────────────────────────────────────────────────────────────────────

export function extractKiroModel(model: string): string {
  return model.replace(/^kiro\//, "");
}

// ─────────────────────────────────────────────────────────────────────
// OpenAI tools → Kiro Tool[]
// ─────────────────────────────────────────────────────────────────────

interface OpenAITool {
  type?: string;
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
}

export function openaiToolsToKiroTools(tools: unknown): Tool[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const out: Tool[] = [];
  for (const raw of tools) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as OpenAITool;
    const name = t.function?.name;
    if (!name) continue;
    out.push({
      toolSpecification: {
        name,
        description: t.function?.description ?? "",
        inputSchema: {
          json: (t.function?.parameters ?? { type: "object", properties: {} }) as never,
        },
      },
    });
  }
  return out.length > 0 ? out : undefined;
}

// ─────────────────────────────────────────────────────────────────────
// OpenAI messages → Kiro ConversationState
// ─────────────────────────────────────────────────────────────────────

interface OpenAIMessage {
  role: string;
  content: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && typeof p === "object" && (p as Record<string, unknown>).type === "text")
      .map((p) => String((p as Record<string, unknown>).text ?? ""))
      .join("\n");
  }
  return "";
}

interface ConversionContext {
  tools?: Tool[];
  modelId?: string;
}

type Turn =
  | { kind: "user"; message: UserInputMessage }
  | { kind: "assistant"; message: AssistantResponseMessage };

export function openaiMessagesToConversationState(
  messagesIn: unknown,
  context: ConversionContext = {},
): ConversationState {
  if (!Array.isArray(messagesIn) || messagesIn.length === 0) {
    throw new Error("No messages provided");
  }

  const messages = messagesIn as OpenAIMessage[];
  const systemParts: string[] = [];
  const others: OpenAIMessage[] = [];

  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "system") {
      const text = extractText(m.content);
      if (text) systemParts.push(text);
    } else {
      others.push(m);
    }
  }

  const systemPrompt = systemParts.join("\n\n");
  const turns: Turn[] = [];
  let pendingToolResults: ToolResult[] = [];
  let userPrependedSystem = false;

  const attachToolsAndResults = (um: UserInputMessage) => {
    if (pendingToolResults.length === 0 && !context.tools) return;
    um.userInputMessageContext = {};
    if (pendingToolResults.length > 0) {
      um.userInputMessageContext.toolResults = pendingToolResults;
      pendingToolResults = [];
    }
    // Attach tools to every user turn so the model stays tool-aware across turns.
    if (context.tools) um.userInputMessageContext.tools = context.tools;
  };

  for (const msg of others) {
    if (msg.role === "tool") {
      pendingToolResults.push({
        toolUseId: msg.tool_call_id ?? "",
        // Kiro requires non-empty content; fall back to a single space.
        content: [{ text: extractText(msg.content) || " " }],
        status: "success",
      });
      continue;
    }

    if (msg.role === "user") {
      let content = extractText(msg.content);
      if (!userPrependedSystem && systemPrompt) {
        content = systemPrompt + (content ? `\n\n${content}` : "");
        userPrependedSystem = true;
      }
      const um: UserInputMessage = { content };
      attachToolsAndResults(um);
      turns.push({ kind: "user", message: um });
      continue;
    }

    if (msg.role === "assistant") {
      const arm: AssistantResponseMessage = { content: extractText(msg.content) };
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        arm.toolUses = msg.tool_calls.map((tc) => {
          let parsedInput: unknown = {};
          if (tc.function?.arguments) {
            try {
              parsedInput = JSON.parse(tc.function.arguments);
            } catch {
              // Leave as raw string fallback so debugging is possible.
              parsedInput = tc.function.arguments;
            }
          }
          return {
            toolUseId: tc.id ?? "",
            name: tc.function?.name ?? "",
            input: parsedInput as never,
          };
        });
      }
      turns.push({ kind: "assistant", message: arm });
      continue;
    }
  }

  // Trailing tool messages (no follow-up user) → synthesize a user turn that carries them.
  if (pendingToolResults.length > 0) {
    const um: UserInputMessage = { content: " " };
    attachToolsAndResults(um);
    turns.push({ kind: "user", message: um });
  }

  if (turns.length === 0) {
    if (systemPrompt) {
      const um: UserInputMessage = { content: systemPrompt };
      if (context.tools) um.userInputMessageContext = { tools: context.tools };
      turns.push({ kind: "user", message: um });
    } else {
      throw new Error("No messages provided");
    }
  }

  // Apply modelId to the last user turn (the message about to be sent).
  if (context.modelId && context.modelId !== "auto") {
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (turn && turn.kind === "user") {
        turn.message.modelId = context.modelId;
        break;
      }
    }
  }

  const last = turns[turns.length - 1]!;
  const historyTurns = turns.slice(0, -1);

  const history: ChatMessage[] = historyTurns.map((t) =>
    t.kind === "user"
      ? { userInputMessage: t.message }
      : { assistantResponseMessage: t.message },
  );
  const currentMessage: ChatMessage = last.kind === "user"
    ? { userInputMessage: last.message }
    : { assistantResponseMessage: last.message };

  const state: ConversationState = {
    chatTriggerType: "MANUAL",
    currentMessage,
  };
  if (history.length > 0) state.history = history;
  return state;
}

export function buildKiroGenerateAssistantInput(
  state: ConversationState,
): GenerateAssistantResponseCommandInput {
  return { conversationState: state };
}

// ─────────────────────────────────────────────────────────────────────
// Client creation
// ─────────────────────────────────────────────────────────────────────

export function buildKiroClient(
  token: string,
  expiresAt: string,
  region: string = "us-east-1",
): CodeWhispererStreamingClient {
  return new CodeWhispererStreamingClient({
    region,
    token: { token, expiration: new Date(expiresAt) },
    endpoint: "https://codewhisperer.us-east-1.amazonaws.com",
  });
}

// ─────────────────────────────────────────────────────────────────────
// Non-streaming response → OpenAI completion
// ─────────────────────────────────────────────────────────────────────

interface AggregatedToolUse {
  id: string;
  name: string;
  argsJson: string;
}

export function translateKiroNonStream(
  events: ChatResponseStream[],
  model: string,
): Record<string, unknown> {
  let content = "";
  let messageId = "";
  let modelId = "";
  let usage: Record<string, number> | null = null;
  const toolUses = new Map<string, AggregatedToolUse>();
  const toolUseOrder: string[] = [];

  for (const event of events) {
    if ("assistantResponseEvent" in event && event.assistantResponseEvent) {
      const evt = event.assistantResponseEvent as { content?: unknown; messageId?: unknown; modelId?: unknown };
      if (typeof evt.content === "string") content += evt.content;
      if (typeof evt.messageId === "string") messageId = evt.messageId;
      if (typeof evt.modelId === "string") modelId = evt.modelId;
    }

    if ("toolUseEvent" in event && event.toolUseEvent) {
      const evt = event.toolUseEvent as { toolUseId?: unknown; name?: unknown; input?: unknown };
      const id = typeof evt.toolUseId === "string" ? evt.toolUseId : "";
      if (!id) continue;
      let agg = toolUses.get(id);
      if (!agg) {
        agg = { id, name: typeof evt.name === "string" ? evt.name : "", argsJson: "" };
        toolUses.set(id, agg);
        toolUseOrder.push(id);
      }
      if (typeof evt.input === "string") agg.argsJson += evt.input;
      if (typeof evt.name === "string" && evt.name) agg.name = evt.name;
    }

    if ("contextUsageEvent" in event && event.contextUsageEvent) {
      const evt = event.contextUsageEvent as { tokenUsage?: { inputTokens?: number; outputTokens?: number } };
      if (evt.tokenUsage) {
        const inTok = evt.tokenUsage.inputTokens ?? 0;
        const outTok = evt.tokenUsage.outputTokens ?? 0;
        usage = { prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok };
      }
    }
  }

  const message: Record<string, unknown> = {
    role: "assistant",
    content: content || null,
  };

  if (toolUseOrder.length > 0) {
    message.tool_calls = toolUseOrder.map((id) => {
      const t = toolUses.get(id)!;
      return {
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: t.argsJson || "{}" },
      };
    });
  }

  const response: Record<string, unknown> = {
    id: `chatcmpl-kiro-${messageId || crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId || model,
    choices: [{
      index: 0,
      message,
      finish_reason: toolUseOrder.length > 0 ? "tool_calls" : "stop",
    }],
  };

  if (usage) response.usage = usage;
  return response;
}

// ─────────────────────────────────────────────────────────────────────
// High-level API
// ─────────────────────────────────────────────────────────────────────

export interface CallKiroParams {
  token: string;
  expiresAt: string;
  region?: string;
  body: Record<string, unknown>;
  model: string;
  signal?: AbortSignal;
}

function buildInputFromParams(params: CallKiroParams): GenerateAssistantResponseCommandInput {
  const messages = params.body.messages;
  const tools = openaiToolsToKiroTools(params.body.tools);
  const kiroModel = extractKiroModel(params.model);
  const state = openaiMessagesToConversationState(messages, {
    tools,
    modelId: kiroModel,
  });
  return buildKiroGenerateAssistantInput(state);
}

export async function callKiroNonStreaming(params: CallKiroParams): Promise<Record<string, unknown>> {
  const { token, expiresAt, region = "us-east-1", model, signal } = params;
  const input = buildInputFromParams(params);
  const client = buildKiroClient(token, expiresAt, region);
  const command = new GenerateAssistantResponseCommand(input);
  const response: GenerateAssistantResponseResponse = await client.send(
    command,
    signal ? { abortSignal: signal } : undefined,
  );

  const events: ChatResponseStream[] = [];
  if (response.generateAssistantResponseResponse) {
    for await (const event of response.generateAssistantResponseResponse) {
      if (signal?.aborted) break;
      events.push(event);
    }
  }
  return translateKiroNonStream(events, model);
}

// ─────────────────────────────────────────────────────────────────────
// Streaming
// ─────────────────────────────────────────────────────────────────────

export async function callKiroStreaming(params: CallKiroParams): Promise<ReadableStream<Uint8Array>> {
  const { token, expiresAt, region = "us-east-1", model, signal } = params;
  const input = buildInputFromParams(params);
  const client = buildKiroClient(token, expiresAt, region);
  const command = new GenerateAssistantResponseCommand(input);
  const response: GenerateAssistantResponseResponse = await client.send(
    command,
    signal ? { abortSignal: signal } : undefined,
  );

  const id = `chatcmpl-kiro-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const upstream = response.generateAssistantResponseResponse;
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (chunk: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      let resolvedModel = model;
      let usage: Record<string, number> | undefined;
      let emittedRole = false;
      let anyToolUse = false;
      // Tool indices are positional in OpenAI's tool_calls array.
      const toolIndex = new Map<string, number>();
      let nextIndex = 0;

      const ensureRole = () => {
        if (emittedRole) return;
        emit({
          id, object: "chat.completion.chunk", created, model: resolvedModel,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        });
        emittedRole = true;
      };

      try {
        if (upstream) {
          for await (const event of upstream) {
            if (signal?.aborted) break;

            if ("assistantResponseEvent" in event && event.assistantResponseEvent) {
              const evt = event.assistantResponseEvent as { content?: unknown; modelId?: unknown };
              if (!emittedRole && typeof evt.modelId === "string" && evt.modelId) {
                resolvedModel = evt.modelId;
              }
              ensureRole();
              if (typeof evt.content === "string" && evt.content) {
                emit({
                  id, object: "chat.completion.chunk", created, model: resolvedModel,
                  choices: [{ index: 0, delta: { content: evt.content }, finish_reason: null }],
                });
              }
            }

            if ("toolUseEvent" in event && event.toolUseEvent) {
              const evt = event.toolUseEvent as { toolUseId?: unknown; name?: unknown; input?: unknown };
              const tId = typeof evt.toolUseId === "string" ? evt.toolUseId : "";
              if (!tId) continue;
              ensureRole();
              anyToolUse = true;

              let idx = toolIndex.get(tId);
              if (idx === undefined) {
                idx = nextIndex++;
                toolIndex.set(tId, idx);
                emit({
                  id, object: "chat.completion.chunk", created, model: resolvedModel,
                  choices: [{
                    index: 0,
                    delta: {
                      tool_calls: [{
                        index: idx,
                        id: tId,
                        type: "function",
                        function: { name: typeof evt.name === "string" ? evt.name : "", arguments: "" },
                      }],
                    },
                    finish_reason: null,
                  }],
                });
              }
              if (typeof evt.input === "string" && evt.input) {
                emit({
                  id, object: "chat.completion.chunk", created, model: resolvedModel,
                  choices: [{
                    index: 0,
                    delta: {
                      tool_calls: [{ index: idx, function: { arguments: evt.input } }],
                    },
                    finish_reason: null,
                  }],
                });
              }
            }

            if ("contextUsageEvent" in event && event.contextUsageEvent) {
              const evt = event.contextUsageEvent as { tokenUsage?: { inputTokens?: number; outputTokens?: number } };
              if (evt.tokenUsage) {
                const inTok = evt.tokenUsage.inputTokens ?? 0;
                const outTok = evt.tokenUsage.outputTokens ?? 0;
                usage = { prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok };
              }
            }
          }
        }

        ensureRole();

        const finalChunk: Record<string, unknown> = {
          id, object: "chat.completion.chunk", created, model: resolvedModel,
          choices: [{ index: 0, delta: {}, finish_reason: anyToolUse ? "tool_calls" : "stop" }],
        };
        if (usage) finalChunk.usage = usage;
        emit(finalChunk);

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        try { controller.error(err); } catch { /* already closed */ }
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Misc
// ─────────────────────────────────────────────────────────────────────

export function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  };
}
