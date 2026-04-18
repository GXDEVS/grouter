// OpenAI ↔ Gemini Code Assist translator.
// Used by: gemini-cli (OAuth via cloudcode-pa.googleapis.com/v1internal).
//
// Code Assist wraps the standard Gemini generateContent request inside a
// { model, project, request: {...} } envelope and returns responses under a
// top-level `response` field. Streaming uses `:streamGenerateContent?alt=sse`
// and emits `data: {response: {...}}` SSE events.

type OpenAIMsg = Record<string, unknown>;
type Part = Record<string, unknown>;

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as { type?: string; text?: string }[])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
  }
  return "";
}

function buildParts(msg: OpenAIMsg): Part[] {
  const parts: Part[] = [];
  if (typeof msg.content === "string") {
    if (msg.content) parts.push({ text: msg.content });
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content as { type: string; text?: string; image_url?: { url?: string } }[]) {
      if (part.type === "text" && part.text) parts.push({ text: part.text });
      else if (part.type === "image_url") {
        const url = part.image_url?.url ?? "";
        const m = url.match(/^data:([^;]+);base64,(.+)$/);
        if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
      }
    }
  }
  return parts;
}

// ── Request: OpenAI → Code Assist envelope ───────────────────────────────────

export function openaiToGemini(
  model: string,
  body: Record<string, unknown>,
  project: string | null,
): Record<string, unknown> {
  const messages = (body.messages as OpenAIMsg[]) ?? [];
  const contents: Record<string, unknown>[] = [];
  let systemInstruction: Record<string, unknown> | undefined;

  for (const msg of messages) {
    const role = msg.role as string;
    if (role === "system") {
      const text = extractText(msg.content);
      if (text) systemInstruction = { role: "user", parts: [{ text }] };
      continue;
    }
    const parts = buildParts(msg);
    if (parts.length === 0) continue;
    contents.push({ role: role === "assistant" ? "model" : "user", parts });
  }

  const generationConfig: Record<string, unknown> = {};
  if (typeof body.temperature === "number") generationConfig.temperature = body.temperature;
  if (typeof body.top_p === "number")       generationConfig.topP        = body.top_p;
  if (typeof body.max_tokens === "number")  generationConfig.maxOutputTokens = body.max_tokens;

  const request: Record<string, unknown> = { contents };
  if (systemInstruction) request.systemInstruction = systemInstruction;
  if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;

  return {
    model,
    project,
    request,
  };
}

// ── Response: Code Assist → OpenAI ───────────────────────────────────────────

function mapFinishReason(reason: string | undefined): string {
  switch (reason) {
    case "STOP":        return "stop";
    case "MAX_TOKENS":  return "length";
    case "SAFETY":      return "content_filter";
    case "RECITATION":  return "content_filter";
    default:            return "stop";
  }
}

function extractCandidateText(candidate: Record<string, unknown> | undefined): string {
  if (!candidate) return "";
  const content = candidate.content as { parts?: { text?: string }[] } | undefined;
  if (!content?.parts) return "";
  return content.parts.map((p) => p.text ?? "").join("");
}

function mapUsage(meta: Record<string, unknown> | undefined): Record<string, number> | undefined {
  if (!meta) return undefined;
  const prompt_tokens     = (meta.promptTokenCount as number) ?? 0;
  const completion_tokens = (meta.candidatesTokenCount as number) ?? 0;
  const total_tokens      = (meta.totalTokenCount as number) ?? (prompt_tokens + completion_tokens);
  return { prompt_tokens, completion_tokens, total_tokens };
}

export function translateGeminiNonStream(data: Record<string, unknown>): Record<string, unknown> {
  const resp = (data.response as Record<string, unknown> | undefined) ?? data;
  const candidates = (resp.candidates as Record<string, unknown>[] | undefined) ?? [];
  const cand = candidates[0];
  const text = extractCandidateText(cand);
  const usage = mapUsage(resp.usageMetadata as Record<string, unknown> | undefined);
  const model = (resp.modelVersion as string) ?? "gemini";

  return {
    id:      `chatcmpl-${Date.now().toString(36)}`,
    object:  "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: mapFinishReason(cand?.finishReason as string | undefined),
    }],
    ...(usage ? { usage } : {}),
  };
}

// ── Streaming: Code Assist SSE → OpenAI SSE ──────────────────────────────────

export interface GeminiStreamState {
  id: string;
  created: number;
  model: string;
  sentRole: boolean;
  usage?: Record<string, number>;
  finished: boolean;
}

export function newGeminiStreamState(): GeminiStreamState {
  return {
    id:       `chatcmpl-${Date.now().toString(36)}`,
    created:  Math.floor(Date.now() / 1000),
    model:    "gemini",
    sentRole: false,
    finished: false,
  };
}

function sseLine(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

// Transform a single SSE line from Code Assist (`data: {...}` or a bare JSON line)
// into zero or more OpenAI SSE chunks.
export function geminiChunkToOpenAI(line: string, state: GeminiStreamState): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let jsonPart = trimmed;
  if (trimmed.startsWith("data:")) jsonPart = trimmed.slice(5).trim();
  if (jsonPart === "[DONE]") {
    if (state.finished) return [];
    state.finished = true;
    return ["data: [DONE]\n\n"];
  }

  let data: Record<string, unknown>;
  try { data = JSON.parse(jsonPart) as Record<string, unknown>; }
  catch { return []; }

  const resp = (data.response as Record<string, unknown> | undefined) ?? data;
  const candidates = (resp.candidates as Record<string, unknown>[] | undefined) ?? [];
  const cand = candidates[0];
  const text = extractCandidateText(cand);
  const finishReason = cand?.finishReason as string | undefined;
  const usage = mapUsage(resp.usageMetadata as Record<string, unknown> | undefined);
  if (usage) state.usage = usage;
  const modelVersion = resp.modelVersion as string | undefined;
  if (modelVersion) state.model = modelVersion;

  const out: string[] = [];

  if (!state.sentRole) {
    state.sentRole = true;
    out.push(sseLine({
      id: state.id, object: "chat.completion.chunk", created: state.created, model: state.model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    }));
  }

  if (text) {
    out.push(sseLine({
      id: state.id, object: "chat.completion.chunk", created: state.created, model: state.model,
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    }));
  }

  if (finishReason) {
    const final: Record<string, unknown> = {
      id: state.id, object: "chat.completion.chunk", created: state.created, model: state.model,
      choices: [{ index: 0, delta: {}, finish_reason: mapFinishReason(finishReason) }],
    };
    if (state.usage) final.usage = state.usage;
    out.push(sseLine(final));
    if (!state.finished) {
      state.finished = true;
      out.push("data: [DONE]\n\n");
    }
  }

  return out;
}
