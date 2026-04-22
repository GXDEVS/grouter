# Architecture

This document describes the runtime boundaries and extension points of `grouter`.

## Runtime topology

- `index.ts` is the CLI entrypoint and dispatches subcommands to `src/commands/*`.
- `grouter serve on` starts a daemon process that runs the proxy runtime.
- The runtime exposes:
  - Main router server on `proxy_port` (default `3099`).
  - One provider-pinned server per entry in `provider_ports` (default range starts at `3100`).

## Core layers

- `src/providers/registry.ts`: source of truth for provider metadata and feature flags.
- `src/auth/*`: OAuth adapters and session orchestration (`device_code`, `authorization_code`, `import_token`).
- `src/rotator/*`: account selection, sticky round-robin behavior, and model lock handling.
- `src/token/*`: OAuth refresh and account token state updates.
- `src/proxy/*`: upstream request building, translators, and Bun server entrypoints.
- `src/db/*`: SQLite schema, migrations, settings, account/pool persistence, and usage logging.
- `src/web/*`: dashboard pages plus `/api/*` handlers for management flows.
  - `api-providers-catalog.ts`: provider catalog/connections/models/config handlers.
  - `api-proxy-pools.ts`: proxy-pool CRUD/test handlers.
  - `api-providers.ts`: stable facade that re-exports provider-domain handlers.

## Request flow (`/v1/chat/completions`)

1. Request arrives at router or provider-pinned listener.
2. Account selection runs via `selectAccount()` based on strategy and lock state.
3. Token refresh executes when account credentials are near expiry.
4. Upstream payload and headers are built per provider rules.
5. Upstream response is normalized by provider-specific translators into OpenAI-compatible output.
6. Failure handling updates account health, lock cooldowns, and fallback routing state.

## Data and persistence

- All local state is stored in `~/.grouter/grouter.db` (SQLite).
- Key tables:
  - `accounts`: provider credentials, health, priority, lock/error state.
  - `model_locks`: transient per-model cooldown locks.
  - `settings`: runtime configuration (`strategy`, `sticky_limit`, `proxy_port`, feature flags).
  - `proxy_pools`: outbound proxy definitions and account pool bindings.
  - `provider_ports`: stable per-provider listener ports.
  - `usage_logs`: token/cost telemetry inputs.

## Static assets and build pipeline

- Logos and dashboard animation are embedded at build time:
  - `scripts/embed-logos.ts` -> `src/web/logos-embedded.ts`
  - `scripts/embed-animation.ts` -> `src/public/animation-embedded.ts`
- Runtime serves animation with `ETag`/`304` and gzip when supported.
- Production binary output is `dist/grouter`.

## Safety and change guardrails

- Keep provider metadata changes centralized in `registry.ts`.
- Add database columns through migration paths in `src/db/index.ts`.
- Preserve OpenAI-compatible response contracts for proxy endpoints.
- Prefer incremental, test-backed refactors in `src/web/api-*` and `src/proxy/*`.
- Validate every structural change with:
  - `bunx tsc -p tsconfig.json --pretty false`
  - `bun test`
  - `bun run build`
