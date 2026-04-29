## Codebase Structure

**Analysis Date:** 2026-04-22

## Directory Layout

```
[project-root]/
├── .claude/                # Skill definitions
├── .github/
├── .idea/
├── .planning/
│   └── codebase/
│       └── (generated documents)
├── scripts/
│   ├── fetch-official-logos.ts
│   ├── embed-logos.ts
│   └── setup.sh
├── src/
│   ├── auth/
│   │   ├── providers/
│   │   │   ├── github.ts
│   │   │   ├── gitlab.ts
│   │   │   ├── google-... (other OAuth providers)
│   │   │   └── index.ts
│   │   ├── server.ts
│   │   ├── types.ts
│   │   └── ...
│   ├── commands/
│   │   ├── add.ts
│   │   ├── list.ts
│   │   ├── remove.ts
│   │   ├── test.ts
│   │   ├── serve.ts
│   │   ├── setup.ts
│   │   ├── models.ts
│   │   └── ...
│   ├── db/
│   │   ├── accounts.ts
│   │   ├── client_keys.ts
│   │   ├── index.ts
│   │   ├── pools.ts
│   │   ├── ports.ts
│   │   ├── usage.ts
│   │   └── models.ts
│   ├── providers/
│   │   ├── registry.ts
│   │   ├── model-fetcher.ts
│   │   └── logo-sources.ts
│   ├── proxy/
│   │   ├── server.ts
│   │   ├── upstream.ts
│   │   ├── claude-translator.ts
│   │   ├── gemini-translator.ts
│   │   └── codex-translator.ts
│   ├── rotator/
│   │   └── index.ts
│   ├── index.ts
│   ├── constants.ts
│   ├── update/
│   │   └── checker.ts
│   └── web/
│       ├── api.ts
│       ├── logos.ts
│       ├── wizard.html
│       └── dashboard.html
├── index.ts (CLI entrypoint)
├── package.json
├── tsconfig.json
└── README.md
```

## Directory Purposes

- `**src/auth/**` – OAuth flow management and provider adapters.
- `**src/commands/**` – CLI command implementations (add, list, serve, etc.).
- `**src/db/**` – Persistent storage for accounts, keys, and runtime state.
- `**src/providers/**` – Registry of external API providers and model discovery helpers.
- `**src/proxy/**` – Request dispatching and translation to provider-specific formats.
- `**src/rotator/**` – Automatic account rotation logic.
- `**src/web/**` – Embedded static assets and API routes served by the proxy.
- `**scripts/**` – Utility scripts for logo fetching, packaging, and Docker setup.
- `**./planning/codebase/**` – Generated architectural analysis documents.

## Key File Locations

- **Entry Points:**
  - `[src/index.ts]`: Main CLI bootstrap.
  - `[src/web/api.ts]`: REST API route definitions.
- **Configuration:**
  - `[tsconfig.json]`, `[package.json]`.
- **Core Logic:**
  - `[src/proxy/upstream.ts]`: Builds upstream requests.
  - `[src/proxy/server.ts]`: Handles incoming API calls.
- **Authentication:**
  - `[src/auth/server.ts]`: OAuth callback handler.
  - `[src/auth/providers/]`: Implements provider-specific flows.
- **Database Layer:**
  - `[src/db/accounts.ts]`, `[src/db/client_keys.ts]`.
- **Utility Scripts:**
  - `[scripts/fetch-official-logos.ts]`, `[scripts/embed-logos.ts]`.

## Naming Conventions

- **Files:** snake_case for scripts and utilities, kebab-case for bundles, and PascalCase for modified components.
- **Directories:** descriptive snake_case or kebab-case.

## Adding New Code

- **New Feature Module:** Create `src/features/<name>/` with `index.ts` and relevant sub‑modules.
- **Tests:** Place in `src/features/<name>/__tests__/` mirroring structure.
- **Static Assets:** Add to `src/web/` or `src/public/` and reference via `serveLogo`.

## Special Directories

- `**.claude/`:** Maven repository for custom logicbits.
- `**.idea/`:** IDE project settings (non‑source).
- `**scripts/`:** Build and deployment helpers.

---

*Structure analysis: 2026-04-22*