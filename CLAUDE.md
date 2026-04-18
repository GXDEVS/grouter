# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`grouter` (package `grouter-auth`) is a CLI + local OpenAI-compatible proxy that aggregates OAuth and API-key accounts across 15+ AI providers (Qwen, GitHub Copilot, Claude, Codex, Gemini, Kimi, Kiro, KiloCode, GitLab Duo, Cursor, OpenRouter, Groq, DeepSeek, etc.) behind a single local endpoint. Built as a Bun single-file binary — no external services, state lives in `~/.grouter/grouter.db` (SQLite).

## Commands

```bash
bun run dev             # bun --hot index.ts serve fg  (foreground, hot-reload)
bun run start           # Foreground proxy (no hot-reload)
bun run build           # Pre-embeds logos, bundles to dist/grouter (chmod +x)
bun run deploy          # build + bun link — refresh the globally-linked binary
bun test                # Run Bun tests (none currently — add alongside code)
bun test path/to/file.test.ts   # Single test file

# CLI (once built + linked, or via `bun index.ts <cmd>`)
grouter setup             # First-run wizard
grouter add               # Arrow-key picker → add a provider connection
grouter serve on|off|fg|logs|restart|status
grouter models [provider]
grouter up openclaude [--provider X --model Y]
grouter list | test [id] | enable/disable <id> | remove <id> | unlock [id]
grouter config [--strategy fill-first|round-robin] [--port N] [--sticky-limit N]
```

The `prebuild` script (`scripts/embed-logos.ts`) reads `src/public/logos/*.png` and emits `src/web/logos-embedded.ts` with base64 constants — this is what makes logos work inside the single-file bundled binary. Never edit `logos-embedded.ts` by hand.

## Architecture

### Entry point and command layer
`index.ts` wires `commander` subcommands to handlers in `src/commands/*.ts`. The hidden `_daemon` subcommand is the entrypoint the detached background proxy spawns — never call it directly.

### Proxy server (`src/proxy/`)
`serve on` spawns a detached child (`_daemon`) that runs `startAllServers()`:
- **Router** on `:3099` (configurable) — picks any active account across all providers using the rotation strategy.
- **Per-provider listeners** on `:3100+` — each provider with registered accounts gets its own `Bun.serve` instance that **pins** the provider on every request. Port allocation lives in the `provider_ports` table.

Request flow for `/v1/chat/completions`:
1. `selectAccount()` in `src/rotator/index.ts` picks a connection by provider + model, respecting model-locks and strategy (`fill-first` vs `round-robin` with stickiness).
2. `checkAndRefreshAccount()` in `src/token/refresh.ts` refreshes OAuth tokens within `TOKEN_EXPIRY_BUFFER_MS`.
3. `buildUpstream()` in `src/proxy/upstream.ts` constructs the upstream URL + headers per provider.
4. On upstream error, `checkFallbackError()` + `markAccountUnavailable()` applies cooldowns from `src/constants.ts` (unauthorized → 15min, payment → 1hr, transient → 5s, rate-limit → exponential backoff up to level 15).
5. Claude-style upstream formats are translated to OpenAI chat.completions SSE/non-stream via `claude-translator.ts`.

### Provider registry and auth
`src/providers/registry.ts` is the source of truth for provider metadata (models, colors, logos, auth type, deprecation flags). Every provider in the `PROVIDERS` record must have a matching **OAuth adapter** in `src/auth/providers/<id>.ts` (exported via `src/auth/providers/index.ts`) implementing one of: `device_code`, `auth_code` (+ optional PKCE), or `import_token`. `src/auth/orchestrator.ts` owns the session state machine — pending sessions are held in-memory with a 10-minute TTL.

When adding a new provider:
1. Add entry to `PROVIDERS` in `src/providers/registry.ts`.
2. Drop `src/auth/providers/<id>.ts` exporting an `OAuthAdapter`.
3. Register it in `src/auth/providers/index.ts`.
4. Add any provider-specific upstream quirks to `src/proxy/upstream.ts`.
5. If it needs a logo, add PNG to `src/public/logos/` — embed step picks it up automatically on next build.

### Database (`src/db/`)
`src/db/index.ts` owns the schema and runs **idempotent silent migrations** at startup (adds missing columns to `accounts` via `ALTER TABLE`). Schema:
- `accounts` — connections (OAuth tokens, API keys, provider, priority, backoff state, test status).
- `model_locks` — per-account per-model cooldowns (rate-limit isolation).
- `settings` — key/value (strategy, sticky_limit, proxy_port).
- `proxy_pools` + `accounts.proxy_pool_id` — route per-account traffic through HTTP proxies.
- `provider_ports` — persistent per-provider port allocation starting at 3100.
- `usage_logs` — token counts per request (powers the dashboard + cost estimation from `MODEL_PRICING` in `constants.ts`).

New columns on `accounts` must be added as `ALTER TABLE` in the silent-migration block, not in the initial `CREATE TABLE` — existing users have already-created databases.

### Dashboard / Wizard (`src/web/`)
`dashboard.html` and `wizard.html` are served as static text imports (`with { type: "text" }`) so they bundle into the single binary. `src/web/api.ts` exposes `/api/*` endpoints consumed by the HTML pages. Logos are served by `src/web/logos.ts` from the embedded base64 (or from disk in dev if the embedded file is missing).

### Update banner
`src/update/checker.ts` prints a cached banner synchronously (DB-backed, never blocks) and fires a non-blocking background refresh against the npm registry (`https://registry.npmjs.org/grouter-auth/latest`). Skip commands: `update`, `serve`, `_daemon`.

## Conventions

- **Bun-first.** TS files use `.ts` extensions in imports (`allowImportingTsExtensions: true`). Runtime is Bun only — don't introduce Node-only APIs when Bun has a native equivalent (see runtime notes below).
- **File organization.** Keep one adapter per provider file; one command per file in `src/commands/`. Avoid cross-command imports — shared logic goes under `src/{rotator,token,proxy,db,providers}`.
- **Deprecated providers** (`deprecated: true` in registry) still serve existing accounts but reject new sign-ups in the orchestrator. Don't remove deprecated provider code without a migration path.
- **Error codes** on accounts drive UI (`test_status`, `last_error`, `error_code`, `backoff_level`). Always update these via `updateAccount()` / `markAccountUnavailable()`, not ad-hoc SQL.

## Bun runtime defaults

- Use `bun <file>` instead of `node` or `ts-node`.
- Use `bun test` instead of `jest`/`vitest`.
- Use `bun build` instead of `webpack`/`esbuild`.
- Use `bun install` / `bun run <script>` / `bunx <pkg>`.
- Bun auto-loads `.env` — don't use `dotenv`.
- Prefer `Bun.serve()` (don't use `express`), `bun:sqlite` (not `better-sqlite3`), `Bun.redis`, `Bun.sql`, built-in `WebSocket`, `Bun.file`, `Bun.$` (not `execa`).
