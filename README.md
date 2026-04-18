```
 ██████╗  ██████╗ ██╗    ██╗███████╗███╗   ██╗
██╔════╝ ██╔═══██╗██║    ██║██╔════╝████╗  ██║
██║  ███╗██║   ██║██║ █╗ ██║█████╗  ██╔██╗ ██║
██║   ██║██║▄▄ ██║██║███╗██║██╔══╝  ██║╚██╗██║
╚██████╔╝╚██████╔╝╚███╔███╔╝███████╗██║ ╚████║
 ╚═════╝  ╚══▀▀═╝  ╚══╝╚══╝ ╚══════╝╚═╝  ╚═══╝
```

**Universal AI router — OAuth + API Key providers behind one OpenAI-compatible endpoint.**
Run Claude Code, GitHub Copilot, Gemini CLI, Kiro, Kimi, KiloCode, Cursor and 15+ more through a single local proxy. No certificates, no MITM.

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

## Uninstall

```bash
bun uninstall -g grouter-auth

# Remove stored accounts and data (optional)
rm -rf ~/.grouter
```

---

## License

MIT © gxdev
