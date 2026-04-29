# Changelog

All notable changes to **grouter** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The dashboard reads this file directly from
`https://raw.githubusercontent.com/GXDEVS/grouter/main/CHANGELOG.md`
to surface release notes and notify when a newer version is available.

## [5.5.0] - 2026-04-29

### Added
- **`/v1/messages` endpoint** — full Anthropic Messages API support on the
  router and per-provider listeners. Translates Anthropic ↔ OpenAI in both
  directions (request body, non-stream response, SSE stream).
- **Headless OAuth callback mode** — set `GROUTER_PUBLIC_URL=https://your.host`
  to route OAuth redirects through `<PUBLIC_URL>/oauth/callback` instead of an
  ephemeral local listener. Works in K8s/VPS/containers where the user's
  browser cannot reach the container's localhost.
- **`grouter add --callback-host <host> [--callback-port <port>]`** — force a
  specific bind for the OAuth listener. Manual paste prompt opens after 8s if
  the callback never reaches the listener.
- **`API.md`** committed to the repo with the full HTTP reference (status,
  models, chat completions, messages, auth flows, CORS).

### Fixed
- `grouter list` and other CLI commands no longer hang for ~5 minutes — the
  orchestrator session sweeper is now `unref()`-ed.

## [5.4.0] - 2026-04-29

### Changed
- **Modular proxy split** — `src/proxy/server.ts` is now a slim router; the
  hardened `handleChatCompletions` lives in `src/proxy/chat-handler.ts` and
  shared state (`DISABLED_PROVIDER_IDS`) in `src/proxy/server-helpers.ts`.

### Added
- **3-layer upstream timeouts** via `AbortController`: 20s first-byte, 45s
  stream-idle, 120s total request.
- **Provider-specific recovery paths** — Codex `-high` model fallback, Codex
  401 retry (drop `ChatGPT-Account-ID` + forced refresh), Gemini capacity
  fallback (3.1-pro → 2.5-pro → 2.5-flash), large-request body trim and
  history compaction.
- **Refined fallback semantics** — auth failures (401/402/403) rotate without
  long cooldowns; rate limits (429 + structured markers) get exponential
  backoff up to level 15; transient 5xx get 5s cooldown.

## [5.3.0] - 2026-04-21

### Added
- **Free-tier providers** — gate models exposed by `provider_free_only_<id>`.
- **Custom model picker** in the wizard.
- **Codex translator** — translate Claude-style upstream into OpenAI
  `chat.completions` SSE/non-stream.
- **Provider under-construction state** in the registry; SambaNova is gated
  while its OAuth flow is being reviewed.

### Fixed
- Docker install lifecycle — skip the install hook so `prebuild` doesn't run
  before `scripts/` is copied into the image.

## [5.2.2] - 2026-04-20

### Fixed
- Codex OAuth flow + proxy compatibility hardening.

### Added
- Dashboard now shows the running version dynamically (no more hardcoded
  "5.x").

## [5.2.1] - 2026-04-20

### Fixed
- `npm install -g grouter-auth` now works — `bin` points to `dist/grouter`
  instead of the missing source path.

## [5.2.0] - 2026-04-20

### Added
- **Advanced Client API Keys** — per-key permissions, expiry, rate limits.
- **Custom Providers** — define your own OpenAI-compatible upstream from the
  dashboard.
- **OpenRouter enhancements** — refreshed model catalog and pricing.

### Fixed
- Removed hardcoded `qwen` as the default provider in several code paths.
- Dashboard language switching is now instant and persists across reloads;
  fixed a race condition that occasionally swapped languages mid-render.

## [5.1.0] - 2026-04-18

### Added
- First public **grouter** release after the rebrand from `gqwen-auth`.
- 15+ provider catalogue (Qwen, Claude, Codex, GitHub Copilot, Gemini, Kimi,
  Kiro, KiloCode, GitLab Duo, Cursor, OpenRouter, Groq, DeepSeek, …).
- Single-file Bun binary build (`bun build --target bun`).
- SQLite state in `~/.grouter/grouter.db` with idempotent silent migrations.
- Dashboard + setup wizard served from the embedded HTML files.

[5.5.0]: https://github.com/GXDEVS/grouter/releases/tag/v5.5.0
[5.4.0]: https://github.com/GXDEVS/grouter/releases/tag/v5.4.0
[5.3.0]: https://github.com/GXDEVS/grouter/releases/tag/v5.3.0
[5.2.2]: https://github.com/GXDEVS/grouter/releases/tag/v5.2.2
[5.2.1]: https://github.com/GXDEVS/grouter/releases/tag/v5.2.1
[5.2.0]: https://github.com/GXDEVS/grouter/releases/tag/v5.2.0
[5.1.0]: https://github.com/GXDEVS/grouter/releases/tag/v5.1.0
