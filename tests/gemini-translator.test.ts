import { describe, test, expect } from "bun:test";
import {
  openaiToGemini,
  translateGeminiNonStream,
  newGeminiStreamState,
  geminiChunkToOpenAI,
} from "../src/proxy/gemini-translator.ts";

describe("openaiToGemini", () => {
  test("maps OpenAI payload to Gemini Code Assist envelope", () => {
    const mapped = openaiToGemini(
      "gemini-2.5-flash",
      {
        messages: [
          { role: "system", content: "Use short answers." },
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ],
        temperature: 0.2,
        top_p: 0.95,
        max_tokens: 300,
      },
      "demo-project",
    );

    expect(mapped.model).toBe("gemini-2.5-flash");
    expect(mapped.project).toBe("demo-project");
    expect(mapped.request).toEqual({
      systemInstruction: { role: "user", parts: [{ text: "Use short answers." }] },
      contents: [
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "Hi there" }] },
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        maxOutputTokens: 300,
      },
    });
  });
});

describe("translateGeminiNonStream", () => {
  test("maps Gemini response to OpenAI chat completion shape", () => {
    const out = translateGeminiNonStream({
      response: {
        modelVersion: "gemini-2.5-flash",
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: "Gemini answer" }] },
          },
        ],
        usageMetadata: {
          promptTokenCount: 11,
          candidatesTokenCount: 7,
          totalTokenCount: 18,
        },
      },
    });

    expect(out.object).toBe("chat.completion");
    expect((out.choices as Array<Record<string, unknown>>)[0]?.finish_reason).toBe("length");
    expect((out.choices as Array<Record<string, unknown>>)[0]?.message).toEqual({
      role: "assistant",
      content: "Gemini answer",
    });
    expect(out.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
    });
  });
});

describe("geminiChunkToOpenAI", () => {
  test("translates Gemini SSE payload to OpenAI SSE chunks and closes stream", () => {
    const state = newGeminiStreamState();
    const out = geminiChunkToOpenAI(
      'data: {"response":{"modelVersion":"gemini-2.5-flash","candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"hi"}]}}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":1,"totalTokenCount":3}}}',
      state,
    );

    expect(out.length).toBe(4);
    expect(out[0]).toContain('"role":"assistant"');
    expect(out[1]).toContain('"content":"hi"');
    expect(out[2]).toContain('"finish_reason":"stop"');
    expect(out[2]).toContain('"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}');
    expect(out[3]).toBe("data: [DONE]\n\n");

    // State is already finished, so an extra [DONE] line should be ignored.
    expect(geminiChunkToOpenAI("data: [DONE]", state)).toEqual([]);
  });
});

