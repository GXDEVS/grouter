import { describe, test, expect } from "bun:test";
import {
  openaiToCodexResponses,
  translateCodexNonStream,
  newCodexStreamState,
  codexChunkToOpenAI,
} from "../src/proxy/codex-translator.ts";

describe("openaiToCodexResponses", () => {
  test("maps OpenAI chat payload to Responses format with system instructions and tools", () => {
    const mapped = openaiToCodexResponses(
      {
        model: "gpt-5.4",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Hello" },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "search_docs",
              description: "Search docs",
              parameters: { type: "object", properties: { q: { type: "string" } } },
            },
          },
        ],
      },
      true,
    );

    expect(mapped.model).toBe("gpt-5.4");
    expect(mapped.store).toBe(false);
    expect(mapped.stream).toBe(true);
    expect(mapped.instructions).toBe("You are concise.");
    expect(Array.isArray(mapped.input)).toBe(true);
    expect((mapped.input as unknown[]).length).toBeGreaterThan(0);
    expect(mapped.tools).toEqual([
      {
        type: "function",
        name: "search_docs",
        description: "Search docs",
        parameters: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);
    expect(mapped.tool_choice).toBe("required");
    expect(mapped.parallel_tool_calls).toBe(true);
  });

  test("includes developer messages in instructions and excludes them from input user turns", () => {
    const mapped = openaiToCodexResponses(
      {
        model: "gpt-5.4",
        messages: [
          { role: "system", content: "System policy." },
          { role: "developer", content: "Use tools to edit files; do not just promise." },
          { role: "user", content: "Create calculadora.html" },
        ],
      },
      true,
    );

    expect(mapped.instructions).toBe("System policy.\nUse tools to edit files; do not just promise.");
    expect(mapped.input).toEqual([
      { role: "user", content: "Create calculadora.html" },
    ]);
  });

  test("preserves explicit tool_choice and parallel_tool_calls from OpenAI payload", () => {
    const mapped = openaiToCodexResponses(
      {
        model: "gpt-5.4",
        messages: [{ role: "user", content: "Create file" }],
        tools: [
          {
            type: "function",
            function: { name: "write_file", parameters: { type: "object", properties: {} } },
          },
        ],
        tool_choice: "required",
        parallel_tool_calls: false,
      },
      true,
    );

    expect(mapped.tool_choice).toBe("required");
    expect(mapped.parallel_tool_calls).toBe(false);
  });

  test("maps function-specific tool_choice to Responses shape", () => {
    const mapped = openaiToCodexResponses(
      {
        model: "gpt-5.4",
        messages: [{ role: "user", content: "Use write_file" }],
        tools: [
          {
            type: "function",
            function: { name: "write_file", parameters: { type: "object", properties: {} } },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: "write_file" },
        },
      },
      false,
    );

    expect(mapped.tool_choice).toEqual({
      type: "function",
      name: "write_file",
    });
  });

  test("honors environment override for default tool_choice", () => {
    const prev = process.env.GROUTER_CODEX_DEFAULT_TOOL_CHOICE;
    process.env.GROUTER_CODEX_DEFAULT_TOOL_CHOICE = "auto";
    try {
      const mapped = openaiToCodexResponses(
        {
          model: "gpt-5.4",
          messages: [{ role: "user", content: "Check this file" }],
          tools: [
            {
              type: "function",
              function: { name: "read_file", parameters: { type: "object", properties: {} } },
            },
          ],
        },
        false,
      );
      expect(mapped.tool_choice).toBe("auto");
    } finally {
      if (prev === undefined) delete process.env.GROUTER_CODEX_DEFAULT_TOOL_CHOICE;
      else process.env.GROUTER_CODEX_DEFAULT_TOOL_CHOICE = prev;
    }
  });
});

describe("translateCodexNonStream", () => {
  test("maps plain text and usage to OpenAI chat completion format", () => {
    const out = translateCodexNonStream({
      response: {
        id: "resp_1",
        model: "gpt-5.4",
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Hello from Codex" }],
          },
        ],
      },
    });

    expect(out.object).toBe("chat.completion");
    expect((out.choices as Array<Record<string, unknown>>)[0]?.message).toEqual({
      role: "assistant",
      content: "Hello from Codex",
    });
    expect(out.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  test("emits tool_calls finish reason when function calls exist", () => {
    const out = translateCodexNonStream({
      response: {
        id: "resp_2",
        model: "gpt-5.4",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "search_docs",
            arguments: "{\"q\":\"router\"}",
          },
        ],
      },
    });

    const choice = (out.choices as Array<Record<string, unknown>>)[0]!;
    expect(choice.finish_reason).toBe("tool_calls");
    const message = choice.message as Record<string, unknown>;
    expect(Array.isArray(message.tool_calls)).toBe(true);
    expect((message.tool_calls as Array<Record<string, unknown>>)[0]?.id).toBe("call_1");
  });
});

describe("codexChunkToOpenAI", () => {
  test("translates created/text/completed SSE flow into OpenAI chunks", () => {
    const state = newCodexStreamState();

    expect(
      codexChunkToOpenAI(
        'data: {"type":"response.created","response":{"id":"resp_3","model":"gpt-5.4"}}',
        state,
      ),
    ).toEqual([]);

    const textChunks = codexChunkToOpenAI(
      'data: {"type":"response.output_text.delta","delta":"hello"}',
      state,
    );
    expect(textChunks.length).toBe(2);
    expect(textChunks[0]).toContain('"role":"assistant"');
    expect(textChunks[1]).toContain('"content":"hello"');

    const doneChunks = codexChunkToOpenAI(
      'data: {"type":"response.completed","response":{"id":"resp_3","model":"gpt-5.4","status":"completed","usage":{"input_tokens":3,"output_tokens":2},"output":[]}}',
      state,
    );
    expect(doneChunks[0]).toContain('"finish_reason":"stop"');
    expect(doneChunks[0]).toContain('"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}');
    expect(doneChunks[1]).toBe("data: [DONE]\n\n");
  });

  test("emits fallback tool_call delta when function_call is only present on completion", () => {
    const state = newCodexStreamState();

    codexChunkToOpenAI(
      'data: {"type":"response.created","response":{"id":"resp_tool","model":"gpt-5.4"}}',
      state,
    );

    const doneChunks = codexChunkToOpenAI(
      'data: {"type":"response.completed","response":{"id":"resp_tool","model":"gpt-5.4","status":"completed","output":[{"type":"function_call","call_id":"call_42","name":"write_file","arguments":"{\\"path\\":\\"calculadora.html\\"}"}]}}',
      state,
    );

    const joined = doneChunks.join("");
    expect(joined).toContain('"tool_calls"');
    expect(joined).toContain('"id":"call_42"');
    expect(joined).toContain('"name":"write_file"');
    expect(joined).toContain('"arguments":"{\\\"path\\\":\\\"calculadora.html\\\"}"');
    expect(doneChunks[doneChunks.length - 1]).toBe("data: [DONE]\n\n");
  });
});
