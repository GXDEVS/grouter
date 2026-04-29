```
 ██████╗ ██████╗  ██████╗ ██╗   ██╗████████╗███████╗██████╗ 
██╔════╝ ██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██╔══██╗
██║  ███╗██████╔╝██║   ██║██║   ██║   ██║   █████╗  ██████╔╝
██║   ██║██╔══██╗██║   ██║██║   ██║   ██║   ██╔══╝  ██╔══██╗
╚██████╔╝██║  ██║╚██████╔╝╚██████╔╝   ██║   ███████╗██║  ██║
 ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝
```

**Universal AI router — OAuth + API Key providers behind one OpenAI-compatible endpoint.**
Run Claude Code, GitHub Copilot, Gemini CLI, Kiro, Kimi, KiloCode, Cursor and 15+ more through a single local proxy. No certificates, no MITM.

[![npm](https://img.shields.io/npm/v/grouter-auth.svg?color=blue)](https://www.npmjs.com/package/grouter-auth)
[![license](https://img.shields.io/github/license/GXDEVS/grouter.svg?color=blue)](./LICENSE)
[![bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A5%201.0-black)](https://bun.sh)
[![issues](https://img.shields.io/github/issues/GXDEVS/grouter.svg)](https://github.com/GXDEVS/grouter/issues)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Providers](#providers)
- [Commands](#commands)
- [Per-provider ports](#per-provider-ports)
- [Dashboard](#dashboard)
- [How it works](#how-it-works)
- [Development](#development)
- [Contributing](#contributing)
- [Support](#support)
- [Uninstall](#uninstall)
- [License](#license)

---

## Install

```bash
bunx grouter-auth setup
```

Or install globally:

```bash
bun install -g grouter-auth
grouter setup
```

> Requires [Bun](https://bun.sh) ≥ 1.0

---

## Quick start

```bash
# 1. Add a connection — wizard walks you through OAuth or API key per provider
grouter add

# 2. Start the proxy daemon (router on 3099, providers on 3100+)
grouter serve on

# 3. Wire your tool to it interactively
grouter up openclaude       # arrow-key picker → provider → model
```

Open the dashboard at **http://localhost:3099** to manage everything visually — add/remove connections, see live token usage per account, swap rotation strategy, tail logs.

### Using it programmatically

Any OpenAI-compatible client works:

```ts
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://localhost:3099/v1',
  apiKey: 'any-value',
})

const res = await client.chat.completions.create({
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Hello!' }],
})
```

Anthropic SDK clients (Claude Code, Cursor's anthropic mode, `@anthropic-ai/sdk`, etc.) work too via `POST /v1/messages` — same translation/rotation/retry pipeline, native Anthropic response shape:

```ts
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  baseURL: 'http://localhost:3099',
  apiKey: 'any-value',
})

const msg = await client.messages.create({
  model: 'anthropic/claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
})
```

Both endpoints (`/v1/chat/completions` and `/v1/messages`) are also available on every per-provider port (`:3100+`) — when you hit a pinned port, you can drop the `provider/` prefix from the model name.

---

## Providers

Every provider gets its own dedicated port so requests never get misrouted. The router on `:3099` picks any active account; the per-provider ports (`:3100`, `:3101`, …) pin the request to that provider's pool.

### OAuth providers (bring your subscription)

| Provider | Flow | Notes |
|---|---|---|
| **Qwen Code** | device_code | deprecated — existing accounts still work |
| **GitHub Copilot** | device_code | uses your Copilot subscription |
| **Kimi Coding** | device_code | **FREE** |
| **KiloCode** | device_code | **FREE** |
| **Kiro** (AWS SSO) | device_code | **FREE** — AWS Builder ID |
| **Claude** | auth_code + PKCE | Claude.ai subscription |
| **Codex** (OpenAI) | auth_code + PKCE | fixed port `1455` callback |
| **GitLab Duo** | auth_code + PKCE | bring your own OAuth app |
| **iFlow** | auth_code | **FREE** — returns a long-lived API key |
| **Qoder** | auth_code | device-token OAuth |
| **Cline** | auth_code | browser redirect |
| **Cursor** | import_token | paste token from Cursor IDE |
| **OpenCode** | free / no-auth | **FREE** — public shared endpoint |

### API-key providers

OpenRouter · Groq · DeepSeek · OpenAI · Anthropic · Google Gemini · NVIDIA NIM — add multiple keys per provider; all of them can round-robin.

Providers marked **FREE** need no credit card. Free-tier API keys (OpenRouter, NVIDIA, Gemini) are flagged with a badge in the dashboard.

---

## Commands

### Setup & connections

```bash
grouter setup             # Interactive onboarding (add → test → serve → openclaude)
grouter add               # Wizard — arrow-key pick a provider, run the right flow
grouter list              # Table: ID, email, status, priority, expiration
grouter remove <id>       # Remove by ID prefix or email
grouter enable <id>       # Re-enable a disabled connection
grouter disable <id>      # Skip a connection without deleting it
grouter test [id]         # Check upstream reachability
```

### Proxy daemon

```bash
grouter serve on          # Start in background
grouter serve off         # Stop the daemon
grouter serve             # Show status (router port + per-provider ports)
grouter serve restart     # Restart (kills stale processes holding the port)
grouter serve logs        # Tail the log
grouter serve fg          # Run in foreground (blocks terminal)
```

### Models & routing

```bash
grouter models                 # All providers, their ports, and model IDs
grouter models <provider>      # Zoom into one + copy-paste OPENAI_* examples
                             #   e.g. grouter models claude
```

### Tool integration

```bash
grouter up openclaude          # Wizard: pick provider (↑/↓) → pick model → write settings.json
grouter up openclaude --provider kiro --model claude-sonnet-4.5
grouter up openclaude --remove # Undo the integration
```

The wizard writes the env block to `~/.claude/settings.json` and injects `export` lines into `.bashrc` / `.zshrc` / `config.fish` (or a PowerShell profile on Windows).

### Monitoring

```bash
grouter status            # Token totals, estimated cost, active locks
grouter unlock [id]       # Clear rate-limit locks on one or all accounts
```

### Configuration

```bash
grouter config                            # Show current settings
grouter config --strategy round-robin     # fill-first (default) | round-robin
grouter config --port 3099                # Change router port
grouter config --sticky-limit 5           # Requests before rotating (round-robin)
```

---

## Per-provider ports

When you add the first connection for a provider, grouter allocates a dedicated port starting at `:3100`. This isolates provider routing cleanly:

```
$ grouter serve
  ● Proxy running   →  http://localhost:3099
  providers  kimi-coding:3100   claude:3101   kiro:3102
```

Point your tool at the specific port if you want to **pin a provider**:
```
OPENAI_BASE_URL=http://localhost:3100/v1   # forces Kimi
OPENAI_MODEL=kimi-k2.5
```

Or use the router (`:3099`) and grouter picks from all active accounts using the configured rotation strategy.

---

## Dashboard

Visit `http://localhost:3099/dashboard` once the proxy is running.

- Add/remove connections per provider with live OAuth flows (device-code, auth-code, token-paste)
- Stack multiple API keys per provider — visual pool
- Proxy pools: route specific connections through HTTP proxies
- Token/cost tracking per account, per model
- FREE badges on free-tier providers
- Multi-language (EN / PT / ZH)

---

## How it works

- **OAuth orchestrator** — pluggable adapters (`src/auth/providers/*.ts`) implement device-code / auth-code + PKCE / auth-code / import flows; one file per provider keeps diffs small.
- **Ephemeral callback listener** — spins up a local HTTP server on a random port (or `:1455` for Codex) to catch the OAuth redirect, then shuts it down.
- **Per-provider listeners** — each provider registered in `provider_ports` gets its own `Bun.serve` instance that forces the provider on every request.
- **Auto token refresh** — each adapter owns its refresh logic; GitHub's short-lived copilot token is cached separately in `provider_data`.
- **Rotation strategies** — `fill-first` (stay on highest-priority until it rate-limits) or `round-robin` (cycle with configurable stickiness).
- **Zero external services** — everything runs locally, data lives in `~/.grouter/grouter.db` (SQLite).

---

## Development

Want to hack on grouter? Runtime is [Bun](https://bun.sh) only.

```bash
git clone https://github.com/GXDEVS/grouter.git
cd grouter
bun install

bun run dev           # hot-reload, foreground proxy (bun --hot index.ts serve fg)
bun run start         # foreground proxy, no hot-reload
bun run build         # embeds logos, bundles to dist/grouter
bun run deploy        # build + bun link (refresh the globally-linked binary)
bun test              # Bun test runner
```

Alternative one-shot setup (installs deps + `bun link` in one step):

```bash
bash setup.sh
```

Project layout:

```
index.ts              # CLI entry — commander wiring
src/
├── commands/         # one file per subcommand (add, serve, list, …)
├── auth/
│   ├── orchestrator.ts
│   └── providers/    # one adapter per provider (device_code / auth_code + PKCE / import)
├── providers/
│   └── registry.ts   # single source of truth for provider metadata
├── proxy/            # Bun.serve listeners, upstream builder, translators
├── rotator/          # account selection + strategies
├── token/            # OAuth refresh
├── db/               # SQLite schema + silent migrations
├── web/              # dashboard + wizard (served as text imports)
└── update/           # update banner
scripts/
└── embed-logos.ts    # prebuild — emits src/web/logos-embedded.ts
```

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture guide — request flow, provider-registry rules, database migration conventions, and Bun-first runtime defaults.

---

## Contributing

PRs are welcome. The project ships with a skill at `.claude/skills/contribute/` that walks contributors through the full flow if you use Claude Code; the summary below is the same contract.

### 1. Branch naming

```
<type>/<short-kebab-description>
```

Lowercase, kebab-case, under 60 chars. Types:

| Prefix | Use for |
|---|---|
| `feat/` | new user-visible capability (new provider, CLI command, dashboard view) |
| `fix/` | bug fix |
| `hotfix/` | urgent production fix |
| `refactor/` | internal restructuring, no behavior change |
| `perf/` | performance improvement |
| `chore/` | deps, build, tooling |
| `docs/` | README, CLAUDE.md, comments |
| `test/` | tests only |
| `ci/` | `.github/workflows`, release pipelines |
| `release/` | release prep (e.g. `release/v4.8.0`) |

Examples: `feat/add-zai-provider`, `fix/token-refresh-race`, `perf/sqlite-wal-mode`, `chore/bump-commander`.

### 2. Commits — Conventional Commits

```
<type>(<scope>): <short imperative description>

<optional body — why, not what>

<optional footer — BREAKING CHANGE: …, Refs: …, Closes #123>
```

Rules:

- Subject ≤ 72 chars, imperative mood, lowercase after the colon, no trailing period.
- One logical change per commit — stage explicit files, never `git add -A`.
- No emojis in subject, body, or footer.
- No `Co-Authored-By: <AI assistant>` / "Generated with …" footers.
- Scopes match the directory layout: `auth`, `auth/<provider>`, `proxy`, `proxy/upstream`, `rotator`, `token`, `db`, `providers`, `commands`, `commands/<cmd>`, `web`, `web/dashboard`, `update`, `cli`, `build`.

Commit types: `feat`, `fix`, `refactor`, `perf`, `chore`, `docs`, `style`, `test`, `build`, `ci`, `revert`. Use `wip` only on private branches that will be squashed before merge.

### 3. Adding a new provider

1. Add an entry to `PROVIDERS` in `src/providers/registry.ts` (models, colors, auth type, deprecation flag).
2. Drop `src/auth/providers/<id>.ts` exporting an `OAuthAdapter` (`device_code` / `auth_code` + optional PKCE / `import_token`).
3. Register it in `src/auth/providers/index.ts`.
4. Add any provider-specific upstream quirks to `src/proxy/upstream.ts`.
5. Drop a PNG at `src/public/logos/<id>.png` — the prebuild step picks it up on the next `bun run build`.

New columns on `accounts` go in the silent-migration `ALTER TABLE` block in `src/db/index.ts`, **not** in the initial `CREATE TABLE` — existing users already have their database.

### 4. Pull request

1. Push: `git push -u origin <branch>`.
2. Open PR: `gh pr create` (title mirrors the primary commit).
3. PR body:

   ```markdown
   ## Summary
   - what changed, in plain terms
   - why this approach
   - anything reviewers should look at first

   ## Test plan
   - [ ] concrete manual or automated check
   - [ ] `bun test` passes (or note why it's not relevant)
   - [ ] `bun run build` succeeds
   ```

4. Do not force-push to `main`. Do not `--no-verify` commit hooks. Do not amend a commit that was already pushed.
5. CI must be green before merge.

### Questions first

For non-trivial changes (new provider with odd OAuth flow, schema migration, rotator behavior), **open an issue first** so we can align on the approach before you invest time in the PR.

---

## Support

- **Bugs & feature requests** → [GitHub Issues](https://github.com/GXDEVS/grouter/issues)
- **Security issues** → do not open a public issue. Email the maintainer or use GitHub's private vulnerability reporting.
- **Architecture questions** → [`CLAUDE.md`](./CLAUDE.md) covers the request flow, DB schema, and provider-registry contract.

---

## Uninstall

```bash
bun uninstall -g grouter-auth

# Remove stored accounts and data (optional)
rm -rf ~/.grouter
```

---

## License

MIT © gxdev
