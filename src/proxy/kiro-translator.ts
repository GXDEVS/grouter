// OpenAI <-> AWS CodeWhisperer/Kiro translator
// Converts between OpenAI Chat Completions format and AWS CodeWhisperer streaming format
//
// Based on SDK: @aws/codewhisperer-streaming-client@1.0.39
// Commands: GenerateAssistantResponseCommand
// Events: ChatResponseStream (assistantResponseEvent, etc.)

import {
  CodeWhispererStreamingClient,
  GenerateAssistantResponseCommand,
  type GenerateAssistantResponseCommandInput,
  type GenerateAssistantResponseResponse,
  type ChatResponseStream,
} from "@aws/codewhisperer-streaming-client";

// ── Model Extraction ────────────────────────────────────────────────────────

/**
 * Extract Kiro model name from OpenAI model format
 * @param model - OpenAI model string (e.g., "kiro/claude-sonnet-4.5" or "claude-sonnet-4.5")
 * @returns Kiro model name (e.g., "claude-sonnet-4.5")
 */
export function extractKiroModel(model: string): string {
  return model.replace(/^kiro\//, "");
}

// ── Request Transformation ──────────────────────────────────────────────────

/**
 * Transform OpenAI messages to Kiro prompt
 * For MVP: concatenate all messages into a single prompt
 * @param messages - OpenAI messages array
 * @returns Concatenated prompt string
 */
export function openaiMessagesToKiroPrompt(messages: unknown[]): string {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "";
  }

  const parts: string[] = [];

  for (const msg of messages) {
    if (typeof msg !== "object" || !msg) continue;
    const m = msg as Record<string, unknown>;
    const role = typeof m.role === "string" ? m.role : "user";
    const content = typeof m.content === "string" ? m.content : "";

    if (!content) continue;

    // Format: "Role: content"
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    parts.push(`${roleLabel}: ${content}`);
  }

  return parts.join("\n\n");
}

/**
 * Build Kiro GenerateAssistantResponse input
 * @param prompt - User prompt
 * @returns GenerateAssistantResponseCommandInput
 */
export function buildKiroGenerateAssistantInput(
  prompt: string
): GenerateAssistantResponseCommandInput {
  return {
    conversationState: {
      currentMessage: {
        userInputMessage: {
          content: prompt,
        },
      },
      chatTriggerType: "MANUAL",
    },
  };
}

// ── Client Creation ─────────────────────────────────────────────────────────

/**
 * Create configured CodeWhisperer client
 * @param token - OAuth access token from Grouter
 * @param expiresAt - Token expiration date
 * @param region - AWS region (default: us-east-1)
 * @returns Configured client instance
 */
export function buildKiroClient(
  token: string,
  expiresAt: string,
  region: string = "us-east-1"
): CodeWhispererStreamingClient {
  return new CodeWhispererStreamingClient({
    region,
    token: {
      token,
      expiration: new Date(expiresAt),
    },
    endpoint: "https://codewhisperer.us-east-1.amazonaws.com",
  });
}

// ── Response Transformation (Non-Streaming) ─────────────────────────────────

/**
 * Transform Kiro response events to OpenAI completion format
 * @param events - Array of ChatResponseStream events from Kiro
 * @param model - Model name for response
 * @returns OpenAI Chat Completion response
 */
export function translateKiroNonStream(
  events: ChatResponseStream[],
  model: string
): Record<string, unknown> {
  let content = "";
  let messageId = "";
  let modelId = "";
  let usage: Record<string, number> | null = null;

  // Process all events
  for (const event of events) {
    // assistantResponseEvent - contains message content
    if ("assistantResponseEvent" in event && event.assistantResponseEvent) {
      const evt = event.assistantResponseEvent as any;
      if (typeof evt.content === "string") {
        content += evt.content;
      }
      if (typeof evt.messageId === "string") {
        messageId = evt.messageId;
      }
      if (typeof evt.modelId === "string") {
        modelId = evt.modelId;
      }
    }

    // contextUsageEvent - contains token usage
    if ("contextUsageEvent" in event && event.contextUsageEvent) {
      const evt = event.contextUsageEvent as any;
      if (evt.tokenUsage) {
        const tokenUsage = evt.tokenUsage;
        usage = {
          prompt_tokens: tokenUsage.inputTokens ?? 0,
          completion_tokens: tokenUsage.outputTokens ?? 0,
          total_tokens: (tokenUsage.inputTokens ?? 0) + (tokenUsage.outputTokens ?? 0),
        };
      }
    }

    // TODO: Handle other event types:
    // - codeEvent
    // - citationEvent
    // - reasoningContentEvent
    // - toolUseEvent
    // - toolResultEvent
    // - invalidStateEvent (errors)
  }

  const response: Record<string, unknown> = {
    id: `chatcmpl-kiro-${messageId || crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId || model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
        },
        finish_reason: "stop",
      },
    ],
  };

  // Add usage if available
  if (usage) {
    response.usage = usage;
  }

  return response;
}

// ── High-Level API (Non-Streaming) ──────────────────────────────────────────

export interface CallKiroParams {
  token: string;
  expiresAt: string;
  region?: string;
  body: Record<string, unknown>;
  model: string;
}

/**
 * Execute non-streaming Kiro request
 * @param params - Request parameters
 * @returns OpenAI-compatible response
 */
export async function callKiroNonStreaming(
  params: CallKiroParams
): Promise<Record<string, unknown>> {
  const { token, expiresAt, region = "us-east-1", body, model } = params;

  // Extract messages and convert to prompt
  const messages = (body.messages ?? []) as unknown[];
  const prompt = openaiMessagesToKiroPrompt(messages);

  if (!prompt) {
    throw new Error("No messages provided");
  }

  // Build input
  const input = buildKiroGenerateAssistantInput(prompt);

  // Create client
  const client = buildKiroClient(token, expiresAt, region);

  // Execute command
  const command = new GenerateAssistantResponseCommand(input);
  const response: GenerateAssistantResponseResponse = await client.send(command);

  // Collect all events
  const events: ChatResponseStream[] = [];
  if (response.generateAssistantResponseResponse) {
    for await (const event of response.generateAssistantResponseResponse) {
      events.push(event);
    }
  }

  // Transform to OpenAI format
  return translateKiroNonStream(events, model);
}

// ── Streaming Support (Future) ──────────────────────────────────────────────

// TODO: Implement streaming support
// - Stream state tracking
// - Event-to-SSE transformation
// - Proper finish_reason handling
// - Usage reporting at end of stream

