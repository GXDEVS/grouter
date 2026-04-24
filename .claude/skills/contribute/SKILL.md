---

## name: contribute
description: Guides contributors through the full git workflow for grouter — validates the developer's git identity, creates a conventionally-named branch, walks through changes asking per-change commit intent, writes Conventional Commits messages (fix, feat, wip, chore, etc. — no emojis), pushes, and opens a PR via gh. Use when the user wants to commit, push, deploy, or open a PR against this repo. Trigger phrases: "contribute", "commit my changes", "open a pr", "ship this", "vou contribuir", "fazer um commit", "abrir pr", "subir alteração", "enviar pr".

# grouter — Contribution Flow

End-to-end helper for contributing to `grouter` (GXDEVS/grouter). Take the user from "I have changes" to "PR open on GitHub" with zero guesswork.

## Ground rules — non-negotiable

1. **Use the developer's git identity.** Read `git config user.name` and `git config user.email`. Never run `git config --global user.`* or override the identity. If unset, stop and tell the user to configure it (see step 0).
2. **No emojis.** Not in branch names, commit messages, PR titles, PR bodies, or terminal output. None.
3. **No Claude attribution.** Do not append `Co-Authored-By: Claude …`, "Generated with Claude Code", or any similar footer to commits or PRs. Leave the message ending with the body/footer the user approved.
4. **Never force-push, never `--no-verify`, never amend a commit that was already pushed.** If a hook fails, fix the underlying issue and create a new commit.
5. **Commit scope matches the user's intent.** Ask per logical change — one feature/fix per commit. Do not silently bundle unrelated files.
6. **Confirm before destructive or shared-state actions.** Branch deletion, rebases, PR creation, and `git push` always get an explicit "yes" from the user.

## Step 0 — Verify the developer is logged in

Run these checks in parallel before anything else:

```bash
git config user.name
git config user.email
git -C . remote get-url origin
gh auth status 2>&1 || true
```

Decision table:


| Check                            | Missing → do this                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user.name` / `user.email` empty | Stop. Tell the user to run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"` themselves, then retry. |
| `gh auth status` not logged in   | Tell the user to run `gh auth login` in the prompt as `! gh auth login` (interactive). PR step needs it. Commits/branch work can still proceed.       |
| `origin` points to a fork        | Fine — PRs will target `GXDEVS/grouter:main` via `gh pr create --repo GXDEVS/grouter`. Confirm the fork URL with the user.                            |


Print a one-line summary (`committing as <name> <email> → origin <url>`) so the user can catch a wrong identity before any commits are made.

## Step 1 — Understand the current state

Run in parallel:

```bash
git status --short
git diff --stat
git diff --stat --cached
git log --oneline -10
git branch --show-current
```

Then decide what branch work happens on (Step 2). Never commit directly to `main` — if the user is on `main` with changes, require a new branch first.

## Step 2 — Create or pick a branch (senior convention)

### Naming rules

- Format: `<type>/<short-kebab-description>`
- Optional ticket: `<type>/<TICKET-ID>-<short-kebab-description>` (e.g. `feat/GROUTER-42-add-deepseek-provider`)
- **Lowercase, kebab-case, ASCII only.** No spaces, no underscores, no camelCase, no emojis, no unicode.
- Keep under 60 chars total.
- Description is 2–5 words, imperative or noun phrase — not a full sentence.

### Allowed types (branches)


| Prefix      | Use for                                                                         |
| ----------- | ------------------------------------------------------------------------------- |
| `feat/`     | new user-visible capability (new provider, new CLI command, new dashboard view) |
| `fix/`      | bug fix where behavior was wrong                                                |
| `hotfix/`   | urgent production fix, shipping out-of-cycle                                    |
| `refactor/` | internal restructuring, no behavior change                                      |
| `perf/`     | performance improvement, no behavior change                                     |
| `chore/`    | deps, build, tooling, housekeeping                                              |
| `docs/`     | README, CLAUDE.md, comments-only                                                |
| `test/`     | tests only                                                                      |
| `ci/`       | `.github/workflows`, release pipelines                                          |
| `release/`  | release prep, e.g. `release/v4.8.0`                                             |


### Good vs. bad for this repo

Good: `feat/add-zai-provider`, `fix/token-refresh-race`, `refactor/rotator-selection`, `chore/bump-commander`, `docs/claude-md-architecture`, `perf/sqlite-wal-mode`.

Bad: `new-feature`, `bugfix`, `gxdev/wip`, `Feat/Add_ZAI_Provider`, `fix-stuff`, `feat/AddZaiProviderWithOAuthDeviceCodeAndDashboardIntegration`.

### Create it

Ask the user for a one-line description of the change, propose a branch name matching the rules, get confirmation, then:

```bash
git checkout -b <type>/<description>
```

If the user already made changes on `main`, create the branch (changes move with the working tree automatically) before the first commit.

## Step 3 — Commit the changes (one logical change at a time)

This is the heart of the skill. Loop:

1. Run `git status --short` and `git diff` to see what's unstaged.
2. Group files into **logical changes** (one feature/fix = one commit). If everything in the diff is one logical change, that's one group. If the user touched two unrelated things, propose two commits.
3. For **each group**, show the user:
  - The files in the group.
  - A proposed Conventional Commits message (see format below).
  - Ask: **"Commit this as `<type>(<scope>): <description>`? (y / edit / skip)"**
4. On `y`: stage only those files (`git add <file> <file>`) and commit. Never `git add .` or `git add -A` — it's how secrets and unrelated noise leak in.
5. On `edit`: take the user's revised message, re-confirm, then commit.
6. On `skip`: leave the files unstaged and move on.
7. After each commit, run `git status` to verify the commit landed and show what's left.

### Conventional Commits format

```
<type>(<scope>): <short imperative description>

<optional body — why, not what>

<optional footer — BREAKING CHANGE: …, Refs: …, Closes #123>
```

- **Subject line ≤ 72 chars, imperative mood, lowercase after the colon, no trailing period.**
  - Good: `fix(rotator): skip locked models in fill-first strategy`
  - Bad: `Fixed a bug in the rotator.`, `Fix: fixed bug`
- **Body is optional** — include only when the *why* isn't obvious from the diff. Wrap at ~72 chars. Do not restate what the diff already shows.
- **No emojis in subject, body, or footer.**
- **No `Co-Authored-By: Claude …` or "Generated with …" footer.** End the message with the body or a legitimate `BREAKING CHANGE:` / `Refs:` / `Closes:` footer.

### Types (commits)

Same list as branches, plus two more that are commit-only:


| Type       | When to use                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat`     | new capability                                                                                                                                                      |
| `fix`      | bug fix                                                                                                                                                             |
| `wip`      | intentionally-incomplete work-in-progress commit, will be squashed/rebased before merge — only use on private branches, never on a commit that will be merged as-is |
| `refactor` | internal change, no behavior change                                                                                                                                 |
| `perf`     | performance                                                                                                                                                         |
| `chore`    | deps, build, tooling                                                                                                                                                |
| `docs`     | docs only                                                                                                                                                           |
| `style`    | formatting, whitespace, lint — **no logic change**                                                                                                                  |
| `test`     | tests only                                                                                                                                                          |
| `build`    | build system, bundler, `bun build` config                                                                                                                           |
| `ci`       | `.github/workflows`, release automation                                                                                                                             |
| `revert`   | reverts a prior commit; body references the reverted SHA                                                                                                            |


### Scopes for this repo

Pick from these when possible — they match the directory structure:

`auth`, `auth/<provider>` (e.g. `auth/qwen`), `proxy`, `proxy/upstream`, `proxy/claude-translator`, `rotator`, `token`, `db`, `providers`, `commands`, `commands/<cmd>` (e.g. `commands/add`), `web`, `web/dashboard`, `web/wizard`, `update`, `constants`, `cli`, `build`, `scripts`.

Omit the scope for cross-cutting changes: `chore: bump commander to 13`, `docs: clarify rotation strategy`.

### Commit command

Use a HEREDOC to preserve formatting. **Do not append any Claude footer.**

```bash
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>

<optional body>
EOF
)"
```

If a pre-commit hook fails: the commit didn't happen. Fix the problem, re-stage, create a **new** commit. Never `--amend` to work around a hook.

## Step 4 — Push

Confirm with the user, then:

```bash
git push -u origin <branch-name>
```

If the branch already tracks remote, `git push` is enough. If the push is rejected (branch diverged), **stop and ask** — never force-push without explicit approval, and never force-push to `main`.

## Step 5 — Open the PR

### Before creating

1. Fetch base branch and verify the PR diff is what the user expects:
  ```bash
   git fetch origin main
   git log --oneline origin/main..HEAD
   git diff --stat origin/main...HEAD
  ```
2. Draft title + body (see format below) and **show it to the user for approval** before running `gh pr create`.

### PR title

- Mirror the primary commit's Conventional Commits subject: `<type>(<scope>): <description>`.
- ≤ 70 chars. Details go in the body, not the title.
- No emojis. No `[WIP]` tag — use GitHub's "Draft PR" toggle instead (`gh pr create --draft`).

### PR body template

```markdown
## Summary
- <bullet 1 — what changed, in plain terms>
- <bullet 2 — why this approach>
- <bullet 3 — anything reviewers should look at first>

## Test plan
- [ ] <concrete manual or automated check 1>
- [ ] <check 2>
- [ ] `bun test` passes (or note why it's not relevant)
- [ ] `bun run build` succeeds
```

Include a `## Breaking changes` section only if there are any. Include `Closes #N` at the bottom if a GitHub issue is being closed.

**Do not** append "Generated with Claude Code" or any Claude footer.

### Create it

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
- …

## Test plan
- [ ] …
EOF
)"
```

Add `--draft` if the user wants a draft. Add `--repo GXDEVS/grouter` if the `origin` is a fork. Return the PR URL to the user.

## Step 6 — After the PR is open

Offer, don't auto-run:

- `gh pr checks` — watch CI.
- `gh pr view --web` — open in browser.
- If CI fails, pull the log with `gh run view <run-id> --log-failed` and propose a fix commit (back to Step 3).

## Quick reference — the whole loop

```
0. verify identity           → git config user.name/email, gh auth status
1. read state                → git status, git diff, git log, branch
2. branch                    → <type>/<kebab-desc>, create if needed
3. commit per logical change → stage explicit files, Conventional Commits
4. push                      → git push -u origin <branch>
5. pr                        → gh pr create (title + body, no Claude footer)
6. watch                     → gh pr checks (optional)
```

## Things to refuse or push back on

- User asks to commit with `Co-Authored-By: Claude` — decline, cite this skill.
- User asks to force-push to `main` — refuse, suggest a revert commit instead.
- User asks to commit with `--no-verify` — refuse, fix the hook's complaint instead.
- User asks to bundle unrelated changes into one commit "to save time" — push back once, explain why per-change commits help review and bisect; if they still insist, comply.
- User on `main` tries to commit without a branch — create a branch first.
- Commit message with emojis — rewrite without them before committing.

