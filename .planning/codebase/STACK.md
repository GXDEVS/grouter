# Technology Stack

**Analysis Date:** 2026-04-22

## Languages

**Primary:**

- Typescript 5.5 **—** used throughout the `src` directory, compiled to ESNext by Bun.

**Secondary:**

- None.

## Runtime

**Environment:**

- Bun v1.x – run-time for bundling and server; no Node runtime needed.

**Package Manager:**

- Bun package manager – lockfile present: `bun.lock` in the root.
- Bundler: Bun build command `bun build index.ts`.

## Frameworks

**Core:**

- Bun (runtime & bundler) – for HTTP server and script execution.
- Commander – CLI argument parsing (`src/index.ts`).
- Chalk – terminal styling (`src/index.ts`).

**Testing:**

- None – no test frameworks detected.

## Key Dependencies

**Critical:**

- `@inquirer/prompts` ^8.4.1 – for interactive prompts in add/setup commands (`src/commands/add.ts`).
- `chalk` ^5.4.1 – color output (`src/commands/serve.ts`).
- `commander` ^14.0.3 – CLI parsing (`src/index.ts`).
- `open` ^11.0.0 – opens URLs in browser when adding accounts (`src/auth/server.ts`).
- `ora` ^9.3.0 – spinner for async ops (`src/commands/setup.ts`).

**Infrastructure:**

- SQLite via `bun:sqlite` – local database (`src/db/index.ts`).

## Configuration

**Environment:**

- `GITHUB_TOKEN`, `CHROME_EXTENSION_ID`, etc. (referenced in code only, values not included).

**Build:**

- `tsconfig.json`, `bun.lock`.

## Platform Requirements

**Development:**

- Bun available in PATH, Node 20.x for TypeScript tooling.

**Production:**

- Docker container defined by `docker-compose.yml` and `Dockerfile`.