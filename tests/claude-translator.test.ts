import { describe, test, expect } from "bun:test";
import {
  openaiToClaude,
  translateClaudeNonStream,
  newClaudeStreamState,
  claudeChunkToOpenAI,
} from "../src/proxy/claude-translator.ts";

describe("openaiToClaude", () => {
  test("maps system/messages/tools/tool_choice for Claude messages API", () => {
    const mapped = openaiToClaude(
      "claude-sonnet-4-6",
      {
        messages: [
          { role: "system", content: "Follow policy." },
          { role: "user", content: "Ping" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "lookup",
              description: "Lookup docs",
              parameters: { type: "object", properties: { q: { type: "string" } } },
            },
          },
        ],
        tool_choice: "required",
      },
      true,
    );

    expect(mapped.model).toBe("claude-sonnet-4-6");
    expect(mapped.stream).toBe(true);
    expect(mapped.max_tokens).toBe(8192);
    expect(mapped.system).toEqual([{ type: "text", text: "Follow policy." }]);
    expect(Array.isArray(mapped.messages)).toBe(true);
    expect((mapped.messages as unknown[]).length).toBe(1);
    expect(mapped.tools).toEqual([
      {
        name: "lookup",
        description: "Lookup docs",
        input_schema: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);
    expect(mapped.tool_choice).toEqual({ type: "any" });
  });
});

describe("translateClaudeNonStream", () => {
  test("maps text, reasoning, tool call and usage to OpenAI format", () => {
    const out = translateClaudeNonStream({
      id: "msg_1",
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "answer" },
        { type: "thinking", thinking: "internal chain" },
        { type: "tool_use", id: "tool_1", name: "lookup", input: { q: "router" } },
      ],
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
        output_tokens: 5,
      },
    });

    const choice = (out.choices as Array<Record<string, unknown>>)[0]!;
    expect(choice.finish_reason).toBe("tool_calls");
    const message = choice.message as Record<string, unknown>;
    expect(message.role).toBe("assistant");
    expect(message.content).toBe("answer");
    expect(message.reasoning_content).toBe("internal chain");
    expect(Array.isArray(message.tool_calls)).toBe(true);
    expect(out.usage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 5,
      total_tokens: 20,
    });
  });
});

describe("claudeChunkToOpenAI", () => {
  test("translates a minimal Claude SSE flow", () => {
    const state = newClaudeStreamState();

    expect(claudeChunkToOpenAI("event: message_start", state)).toEqual([]);
    const startOut = claudeChunkToOpenAI(
      'data: {"message":{"id":"msg_2","model":"claude-sonnet-4-6"}}',
      state,
    );
    expect(startOut.length).toBe(1);
    expect(startOut[0]).toContain('"role":"assistant"');

    expect(claudeChunkToOpenAI("event: content_block_delta", state)).toEqual([]);
    const deltaOut = claudeChunkToOpenAI(
      'data: {"index":0,"delta":{"type":"text_delta","text":"hello"}}',
      state,
    );
    expect(deltaOut.length).toBe(1);
    expect(deltaOut[0]).toContain('"content":"hello"');

    expect(claudeChunkToOpenAI("event: message_delta", state)).toEqual([]);
    const finishOut = claudeChunkToOpenAI(
      'data: {"delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":2,"output_tokens":1}}',
      state,
    );
    expect(finishOut.length).toBe(1);
    expect(finishOut[0]).toContain('"finish_reason":"stop"');
    expect(finishOut[0]).toContain('"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}');

    expect(claudeChunkToOpenAI("event: message_stop", state)).toEqual([]);
    const doneOut = claudeChunkToOpenAI("data: {}", state);
    expect(doneOut).toEqual(["data: [DONE]\n\n"]);
  });
});

