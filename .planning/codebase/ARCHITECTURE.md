# Architecture

**Analysis Date:** 2026-04-22

## Pattern Overview

**Overall:** Layered monolithic API server with CLI management and provider subsystems (OAuth/API‑key). The codebase is a single running process written in TypeScript and built with Bun.

**Key Characteristics:**

- **Monolithic Service** – one binary `dist/grouter` exposes both a command line interface and an HTTP server.
- **Layered Architecture** – logical layers (CLI, command‑handlers, API router, provider‑specific translations, DB persistence, rotator, translation). Each layer has a clear responsibility and thin interfaces.
- **Provider Registry** – `src/providers/registry.ts` holds metadata for each supported provider (name, auth type, categories, ports). `src/providers/model‑fetcher.ts` retrieves the list of models from the registry or from the DB.
- **Translation Layer** – `src/proxy/*.translator.ts` translates responses from Claude, Gemini, Codex etc. into the OpenAI completion format.
- **Rotator** – `src/rotator/index.ts` cycles through available accounts per provider, handling rate‑limit & temporary failures.
- **Caching** – `fetchModels` caches the model list across requests with a 10‑minute TTL.
- **Configuration** – Settings are read from the DB (`src/db/index.ts`) and exported via `handleGetConfig`. Environment variables are avoided; all configuration is stored in SQLite.
- **Unit‑Testable** – Functions are pure where possible; context is passed through parameters instead of global state.
- **Built with Bun** – fast startup, native SSE support, bundler‑style `tsconfig.json`, single‑file `dist/grouter`.

## Layers

**CLI Layer**

- **Purpose:** Kick‑starting the binary with commands such as `grouter serve`, `grouter add`, `grouter list`.
- **Location:** `src/index.ts`, `src/commands/**/*.ts`.
- **Contains:** Argument parsing, commander handlers, logging.
- **Depends on:** Database, rotator, provider registry.
- **Used by:** Startup entry points.

**Command‑Handler Layer**

- **Purpose:** Separate business logic for each `grouter <subcommand>`.
- **Location:** `src/commands/*.ts`.
- **Contains:** Handlers for `serve`, `add`, `remove`, `list`, `update`, `keys`, `toggle`, etc.
- **Depends on:** DB, rotator, API (for `serve`), provider registry.
- **Used by:** CLI.

**API Router Layer**

- **Purpose:** Route HTTP requests to the appropriate handler.
- **Location:** `src/web/api.ts`.
- **Contains:** Endpoints: `/v1/models`, `/v1/chat/completions`, `/api/auth/`*, `/api/accounts/`*, `/api/providers/*`, `/api/config`, `/health`.
- **Depends on:** Core business logic – `handleChatCompletions`, `buildUpstream`, `getModelsForProvider`, `selectAccount`.
- **Used by:** HTTP server.

**Translation Layer**

- **Purpose:** Convert provider‑specific response formats to OpenAI‑compatible responses.
- **Location:** `src/proxy/claude‑translator.ts`, `gemini‑translator.ts`, `codex‑translator.ts`.
- **Contains:** `translateClaudeNonStream`, `claudeChunkToOpenAI`, etc.
- **Depends on:** API router logic.
- **Used by:** API router.

**Provider Layer**

- **Purpose:** Abstract provider details – auth types, model lists, endpoint servers.
- **Location:** `src/providers/registry.ts`, `src/providers/model‑fetcher.ts`, `src/proxy/server.ts`.
- **Contains:** `PROVIDERS` map, `getProvider`, startup of dedicated provider servers via `ensureProviderServer`.
- **Depends on:** DB, rotator.
- **Used by:** API router, rotator.

**Rotator Layer**

- **Purpose:** Rotate accounts per provider, handle rate limits and temporary unavailability.
- **Location:** `src/rotator/index.ts`.
- **Contains:** `selectAccount`, `markAccountUnavailable`, `clearAccountError`.
- **Depends on:** DB, provider layer.
- **Used by:** API router (chat completion path).

**DB Layer**

- **Purpose:** Persistence for accounts, client keys, usage statistics, config.
- **Location:** `src/db/**/*.ts`.
- **Contains:** SQLite schema, CRUD helpers, telemetry.
- **Depends on:** None – pure storage.
- **Used by:** All layers that require persistence.

## Data Flow

**From Client to Provider (`/v1/chat/completions`)**

1. Client POSTs to `/v1/chat/completions` with `model: "provider/model"`.
2. `api.ts` calls `handleChatCompletions` → parses provider & model.
3. `rotator.selectAccount` picks an account (rotating if needed).
4. `buildUpstream` constructs the upstream request (URL, headers, body, translation format).
5. `fetch` forwards the request to the provider (optional proxy server).
6. Response received – if streaming, wrapped with Translator translators; otherwise translated sync.
7. Result returned to client in OpenAI completion format.

**From Server to Client (Static Assets)**

- Requests under `/public/` are served by `web/server.ts` via `serveLogo`, `ANIMATION_JS` etc.

## Key Abstractions

- **PROVIDERS (registry)** – `src/providers/registry.ts` (`PROVIDERS` map). Tracks provider metadata and port.
- **ModelFetcher** – `src/providers/model‑fetcher.ts` resolves model lists per provider.
- **UpstreamBuilder** – `src/proxy/upstream.ts` constructs the request that is sent to the provider or translated.
- **Translator** – provider‑specific translator modules convert to OpenAI schema.
- **Rotator** – `src/rotator/index.ts` contains rotation logic per account.
- **Command Handlers** – `src/commands/*.ts` isolate CLI logic.

## Entry Points

- **CLI:** `src/index.ts` – uses commander to expose subcommands.
- **HTTP Server:** `src/web/server.ts` – exposes routes defined in `api.ts`.
- **Daemon Start:** `src/commands/serve.ts` – background process that starts `serveOnCommand`.
- **Update Checker:** `src/update/checker.ts` – background version check.

## Error Handling

- Uses `logReq` for structured logging.
- HTTP errors (400, 401, 403, 429, 503, 502, 500, 404) returned with JSON payload.
- Rotator flags accounts as unavailable on failure, logs, and excludes them for the remainder of the retry loop.
- Program exits with non‑zero exit codes on fatal CLI errors.

## Cross‑Cutting Concerns

- **Logging:** `chalk` colorized console logs via `logReq`.
- **Configuration:** `getSetting`, `handleSetConfig`, persisted in SQLite.
- **Rate‑Limit handling:** `rotator` exposes `retryAfterHuman`.
- **Authentication:** OAuth flow integrated; API key flows handled.
- **Security:** No secrets stored in code (config is external). Database credentials are read from environment at runtime.

---

*Architecture analysis: 2026‑04‑22*