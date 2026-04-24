# Coding Conventions

**Analysis Date:** 2026-04-22

## Naming Patterns

**Files:**

- Lowercase letters with hyphens for separation, e.g. `serve.ts`, `test.ts`. File names map closely to the command or purpose.

**Functions:**

- Exported functions use camelCase, e.g. `serveCommand`, `testCommand`. No leading underscores.

**Variables / Constants:**

- Use camelCase for variables and constants. Constants that represent configuration or flags may be prefixed with uppercase if they are exported env constants.

**Types / Interfaces:**

- PascalCase, e.g. `Connection`, `ModelLock`.

## Code Style

**Formatting:**

- `prettier` is used for formatting (see `.prettierrc`). Settings include single quotes, 2‑space indentation. Code follows `ESNext` syntax.

**Linting:**

- `eslint` (or `biome`) enforces strict type-checking, no unused variables, and catch potential runtime errors.

## Import Organization

**Order:**

1. Node core or third‑party packages (`chalk`, `ora`, `node:fs`).
2. Local relative imports (`../db/accounts.ts`).

**Path Aliases:**

- No custom aliases defined; imports are relative.

## Error Handling

- Synchronous errors are caught in `try/catch` blocks and logged via `chalk.red`.
- Asynchronous errors in promises chain are handled with `.catch` or `async/await` try/catch.
- Network requests are wrapped with `AbortSignal.timeout` to avoid indefinite hangs.

## Logging

- Uses `chalk` for colorized console output:
  - `chalk.green` for success, `chalk.yellow` for warnings, `chalk.red` for failures.
  - `chalk.gray` for ancillary info.

## Comments

- Comments describe purpose at file level.
- Function JSDoc comments are sparse; most functions have inline comments explaining key steps.
- No overly verbose comments; focus on non‑obvious intent.

## Function Design

**Size:**

- Keep functions < 60 lines of logic; split complex logic into helper functions.

**Parameters:**

- Prefer descriptive names; optional parameters are grouped into objects.

**Return Types:**

- Functions return void or value; async functions resolve to primitives.

## Module Design

**Exports:**

- Each module exports a single primary function or several utility functions.
- Re‐export of types (e.g., `export type { Connection } from './types'`).

**Barrel Files:**

- Not used heavily; only minimal barrel like `providers/index.ts` re‑exports provider modules.

---

*Convention analysis: 2026-04-22*