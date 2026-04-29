---

## name: install
description: Walks a user through installing and first-running grouter on their machine. Detects their environment (bun / docker / neither), picks the right install path (bunx one-shot, global bun install, from-source build, or docker compose), verifies the binary is on PATH, and optionally kicks off `grouter setup` / `grouter add` / `grouter serve on`. Use when the user asks to install, set up, bootstrap, reinstall, or uninstall grouter, or says their `grouter` command is missing. Trigger phrases: "install grouter", "setup grouter", "bootstrap grouter", "grouter not found", "how do I install this", "instalar grouter", "como instalo", "subir o projeto", "deploy local", "reinstall", "uninstall grouter".

# grouter — Install & First-Run Flow

Get a user from zero to a running `grouter serve` with a working proxy at `http://localhost:3099`. There are four install paths — pick one with the user, don't run all of them.

## Ground rules

1. **Never `sudo`.** grouter installs to the user's `~/.bun/bin` (or runs in a container). If a command seems to need root, stop and ask.
2. **Never overwrite the user's shell config silently.** PATH fixes get printed as a one-liner for the user to run, not injected.
3. **Don't wipe `~/.grouter/`.** That's where accounts and the SQLite DB live. Uninstall removes the binary only unless the user explicitly asks to drop data.
4. **Verify at each step.** After install, confirm `grouter --version` works before moving to first-run.
5. **Confirm before actions that touch global state** (global `bun install -g`, `bun link`, `docker compose up`, writing to `~/.claude/settings.json`).

## Step 0 — Detect the environment

Run in parallel:

```bash
bun --version 2>/dev/null || echo "NO_BUN"
docker --version 2>/dev/null || echo "NO_DOCKER"
command -v grouter && grouter --version 2>/dev/null || echo "NO_GROUTER"
echo "$PATH" | tr ':' '\n' | grep -E "\.bun/bin$" || echo "BUN_BIN_NOT_IN_PATH"
uname -s
```

Decision:


| State                                                | Recommend                                                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `bun` present, user just wants to try                | **Path A — bunx**                                                                                                       |
| `bun` present, user wants permanent install          | **Path B — global install**                                                                                             |
| Inside a clone of the repo, contributor              | **Path C — from source**                                                                                                |
| `docker` present, no bun, or user prefers containers | **Path D — docker**                                                                                                     |
| Neither bun nor docker                               | Stop — install [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`) or Docker first. Tell the user which. |


If `grouter` is already on PATH, ask whether the user wants to **upgrade** (rerun their original install path) or **reinstall fresh** (uninstall → install).

## Path A — bunx (one-shot, no install)

Best for: "just let me try it".

```bash
bunx grouter-auth setup
```

That's it. No global install, no PATH fiddling. Skip to Step 2 (first-run) — `bunx` runs the setup wizard directly.

## Path B — global install via bun

Best for: permanent install, no git clone.

```bash
bun install -g grouter-auth
```

Then verify:

```bash
grouter --version
```

If `grouter: command not found`, `~/.bun/bin` isn't on PATH. Tell the user to add this line to their shell rc (`~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`):

```bash
# bash / zsh
export PATH="$HOME/.bun/bin:$PATH"

# fish
set -Ux fish_user_paths $HOME/.bun/bin $fish_user_paths
```

Then `source` the rc file or open a new terminal. Re-verify `grouter --version`.

## Path C — from source (contributors)

Best for: editing code, running `bun --hot`, or pulling the latest `main`.

```bash
git clone https://github.com/GXDEVS/grouter.git
cd grouter
```

Then pick one of:

### C.1 — `setup.sh` (recommended, clean)

```bash
bash setup.sh
```

This is the script in `setup.sh` at repo root. It:

1. Checks `bun` is present.
2. Removes any previous install (unlinks old binary).
3. Runs `bun install --frozen-lockfile`.
4. Runs `bun link` to register `grouter` globally (pointing at this repo).
5. Verifies and prints next steps.

### C.2 — `bun run deploy` (build + link binary)

```bash
bun install
bun run deploy        # = bun run build + bun link
```

`bun run build` pre-embeds logos (`scripts/embed-logos.ts`) and bundles to `dist/grouter`. `bun link` registers that binary globally. After editing code, re-run `bun run deploy` to refresh the linked binary.

### C.3 — foreground dev (no install, hot-reload)

```bash
bun install
bun run dev          # = bun --hot index.ts serve fg
```

This runs grouter directly from source with hot-reload, bound to the foreground. Useful while iterating — no global install happens. CLI subcommands also work via `bun index.ts <cmd>`.

### After any C.* path, verify:

```bash
grouter --version          # should print 4.7.0 or newer
which grouter              # should point at ~/.bun/bin/grouter
```

If missing, same PATH fix as Path B.

## Path D — docker

Best for: no bun on the host, or isolation from the host system.

From inside a clone of the repo:

```bash
bun run docker:install        # or: bash scripts/docker-install.sh
```

This builds the image, starts the stack via `docker compose up -d`, waits for `http://localhost:3099/health`, and prints endpoints. Data persists in `./data` on the host.

Ongoing management:

```bash
bun run docker:up             # start
bun run docker:down           # stop (data kept)
bun run docker:logs           # tail
bun run docker:shell          # shell in the container
bun run docker:add            # docker compose exec grouter grouter add
bun run docker:rebuild        # rebuild image + restart
```

`grouter` subcommands inside the container: `docker compose exec grouter grouter <cmd>`.

## Step 2 — First-run (after any path)

Once `grouter --version` works (or the container is healthy), walk the user through:

### 2.1 — Interactive onboarding (recommended for first-timers)

```bash
grouter setup
```

Runs the wizard: add connection → test → serve → integrate. Stop there if the wizard finishes cleanly.

### 2.2 — Or step-by-step

```bash
grouter add                # arrow-key picker → pick a provider → OAuth or API key
grouter list               # confirm the connection is registered + active
grouter test               # ping upstream for each active connection
grouter serve on           # start the daemon (router on :3099, per-provider on :3100+)
grouter serve              # show the status + allocated ports
```

### 2.3 — Wire your AI tool to grouter

```bash
grouter up openclaude      # wizard: pick provider → pick model → writes settings
```

This writes env vars to `~/.claude/settings.json` and injects `export` lines into the user's shell rc. Confirm with the user before running — it modifies their shell rc.

Flags for non-interactive use: `grouter up openclaude --provider kiro --model claude-sonnet-4.5`. Undo with `grouter up openclaude --remove`.

### 2.4 — Dashboard

Point the user at `http://localhost:3099/dashboard` for the visual management UI.

## Reinstall / upgrade

```bash
# Path A/B (global):
bun install -g grouter-auth@latest

# Path C (from source):
git pull
bun install
bun run deploy

# Path D (docker):
bun run docker:rebuild
```

Accounts and DB at `~/.grouter/` survive all upgrade paths (Docker persists to `./data` on the host).

## Uninstall

From a clone:

```bash
bash uninstall.sh           # = bun run uninstall:cli
```

Or manually:

```bash
bun unlink                  # if installed from source with bun link
bun uninstall -g grouter-auth
rm -f ~/.bun/bin/grouter    # belt-and-braces
```

Data is **not** touched. To drop accounts + DB:

```bash
rm -rf ~/.grouter           # only if the user explicitly asks
```

Docker:

```bash
bun run docker:down         # stop, keep ./data
docker compose down -v      # stop AND remove volumes (destructive — confirm)
```

## Common failure modes → fixes


| Symptom                                    | Likely cause                  | Fix                                                                                    |
| ------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------- |
| `bun: command not found`                   | Bun not installed             | `curl -fsSL https://bun.sh/install | bash`, open new terminal                          |
| `grouter: command not found` after install | `~/.bun/bin` not on PATH      | add the PATH export to shell rc, re-source                                             |
| `bun install` slow / stuck behind a proxy  | npm registry blocked          | check corporate proxy, set `BUN_CONFIG_REGISTRY`                                       |
| `EADDRINUSE` on `:3099`                    | Another process owns the port | `grouter serve restart` (kills stale daemon), or `grouter config --port <other>`       |
| Dashboard 404 on `/dashboard`              | Daemon not running            | `grouter serve on` and retry                                                           |
| Docker `health` never turns green          | Container crash loop          | `docker compose logs -f grouter` — read the first error                                |
| `bun link` silently does nothing           | Prior broken install          | `bash setup.sh` (handles cleanup), or `bun unlink` first                               |
| Logos broken after `bun link` from source  | `prebuild` skipped            | run `bun run build` (not just `bun link`) — it regenerates `src/web/logos-embedded.ts` |


## Decision tree — quick

```
User has bun? ───yes──► just try it?          ───► Path A (bunx)
                │                                  
                ├── permanent, no clone      ───► Path B (bun install -g)
                │                                  
                └── contributing / from clone ──► Path C (setup.sh or bun run deploy)
User has docker but no bun?                 ────► Path D (bun run docker:install)
User has neither                             ────► install Bun first, then Path B
```

## What to NOT do

- Don't run `sudo npm install -g` — grouter is Bun-first, and a sudo install will fight the `bun link` that `setup.sh` uses.
- Don't edit `src/web/logos-embedded.ts` by hand — it's generated from `src/public/logos/*.png` by the prebuild step.
- Don't delete `~/.grouter/grouter.db` to "fix" something — it holds the user's OAuth tokens. Use `grouter unlock`, `grouter disable <id>`, or `grouter remove <id>` first.
- Don't call the hidden `grouter _daemon` subcommand directly — it's what `grouter serve on` spawns. Use `grouter serve` variants.

