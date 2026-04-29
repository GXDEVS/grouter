import { describe, test, expect } from "bun:test";
import {
  claudeToOpenAI,
  newOpenAIToClaudeStreamState,
  openaiChunkToClaude,
  openaiToClaudeResponse,
} from "../src/proxy/claude-translator.ts";

describe("claudeToOpenAI", () => {
  test("maps system/user messages and max_tokens default", () => {
    const out = claudeToOpenAI({
      model: "anthropic/claude-sonnet-4-6",
      system: "Follow policy.",
      messages: [{ role: "user", content: "ping" }],
    });
    expect(out.model).toBe("anthropic/claude-sonnet-4-6");
    expect(out.messages).toEqual([
      { role: "system", content: "Follow policy." },
      { role: "user", content: "ping" },
    ]);
    expect(out.max_tokens).toBe(8192);
  });

  test("expands system blocks array, preserves user content blocks, maps images", () => {
    const out = claudeToOpenAI({
      model: "claude",
      system: [
        { type: "text", text: "block A" },
        { type: "text", text: "block B" },
      ],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look at this" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
            { type: "image", source: { type: "url", url: "https://example.com/x.png" } },
          ],
        },
      ],
      max_tokens: 256,
    });
    expect((out.messages as unknown[])[0]).toEqual({ role: "system", content: "block A\nblock B" });
    const userMsg = (out.messages as Array<Record<string, unknown>>)[1]!;
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toEqual([
      { type: "text", text: "look at this" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      { type: "image_url", image_url: { url: "https://example.com/x.png" } },
    ]);
    expect(out.max_tokens).toBe(256);
  });

  test("translates assistant tool_use into OpenAI tool_calls", () => {
    const out = claudeToOpenAI({
      model: "claude",
      messages: [
        { role: "user", content: "search please" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Looking up." },
            { type: "tool_use", id: "tu_1", name: "search", input: { q: "foo" } },
          ],
        },
      ],
    });
    const assistant = (out.messages as Array<Record<string, unknown>>)[1]!;
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("Looking up.");
    expect(assistant.tool_calls).toEqual([
      { id: "tu_1", type: "function", index: 0, function: { name: "search", arguments: '{"q":"foo"}' } },
    ]);
  });

  test("user tool_result becomes a separate `tool` message with tool_call_id", () => {
    const out = claudeToOpenAI({
      model: "claude",
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "search", input: {} }] },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu_1", content: "result text" },
          ],
        },
      ],
    });
    const last = (out.messages as Array<Record<string, unknown>>).at(-1)!;
    expect(last).toEqual({ role: "tool", tool_call_id: "tu_1", content: "result text" });
  });

  test("maps tool_choice variants (auto/any/none/tool)", () => {
    expect(claudeToOpenAI({ model: "x", messages: [], tool_choice: { type: "auto" } }).tool_choice).toBe("auto");
    expect(claudeToOpenAI({ model: "x", messages: [], tool_choice: { type: "any" } }).tool_choice).toBe("required");
    expect(claudeToOpenAI({ model: "x", messages: [], tool_choice: { type: "none" } }).tool_choice).toBe("none");
    expect(claudeToOpenAI({ model: "x", messages: [], tool_choice: { type: "tool", name: "search" } }).tool_choice)
      .toEqual({ type: "function", function: { name: "search" } });
  });

  test("maps tools[] with input_schema -> function.parameters", () => {
    const out = claudeToOpenAI({
      model: "x",
      messages: [],
      tools: [
        { name: "search", description: "Search docs", input_schema: { type: "object", properties: { q: { type: "string" } } } },
      ],
    });
    expect(out.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search",
          description: "Search docs",
          parameters: { type: "object", properties: { q: { type: "string" } } },
        },
      },
    ]);
  });
});

describe("openaiToClaudeResponse", () => {
  test("text-only choice becomes a single text content block, end_turn stop", () => {
    const out = openaiToClaudeResponse({
      id: "chatcmpl-1",
      model: "claude-sonnet-4-6",
      choices: [{ message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    });
    expect(out.id).toBe("chatcmpl-1");
    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.content).toEqual([{ type: "text", text: "hello" }]);
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 3 });
  });

  test("tool_calls finish becomes tool_use blocks with parsed input and tool_use stop", () => {
    const out = openaiToClaudeResponse({
      model: "claude",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "tu_1", type: "function", function: { name: "search", arguments: '{"q":"foo"}' } },
          ],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(out.stop_reason).toBe("tool_use");
    expect(out.content).toEqual([
      { type: "tool_use", id: "tu_1", name: "search", input: { q: "foo" } },
    ]);
  });

  test("length finish maps to max_tokens stop", () => {
    const out = openaiToClaudeResponse({
      model: "claude",
      choices: [{ message: { content: "abc" }, finish_reason: "length" }],
    });
    expect(out.stop_reason).toBe("max_tokens");
  });
});

describe("openaiChunkToClaude (stream)", () => {
  test("first chunk emits message_start; text deltas wrap content_block 0", () => {
    const state = newOpenAIToClaudeStreamState();
    const start = openaiChunkToClaude(
      'data: ' + JSON.stringify({ id: "chatcmpl-x", model: "claude-sonnet-4-6", choices: [{ delta: { content: "Hi" } }] }),
      state,
    );
    expect(start.some((s) => s.startsWith("event: message_start"))).toBe(true);
    expect(start.some((s) => s.startsWith("event: content_block_start"))).toBe(true);
    expect(start.some((s) => s.startsWith("event: content_block_delta") && s.includes('"text":"Hi"'))).toBe(true);

    const more = openaiChunkToClaude(
      'data: ' + JSON.stringify({ choices: [{ delta: { content: "!" } }] }),
      state,
    );
    expect(more.length).toBe(1);
    expect(more[0]).toContain('"text":"!"');
  });

  test("[DONE] emits content_block_stop, message_delta(stop_reason=end_turn) and message_stop when no tool calls were seen", () => {
    const state = newOpenAIToClaudeStreamState();
    openaiChunkToClaude(
      'data: ' + JSON.stringify({ id: "x", model: "claude", choices: [{ delta: { content: "yo" } }] }),
      state,
    );
    const out = openaiChunkToClaude("data: [DONE]", state);
    expect(out.some((s) => s.startsWith("event: content_block_stop"))).toBe(true);
    expect(out.some((s) => s.startsWith("event: message_delta") && s.includes('"stop_reason":"end_turn"'))).toBe(true);
    expect(out.some((s) => s.startsWith("event: message_stop"))).toBe(true);
  });

  test("tool_call deltas open content_block tool_use and stream input_json_delta", () => {
    const state = newOpenAIToClaudeStreamState();
    openaiChunkToClaude(
      'data: ' + JSON.stringify({ id: "x", model: "claude", choices: [{ delta: { content: "" } }] }),
      state,
    );
    const tcStart = openaiChunkToClaude(
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "tu_1", function: { name: "search", arguments: "" } }] } }] }),
      state,
    );
    expect(tcStart.some((s) => s.startsWith("event: content_block_start") && s.includes('"type":"tool_use"'))).toBe(true);

    const tcDelta = openaiChunkToClaude(
      'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"foo"}' } }] } }] }),
      state,
    );
    expect(tcDelta.some((s) => s.includes('"type":"input_json_delta"') && s.includes('"partial_json":"{\\"q\\":\\"foo\\"}"'))).toBe(true);

    const done = openaiChunkToClaude("data: [DONE]", state);
    expect(done.some((s) => s.includes('"stop_reason":"tool_use"'))).toBe(true);
  });

  test("non-data lines are ignored, malformed JSON is silently dropped", () => {
    const state = newOpenAIToClaudeStreamState();
    expect(openaiChunkToClaude("event: ping", state)).toEqual([]);
    expect(openaiChunkToClaude("data: {not json", state)).toEqual([]);
  });
});
