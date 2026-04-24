# External Integrations

**Analysis Date:** 2026-04-22

## Auth Providers

**[OAuth & API Key Providers](src/auth/providers/):**

- `qwenAdapter` – Handles Qwen OAuth (service: *Qwen*, client library: none, uses `fetch` to `https://portal.qwen.ai/...`). Path: `src/auth/providers/qwen.ts`.
- `githubAdapter` – Handles GitHub OAuth (service: *GitHub*, client library: none, uses `fetch` to GitHub API). Path: `src/auth/providers/github.ts`.
- `gitlabAdapter` – Handles GitLab OAuth (service: *GitLab*, client library: none). Path: `src/auth/providers/gitlab.ts`.
- `kliffeAdapter` – Handles Kili provider (service: *Kili*, client library: none). Path: `src/auth/providers/kili.ts`.
- `geminiCliAdapter` – Handles Gemini CLI OAuth with client credentials (service: *Google Gemini*, client library: uses `node:fetch`, required client ID/secret; keys are stored in environment variables).
- `githubCopilotAdapter` – Integrates GitHub Copilot metadata.
- `cursorAdapter` – Integrates Cursor authentication.
- `oktaAdapter` – Integrates Okta.

## External API Clients

- **Qwen** – REST API via `https://portal.qwen.ai` use. Path: `src/common/constants.ts` contains base URLs.
- **GitHub** – REST API via `https://api.github.com`. Path: `src/auth/providers/github.ts` and `src/auth/providers/github-copilot.ts`.
- **Google Gemini** – Accessed via `gemini-cli`. Path: `src/auth/providers/gemini-cli.ts`.
- **Qwen OAuth** – Accessed via OpenAI-compatible endpoints.

## External Services / Infrastructure

- **Docker Compose** – Runtime orchestration for grouter container (file `docker-compose.yml`).
- **Bun** – JavaScript/TypeScript runtime (used as build & run tool). See `package.json`.
- **SQLite** – Local database via `bun:sqlite` module (used in `src/db/index.ts`).
- **OpenAI-Compatible Local Proxy** – The main service routes requests to various providers.

## Key Packages (npm)

- `@inquirer/prompts` – User prompts (interactive CLI).
- `chalk` – ANSI styling.
- `commander` – CLI command parser.
- `open` – Opens URLs in default browser.
- `ora` – Terminal spinner.
- `bun` (runtime) – Build tool.
- `axios` – (none used) – not present.

## Environment Variables

The project expects a set of environment variables (e.g., `OPENAI_API_KEY`, `GITHUB_TOKEN`, `QWEN_CLIENT_ID`). Presence of `.env` or similar files is detected but contents are not exposed.

---

*Integration audit: 2026-04-22*