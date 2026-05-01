// OpenAI <-> AWS CodeWhisperer/Kiro translator
// Converts between OpenAI Chat Completions format and AWS CodeWhisperer streaming format
//
// Based on SDK: @aws/codewhisperer-streaming-client@1.0.39
// Commands: GenerateAssistantResponseCommand, SendMessageCommand
// Events: AssistantResponseEvent (union of 17+ event types)

import {
  CodeWhispererStreamingClient,
  GenerateAssistantResponseCommand,
  type GenerateAssistantResponseRequest,
  type GenerateAssistantResponseResponse,
  type UserInputMessage,
  type ConversationState,
  type AssistantResponseEvent,
  type ChatMessage,
  type ContextUsageEvent,
  type MessageMetadataEvent,
} from "@aws/codewhisperer-streaming-client";

// ── Model Extraction ────────────────────────────────────────────────────────

/**
 * Extract Kiro model name from OpenAI model format
 * @param model - OpenAI model string (e.g., "kiro/claude-sonnet-4.5" or "claude-sonnet-4.5")
 * @returns Kiro model name (e.g., "claude-sonnet-4.5")
 */
export function extractKiroModel(model: string): string {
  // Remove "kiro/" prefix if present
  return model.replace(/^kiro\//, "");
}

// ── Request Transformation ──────────────────────────────────────────────────

/**
 * Transform OpenAI messages to Kiro conversation format
 * @param body - OpenAI Chat Completions request body
 * @returns Kiro GenerateAssistantResponseRequest
 */
export function openaiMessagesToKiroConversation(
  body: Record<string, unknown>
): GenerateAssistantResponseRequest {
  const messages = (body.messages ?? []) as Array<Record<string, unknown>>;
  
  // Extract user message (last message should be user)
  const lastMessage = messages[messages.length - 1];
  const userContent = typeof lastMessage?.content === "string" 
    ? lastMessage.content 
    : "";

  // Build conversation history (all messages except last)
  const history: ChatMessage[] = messages.slice(0, -1).map(msg => ({
    role: msg.role as string,
    content: typeof msg.content === "string" ? msg.content : "",
  }));

  // Build request
  const request: GenerateAssistantResponseRequest = {
    userInputMessage: {
      content: userContent,
    },
  };

  // Add conversation state if there's history
  if (history.length > 0) {
    request.conversationState = {
      history,
    };
  }

  // TODO: Add support for:
  // - temperature
  // - max_tokens
  // - tools
  // - model selection
  // - system messages

  return request;
}

// ── Client Creation ─────────────────────────────────────────────────────────

/**
 * Create configured CodeWhisperer client
 * @param token - OAuth access token from Grouter
 * @param region - AWS region (default: us-east-1)
 * @returns Configured client instance
 */
export function buildKiroClient(
  token: string,
  region: string = "us-east-1"
): CodeWhispererStreamingClient {
  // TODO: Determine correct authentication method
  // Option 1: Direct token (if supported)
  // Option 2: Token provider from @aws-sdk/token-providers
  // Option 3: Custom credentials provider
  
  return new CodeWhispererStreamingClient({
    region,
    credentials: {
      // Placeholder - needs testing
      accessKeyId: token,
      secretAccessKey: "not-used",
      sessionToken: token,
    },
  });
}

// ── Headers ─────────────────────────────────────────────────────────────────

/**
 * Build headers for Kiro requests
 * Note: SDK handles most headers automatically
 * @param token - OAuth access token
 * @param stream - Whether streaming is enabled
 * @returns Headers object
 */
export function buildKiroHeaders(
  token: string,
  stream: boolean
): Record<string, string> {
  // SDK handles headers automatically
  // This function may not be needed, but kept for compatibility
  return {
    "Content-Type": "application/json",
    "Accept": stream ? "application/vnd.amazon.eventstream" : "application/json",
  };
}

// ── Response Transformation (Non-Streaming) ─────────────────────────────────

/**
 * Transform Kiro response events to OpenAI completion format
 * @param events - Array of AssistantResponseEvent from Kiro
 * @param model - Model name for response
 * @returns OpenAI Chat Completion response
 */
export function translateKiroNonStream(
  events: AssistantResponseEvent[],
  model: string
): Record<string, unknown> {
  let content = "";
  let messageId = "";
  let finishReason = "stop";
  let usage: Record<string, number> | null = null;

  // Process all events
  for (const event of events) {
    // AssistantResponseMessage - contains message content
    if ("content" in event && typeof event.content === "string") {
      content += event.content;
    }
    if ("messageId" in event && typeof event.messageId === "string") {
      messageId = event.messageId;
    }

    // ContextUsageEvent - contains token usage
    if ("tokenUsage" in event && event.tokenUsage) {
      const tokenUsage = event.tokenUsage as any;
      usage = {
        prompt_tokens: tokenUsage.inputTokens ?? 0,
        completion_tokens: tokenUsage.outputTokens ?? 0,
        total_tokens: (tokenUsage.inputTokens ?? 0) + (tokenUsage.outputTokens ?? 0),
      };
    }

    // TODO: Handle other event types:
    // - CodeEvent
    // - CitationEvent
    // - ReasoningContentEvent
    // - ToolUseEvent
    // - ToolResultEvent
    // - InvalidStateEvent (errors)
  }

  return {
    id: `chatcmpl-${messageId || Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
        },
        finish_reason: finishReason,
      },
    ],
    usage: usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

// ── Response Transformation (Streaming) ─────────────────────────────────────

/**
 * Stream state for tracking Kiro event stream
 */
export interface KiroStreamState {
  messageId: string;
  model: string;
  content: string;
  finishReason: string | null;
  usage: Record<string, number> | null;
  finishReasonSent: boolean;
}

/**
 * Create new stream state
 */
export function newKiroStreamState(model: string): KiroStreamState {
  return {
    messageId: "",
    model,
    content: "",
    finishReason: null,
    usage: null,
    finishReasonSent: false,
  };
}

/**
 * Transform Kiro event to OpenAI SSE chunk(s)
 * @param event - Single AssistantResponseEvent from Kiro
 * @param state - Stream state
 * @returns Array of SSE-formatted strings
 */
export function kiroEventToOpenAI(
  event: AssistantResponseEvent,
  state: KiroStreamState
): string[] {
  const results: string[] = [];

  function sseOut(delta: unknown, fr: string | null = null): string {
    return `data: ${JSON.stringify({
      id: `chatcmpl-${state.messageId || Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model,
      choices: [{ index: 0, delta, finish_reason: fr }],
    })}\n\n`;
  }

  // AssistantResponseMessage - message content
  if ("content" in event && typeof event.content === "string") {
    if (!state.messageId && "messageId" in event) {
      state.messageId = event.messageId as string;
      results.push(sseOut({ role: "assistant" }));
    }
    if (event.content) {
      state.content += event.content;
      results.push(sseOut({ content: event.content }));
    }
  }

  // ContextUsageEvent - token usage
  if ("tokenUsage" in event && event.tokenUsage) {
    const tokenUsage = event.tokenUsage as any;
    state.usage = {
      prompt_tokens: tokenUsage.inputTokens ?? 0,
      completion_tokens: tokenUsage.outputTokens ?? 0,
      total_tokens: (tokenUsage.inputTokens ?? 0) + (tokenUsage.outputTokens ?? 0),
    };
  }

  // MessageMetadataEvent - may contain finish signal
  if ("messageId" in event && !state.messageId) {
    state.messageId = event.messageId as string;
  }

  // TODO: Handle other event types:
  // - CodeEvent
  // - CitationEvent
  // - ReasoningContentEvent
  // - ToolUseEvent
  // - ToolResultEvent
  // - InvalidStateEvent (errors)
  // - End of stream detection

  return results;
}

/**
 * Generate final SSE chunk with finish_reason and usage
 */
export function kiroStreamFinish(state: KiroStreamState): string {
  const final: Record<string, unknown> = {
    id: `chatcmpl-${state.messageId || Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: state.model,
    choices: [{ index: 0, delta: {}, finish_reason: state.finishReason ?? "stop" }],
  };

  if (state.usage) {
    final.usage = state.usage;
  }

  return `data: ${JSON.stringify(final)}\n\ndata: [DONE]\n\n`;
}

// ── High-Level API ──────────────────────────────────────────────────────────

/**
 * Execute non-streaming Kiro request
 * @param client - Configured CodeWhispererStreamingClient
 * @param body - OpenAI Chat Completions request body
 * @param model - Model name
 * @returns OpenAI-compatible response
 */
export async function executeKiroNonStream(
  client: CodeWhispererStreamingClient,
  body: Record<string, unknown>,
  model: string
): Promise<Record<string, unknown>> {
  const request = openaiMessagesToKiroConversation(body);
  const command = new GenerateAssistantResponseCommand(request);
  const response = await client.send(command);

  // Collect all events
  const events: AssistantResponseEvent[] = [];
  if (response.chatResponseStream) {
    for await (const event of response.chatResponseStream) {
      events.push(event);
    }
  }

  return translateKiroNonStream(events, model);
}

/**
 * Execute streaming Kiro request
 * @param client - Configured CodeWhispererStreamingClient
 * @param body - OpenAI Chat Completions request body
 * @param model - Model name
 * @returns Async generator of SSE chunks
 */
export async function* executeKiroStream(
  client: CodeWhispererStreamingClient,
  body: Record<string, unknown>,
  model: string
): AsyncGenerator<string> {
  const request = openaiMessagesToKiroConversation(body);
  const command = new GenerateAssistantResponseCommand(request);
  const response = await client.send(command);

  const state = newKiroStreamState(model);

  if (response.chatResponseStream) {
    for await (const event of response.chatResponseStream) {
      const chunks = kiroEventToOpenAI(event, state);
      for (const chunk of chunks) {
        yield chunk;
      }
    }
  }

  // Send final chunk
  yield kiroStreamFinish(state);
}

// ── Notes ───────────────────────────────────────────────────────────────────
//
// TODO List for Full Implementation:
//
// 1. Authentication:
//    - Test token authentication method
//    - Implement token refresh if needed
//    - Handle 401/403 errors
//
// 2. Request Mapping:
//    - Add temperature support
//    - Add max_tokens support
//    - Add system message support
//    - Add tool/function calling support
//    - Add model selection (how to specify model?)
//
// 3. Response Mapping:
//    - Handle CodeEvent (code blocks)
//    - Handle CitationEvent (citations)
//    - Handle ReasoningContentEvent (thinking)
//    - Handle ToolUseEvent (function calls)
//    - Handle ToolResultEvent (function results)
//    - Handle InvalidStateEvent (errors)
//    - Detect end of stream properly
//
// 4. Error Handling:
//    - Map AWS exceptions to OpenAI errors
//    - Handle rate limiting
//    - Handle token expiration
//    - Handle invalid requests
//
// 5. Testing:
//    - Unit tests for transformations
//    - Integration test with real token
//    - Test streaming vs non-streaming
//    - Test error cases
//
// 6. Integration:
//    - Update upstream.ts dispatcher
//    - Update chat-handler.ts to use SDK directly
//    - Add format: "kiro" handling
//    - Test end-to-end with Maestro
