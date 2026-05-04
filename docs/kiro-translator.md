# Kiro Translator

## Overview

The Kiro translator enables Grouter to proxy requests to AWS CodeWhisperer (Kiro) accounts, converting between OpenAI's chat completions API and Kiro's proprietary format.

## Architecture

```
Client (OpenAI format)
    â†“
Grouter /v1/chat/completions
    â†“
upstream.ts â†’ dispatch.format = "kiro"
    â†“
chat-handler.ts â†’ Kiro interceptor
    â†“
kiro-translator.ts â†’ callKiroNonStreaming()
    â†“
AWS CodeWhisperer SDK
    â†“
GenerateAssistantResponseCommand
    â†“
assistantResponseEvent stream
    â†“
translateKiroNonStream() â†’ OpenAI format
    â†“
Client receives response
```

## MVP Status

### âœ… Implemented

- **Non-streaming `/v1/chat/completions`**
  - Converts OpenAI messages to Kiro prompt format
  - Uses existing Grouter OAuth token management
  - Calls AWS CodeWhisperer SDK `GenerateAssistantResponseCommand`
  - Translates `assistantResponseEvent` to OpenAI-compatible response
  - Returns proper HTTP 200 with `choices[0].message.content`

- **Authentication**
  - Uses `Connection.access_token` and `Connection.expires_at`
  - Integrates with Grouter's existing account rotation
  - Supports retry logic and error handling

- **Error Handling**
  - Client cancellation (HTTP 499)
  - Timeout handling with retry
  - Account unavailability marking
  - Proper error messages in OpenAI format

### âš ï¸ Not Implemented Yet

- **Streaming SSE**
  - Currently returns HTTP 501 with message: "Kiro streaming is not implemented yet. Use stream=false."
  - Requires event-stream parsing and SSE translation
  - Future implementation will convert `assistantResponseEvent` stream to OpenAI SSE format

- **Tool Calls**
  - No function calling support yet
  - Kiro SDK supports tools, but translation not implemented

- **Advanced Multi-turn State**
  - Basic conversation history works via prompt concatenation
  - No conversation state management beyond messages array

- **Model-specific Routing**
  - Currently uses `model: "auto"` in Kiro SDK
  - Model name from `kiro/claude-sonnet-4.5` is extracted but not fully utilized

## API

### Request Format

```json
{
  "model": "kiro/claude-sonnet-4.5",
  "messages": [
    {
      "role": "user",
      "content": "Your prompt here"
    }
  ],
  "stream": false,
  "temperature": 0
}
```

**Note:** `stream: true` will return HTTP 501.

### Response Format

```json
{
  "id": "chatcmpl-kiro-{uuid}",
  "object": "chat.completion",
  "created": 1777685495,
  "model": "auto",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Response content here"
      },
      "finish_reason": "stop"
    }
  ]
}
```

## Implementation Details

### Files Modified

1. **`src/proxy/chat-handler.ts`** (+111 lines)
   - Added `handleKiroSdkNonStreaming()` helper function
   - Single Kiro interceptor positioned after timer setup, before fetch
   - Rejects streaming with HTTP 501
   - Integrates with existing retry and error handling logic

2. **`src/proxy/kiro-translator.ts`** (simplified, -299 lines)
   - `callKiroNonStreaming()` - Main entry point
   - `extractKiroModel()` - Extract model from "kiro/..." format
   - `openaiMessagesToKiroPrompt()` - Convert OpenAI messages to prompt string
   - `buildKiroClient()` - Create AWS CodeWhisperer client with credentials
   - `translateKiroNonStream()` - Convert Kiro events to OpenAI response

3. **`src/proxy/upstream.ts`** (+10 lines)
   - Added `case "kiro"` to dispatch logic
   - Returns `format: "kiro"` with internal marker URL
   - URL `kiro-sdk://generateAssistantResponse` never reaches fetch (intercepted)

### Key Design Decisions

1. **Single Interceptor Approach**
   - Only one `if (dispatch.format === "kiro")` block in chat-handler
   - Positioned correctly in request lifecycle
   - Prevents duplicate code and fetch errors

2. **Connection Fields**
   - Uses `account.access_token` (not `account.token`)
   - Uses `account.expires_at` (not `account.expiresAt`)
   - Matches Grouter's `Connection` interface

3. **Error Messages**
   - OpenAI-compatible error format
   - Clear messages for debugging
   - Proper HTTP status codes

## Testing

### Direct Endpoint Test

```powershell
$body = @{
    model = "kiro/claude-sonnet-4.5"
    messages = @(@{ role = "user"; content = "Hello" })
    stream = $false
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
    -Uri "http://127.0.0.1:3099/v1/chat/completions" `
    -Method POST `
    -Headers @{"Content-Type"="application/json";"Authorization"="Bearer test"} `
    -Body $body
```

**Expected:** HTTP 200 with valid response

### Stream Test

```powershell
$body = @{
    model = "kiro/claude-sonnet-4.5"
    messages = @(@{ role = "user"; content = "Hello" })
    stream = $true
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
    -Uri "http://127.0.0.1:3099/v1/chat/completions" `
    -Method POST `
    -Headers @{"Content-Type"="application/json";"Authorization"="Bearer test"} `
    -Body $body
```

**Expected:** HTTP 501 with error message

## Future Work

### Streaming Implementation

To implement streaming:

1. Parse `assistantResponseEvent` stream in real-time
2. Convert each event to OpenAI SSE format:
   ```
   data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{"content":"..."}}]}
   ```
3. Handle stream completion and errors
4. Update interceptor to support `stream: true`

### Tool Calls

To implement function calling:

1. Parse tool definitions from request
2. Convert to Kiro SDK format
3. Handle tool call responses
4. Translate back to OpenAI format

### Model Routing

To implement model-specific routing:

1. Parse model name from `kiro/{model}`
2. Map to Kiro SDK model identifiers
3. Pass to `GenerateAssistantResponseCommand`

## Limitations

- **Daemon Mode:** Maestro CLI requires Grouter daemon mode (`grouter serve on`)
- **Streaming:** Not implemented, returns 501
- **Tools:** Not implemented
- **Model Selection:** Uses "auto" model

## Dependencies

- `@aws-sdk/client-codewhisperer-streaming` - AWS CodeWhisperer SDK
- Grouter's existing OAuth token management
- Grouter's account rotation and retry logic

## Commit

```
Branch: feat/kiro-translator
Commit: 8d2d2bf
Message: feat: implement kiro translator MVP

- Add Kiro SDK integration in chat-handler.ts
- Implement callKiroNonStreaming in kiro-translator.ts
- Add kiro case in upstream.ts dispatch
- Non-streaming requests working (stream=false)
- Streaming returns 501 as expected (not implemented yet)
- Single interceptor approach, no fetch to kiro-sdk://
```

## References

- AWS CodeWhisperer SDK: https://docs.aws.amazon.com/codewhisperer/
- OpenAI Chat Completions API: https://platform.openai.com/docs/api-reference/chat
- Grouter Architecture: See `docs/architecture.md` (if exists)

---

**Last Updated:** 2026-05-01  
**Status:** MVP Complete, Ready for Production Testing

## Streaming status

`stream=true` is supported through simulated SSE.

The implementation currently calls Kiro through the non-streaming SDK flow, waits for the full assistant response, then emits OpenAI-compatible SSE chunks.

This is enough for clients that require an SSE-compatible response shape.

**This is not true incremental token streaming yet.** True Kiro event streaming remains future work.

### SSE Format

When `stream=true`, the response includes:
- `delta.role` - Role of the message (assistant)
- `delta.content` - Content chunks
- `finish_reason: "stop"` - Completion indicator
- `data: [DONE]` - End of stream marker

