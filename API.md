# grouter — API HTTP (`/v1`)

Documento de referência para integrar qualquer aplicação ao proxy local do `grouter`.
O proxy expõe uma **API compatível com OpenAI** (`/v1/chat/completions`, `/v1/models`),
então qualquer SDK ou cliente que já fale OpenAI pode apontar para ele sem alterações de código —
basta trocar `OPENAI_BASE_URL` e `OPENAI_API_KEY`.

---

## 1. Sumário

| Endpoint | Método | Descrição |
|---|---|---|
| `/v1/chat/completions` | `POST` | Completa chat (stream e não-stream). Formato OpenAI. |
| `/v1/messages` | `POST` | Formato Anthropic Messages (Claude SDK, Cursor anthropic, etc.). |
| `/v1/models` | `GET` | Lista de modelos disponíveis. |
| `/health` | `GET` | Healthcheck leve (JSON). |

Todos os endpoints respondem `OPTIONS` para CORS preflight. O header `Access-Control-Allow-Origin` é **opt-in** — veja §10.

---

## 2. Endereços e portas

O `grouter` sobe **vários listeners** em paralelo quando você roda `grouter serve on`:

| Porta | O que é | Como escolhe o provider |
|---|---|---|
| `3099` (configurável) | **Router** — ponto único | Escolhe provider pelo **prefixo do modelo** (`provider/model`) ou fallback `qwen` |
| `3100`, `3101`, … | **Porta dedicada por provider** | **Pinada** — ignora prefixo no nome do modelo, usa sempre o provider daquela porta |

Para descobrir as portas dedicadas:

```bash
grouter serve status
```

A porta do router pode ser alterada com:

```bash
grouter config --port 8080
```

Ou via dashboard em `http://localhost:3099/dashboard`.

---

## 3. Autenticação

O proxy **não valida** o valor do header `Authorization` — ele existe apenas para manter compatibilidade com SDKs OpenAI que exigem uma API key. Use qualquer string não-vazia; o padrão que a CLI injeta é `grouter`:

```
Authorization: Bearer grouter
```

> ⚠️ O proxy escuta apenas em `localhost` por padrão. **Não exponha** essa porta para a internet sem colocar uma camada de autenticação/autorização própria na frente.

---

## 4. `POST /v1/chat/completions`

Endpoint principal. Formato 100% compatível com a API de chat completions da OpenAI.

### 4.1. Request

```http
POST /v1/chat/completions HTTP/1.1
Host: localhost:3099
Content-Type: application/json
Authorization: Bearer grouter

{
  "model": "qwen/qwen3-coder-plus",
  "messages": [
    { "role": "system", "content": "Você é um assistente prestativo." },
    { "role": "user",   "content": "Me explique o que é um mutex em 2 frases." }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 1024
}
```

Campos suportados (os que o upstream aceita são repassados):

| Campo | Tipo | Observação |
|---|---|---|
| `model` | string | **Obrigatório.** Veja §6. |
| `messages` | array | Array padrão OpenAI `{role, content}`. |
| `stream` | boolean | Se `true`, resposta é SSE (§4.3). |
| `temperature`, `top_p`, `max_tokens`, `stop`, `frequency_penalty`, `presence_penalty`, `tools`, `tool_choice`, `response_format`… | — | Repassados ao upstream; suporte varia por provider. |

### 4.2. Response (não-stream)

Retorno JSON padrão OpenAI:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1713456000,
  "model": "qwen3-coder-plus",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Um mutex é..." },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 42,
    "completion_tokens": 87,
    "total_tokens": 129
  }
}
```

Providers que nativamente falam formato Claude/Anthropic (Claude, Anthropic, Kimi-Coding) ou Gemini são **traduzidos automaticamente** para o formato OpenAI acima — do ponto de vista do cliente, tudo chega como OpenAI.

### 4.3. Response (stream — SSE)

Quando `stream: true`, a resposta é Server-Sent Events (`Content-Type: text/event-stream`):

```
data: {"id":"chatcmpl-...","choices":[{"delta":{"role":"assistant"}}]}

data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"Um "}}]}

data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"mutex"}}]}

...

data: {"id":"chatcmpl-...","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":42,"completion_tokens":87,"total_tokens":129}}

data: [DONE]
```

Cada linha `data:` contém um chunk JSON no formato OpenAI `chat.completion.chunk`. O stream termina com `data: [DONE]`.

### 4.4. Erros

Erros seguem o envelope OpenAI:

```json
{
  "error": {
    "message": "No connections available for provider \"qwen\"",
    "type": "grouter_error",
    "code": 503
  }
}
```

| Status | `type` | Quando acontece |
|---|---|---|
| `400` | `grouter_error` | JSON inválido no body. |
| `429` | `grouter_error` | Todas as contas do provider estão rate-limited. Inclui header `Retry-After`. |
| `501` | `provider_not_supported` | Provider pinado não tem adaptador de upstream. |
| `502` | `upstream_unreachable` | Falha de rede ao falar com o upstream. |
| `503` | `grouter_error` | Nenhuma conta ativa para o provider/modelo pedido. |
| `4xx`/`5xx` upstream | — | Repassado cru (JSON do upstream ou texto). |

O router tenta automaticamente até **3 contas** antes de desistir (rotação para outra conta do mesmo provider em caso de 401/402/429/5xx).

---

## 5. `POST /v1/messages`

Endpoint compatível com a [Anthropic Messages API](https://docs.anthropic.com/en/api/messages). Permite que clientes do SDK Anthropic (Claude Code, Cursor em modo anthropic, `@anthropic-ai/sdk`, etc.) usem o `grouter` sem trocar de SDK.

Por baixo do capô o body Anthropic é traduzido para o formato OpenAI, passa pela mesma pipeline de rotação/retry/timeout do `/v1/chat/completions`, e a resposta é convertida de volta para o formato Anthropic — então o mesmo conjunto de providers fica disponível por aqui também.

### 5.1. Request

```http
POST /v1/messages HTTP/1.1
Host: localhost:3099
Content-Type: application/json
Authorization: Bearer grouter

{
  "model": "anthropic/claude-sonnet-4-6",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "Hello!" }
  ]
}
```

Campos suportados (compatíveis com Anthropic):

| Campo | Tipo | Observação |
|---|---|---|
| `model` | string | **Obrigatório.** `provider/model` no router, só `model` em porta pinada. |
| `max_tokens` | number | Default 8192 quando ausente. |
| `messages` | array | Anthropic format (`role`, `content` string ou array de blocos `text`/`image`/`tool_use`/`tool_result`). |
| `system` | string ou array de blocos `text` | Convertido para a mensagem system do OpenAI. |
| `stream` | boolean | Se `true`, resposta é SSE no formato Anthropic (§5.3). |
| `temperature`, `top_p` | number | Repassados ao upstream. |
| `tools` | array | Cada ferramenta tem `name`/`description`/`input_schema` — convertido para `function.parameters`. |
| `tool_choice` | objeto | `{type:"auto"}` / `{type:"any"}` / `{type:"none"}` / `{type:"tool", name:"..."}`. |

### 5.2. Response (não-stream)

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-6",
  "content": [
    { "type": "text", "text": "Hello! How can I help?" }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 12,
    "output_tokens": 8
  }
}
```

`stop_reason` é mapeado a partir do `finish_reason` OpenAI: `tool_calls` → `tool_use`, `length` → `max_tokens`, qualquer outro → `end_turn`.

### 5.3. Response (stream)

Eventos SSE no formato Anthropic, na ordem:

```
event: message_start
data: {"type":"message_start","message":{...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":8}}

event: message_stop
data: {"type":"message_stop"}
```

Tool use abre seu próprio `content_block` com `type:"tool_use"` e o argumento é entregue em `input_json_delta`.

### 5.4. Exemplo

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://localhost:3099",
  apiKey: "grouter",
});

const msg = await client.messages.create({
  model: "anthropic/claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

---

## 6. Como nomear o modelo

### 6.1. Porta do router (`:3099`)

Use o prefixo `provider/model`:

```json
{ "model": "qwen/qwen3-coder-plus" }
{ "model": "github/gpt-5" }
{ "model": "claude/claude-sonnet-4.5" }
{ "model": "gemini/gemini-2.5-pro" }
{ "model": "openrouter/anthropic/claude-opus-4" }
```

Sem prefixo, o router assume `qwen/` por compatibilidade.

### 6.2. Porta pinada por provider (`:3100+`)

Quando você está numa porta dedicada (ex.: `:3101` para GitHub Copilot), o provider é **forçado** pela porta. Pode passar o modelo **puro** (sem prefixo):

```json
{ "model": "gpt-5" }
```

Se passar com prefixo nessa porta, o prefixo é **descartado** — a porta vence.

### 6.3. Descobrindo modelos

```bash
grouter models              # todos os providers
grouter models github       # só do GitHub Copilot
```

Ou via HTTP:

```bash
curl http://localhost:3099/v1/models
```

---

## 7. `GET /v1/models`

Lista compatível com o endpoint `models.list` da OpenAI.

```bash
curl http://localhost:3099/v1/models
```

```json
{
  "object": "list",
  "data": [
    { "id": "qwen3-coder-plus",  "object": "model", "created": 1720000000, "owned_by": "qwen" },
    { "id": "qwen3-coder-flash", "object": "model", "created": 1720000000, "owned_by": "qwen" }
  ]
}
```

Na porta do router (`:3099`), a lista vem do provider ativo (Qwen por padrão, com cache de 10 minutos). Em portas dedicadas (`:3100+`), lista os modelos daquele provider específico.

---

## 8. `GET /health`

Healthcheck leve — não toca em upstream:

```bash
curl http://localhost:3099/health
```

```json
{ "status": "ok", "accounts": 4, "active": 3 }
```

Nas portas dedicadas:

```json
{ "status": "ok", "provider": "github", "port": 3101 }
```

---

## 9. Exemplos de integração

### 9.1. `curl`

```bash
curl http://localhost:3099/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer grouter" \
  -d '{
    "model": "qwen/qwen3-coder-plus",
    "messages": [{"role": "user", "content": "oi"}]
  }'
```

### 9.2. OpenAI SDK — Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3099/v1",
    api_key="grouter",
)

resp = client.chat.completions.create(
    model="qwen/qwen3-coder-plus",
    messages=[{"role": "user", "content": "oi"}],
)
print(resp.choices[0].message.content)
```

Streaming:

```python
stream = client.chat.completions.create(
    model="github/gpt-5",
    messages=[{"role": "user", "content": "escreva um haiku"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

### 9.3. OpenAI SDK — Node/TypeScript

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3099/v1",
  apiKey:  "grouter",
});

const resp = await client.chat.completions.create({
  model: "qwen/qwen3-coder-plus",
  messages: [{ role: "user", content: "oi" }],
});
console.log(resp.choices[0].message.content);
```

### 9.4. `fetch` puro

```ts
const resp = await fetch("http://localhost:3099/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type":  "application/json",
    "Authorization": "Bearer grouter",
  },
  body: JSON.stringify({
    model: "claude/claude-sonnet-4.5",
    messages: [{ role: "user", content: "oi" }],
  }),
});
const data = await resp.json();
```

### 9.5. Claude Code (via OpenClaude)

O `grouter` já tem um comando que configura as envvars automaticamente:

```bash
grouter up openclaude
```

Isso injeta no shell e no `~/.claude/settings.json`:

```bash
export CLAUDE_CODE_USE_OPENAI="1"
export OPENAI_BASE_URL="http://localhost:3099/v1"
export OPENAI_API_KEY="grouter"
export OPENAI_MODEL="qwen3-coder-plus"
```

### 9.6. LangChain (Python)

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://localhost:3099/v1",
    api_key="grouter",
    model="github/gpt-5",
)
```

### 9.7. Continue.dev / Cline / Aider / qualquer cliente OpenAI-compatível

Basta apontar:

- **Base URL**: `http://localhost:3099/v1`
- **API Key**: `grouter` (qualquer string)
- **Model**: use o formato `provider/model` (ex.: `qwen/qwen3-coder-plus`)

---

## 10. Rotação, rate-limit e fallback

Comportamento que você herda de graça ao passar pelo proxy:

1. **Seleção de conta** — respeita a estratégia (`fill-first` ou `round-robin`) e
   stickiness configurada (`grouter config --strategy ... --sticky-limit N`).
2. **Refresh automático de token** — contas OAuth têm o token renovado dentro de uma janela
   antes do expiração.
3. **Fallback transparente** — em caso de `401/402/429/5xx` do upstream, o proxy rotaciona
   para a próxima conta do mesmo provider, até **3 tentativas**, antes de retornar erro ao cliente.
4. **Cooldowns** — contas com falha entram em cooldown progressivo (15min para 401, 1h para
   problemas de billing, backoff exponencial para rate-limit).
5. **Model-lock** — rate-limit de um modelo específico não desativa a conta inteira, só
   aquele modelo para aquela conta.

Do lado do cliente, **nada muda**: você continua recebendo uma resposta OpenAI padrão (ou o erro final quando todos os fallbacks se esgotam).

---

## 11. CORS

Por padrão, o proxy **não envia** o header `Access-Control-Allow-Origin` — opt-in via env var:

| Variável | Efeito |
|---|---|
| `GROUTER_CORS_ALLOW_ALL=true` | Envia `Access-Control-Allow-Origin: *` em todos os endpoints. |
| `GROUTER_CORS_ALLOW_ORIGIN=https://seu-dominio.tld` | Envia `Access-Control-Allow-Origin: <origem>` + `Vary: Origin`. |

Os outros headers são sempre enviados:

```
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

Sem nenhuma das duas variáveis setadas, browsers de outras origens vão receber CORS error — o que é o comportamento desejado quando o `grouter` está rodando como proxy local apenas para CLIs/SDKs server-side. Se você precisa do dashboard ou de um cliente browser apontando para o `grouter`, defina `GROUTER_CORS_ALLOW_ALL=true` (loopback OK) ou `GROUTER_CORS_ALLOW_ORIGIN` (produção).

---

## 12. Checklist rápido para integrar

1. `grouter serve on` — sobe o proxy em background.
2. `grouter add` — adiciona pelo menos uma conta de provider.
3. `grouter models` — confirma os IDs de modelo disponíveis.
4. Aponte seu cliente para `http://localhost:3099/v1` com API key `grouter`.
5. Use `provider/model` no campo `model` (ou conecte numa porta dedicada e passe só o modelo).

Pronto — daqui pra frente é OpenAI padrão.
