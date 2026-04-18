#!/usr/bin/env bash
set -e

BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
GRAY="\033[90m"
RESET="\033[0m"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "  ${BOLD}${CYAN}grouter-auth${RESET} — setup"
echo -e "  ${GRAY}─────────────────────────────────────────${RESET}"

# ── Check bun ──────────────────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo -e "  ${RED}✗${RESET} bun not found. Install at https://bun.sh"
  exit 1
fi
BUN_VERSION=$(bun --version)
echo -e "  ${GRAY}bun${RESET}     ${GREEN}✓${RESET} ${GRAY}v${BUN_VERSION}${RESET}"

# ── Remove any previous installation ──────────────────────────────────────────
if command -v grouter &>/dev/null; then
  PREV=$(which grouter)
  echo -e "  ${GRAY}old${RESET}     ${YELLOW}↻${RESET} removing previous install ${GRAY}(${PREV})${RESET}"
  # Try bun unlink from wherever it was installed
  PREV_DIR=$(readlink -f "$PREV" 2>/dev/null | xargs dirname 2>/dev/null || true)
  if [[ -n "$PREV_DIR" && -f "$PREV_DIR/../package.json" ]]; then
    (cd "$PREV_DIR/.." && bun unlink &>/dev/null || true)
  fi
  rm -f "$PREV" 2>/dev/null || true
  rm -rf ~/.bun/install/global/node_modules/grouter-auth 2>/dev/null || true
fi

# ── Install dependencies ───────────────────────────────────────────────────────
echo -e "  ${GRAY}deps${RESET}    ${CYAN}…${RESET} running bun install"
cd "$SCRIPT_DIR"
bun install --frozen-lockfile 2>&1 | grep -E "installed|error" | sed 's/^/         /' || bun install 2>&1 | tail -1 | sed 's/^/         /'
echo -e "  ${GRAY}deps${RESET}    ${GREEN}✓${RESET}"

# ── Register globally via bun link ────────────────────────────────────────────
echo -e "  ${GRAY}link${RESET}    ${CYAN}…${RESET} registering grouter globally"
bun link &>/dev/null
echo -e "  ${GRAY}link${RESET}    ${GREEN}✓${RESET} ${GRAY}→ ~/.bun/bin/grouter${RESET}"

# ── Verify ────────────────────────────────────────────────────────────────────
if ! command -v grouter &>/dev/null; then
  echo ""
  echo -e "  ${YELLOW}⚠${RESET}  grouter not found in PATH."
  echo -e "  ${GRAY}   Make sure ~/.bun/bin is in your PATH:${RESET}"
  echo -e "  ${CYAN}   export PATH=\"\$HOME/.bun/bin:\$PATH\"${RESET}"
  echo ""
  exit 0
fi

INSTALLED_VER=$(grouter --version 2>/dev/null)
echo -e "  ${GRAY}─────────────────────────────────────────${RESET}"
echo -e "  ${GREEN}✓${RESET} ${BOLD}grouter v${INSTALLED_VER}${RESET} installed"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo -e "  ${CYAN}grouter add${RESET}     Add a Qwen account (opens browser)"
echo -e "  ${CYAN}grouter serve${RESET}   Start proxy on http://localhost:3099"
echo -e "  ${CYAN}grouter setup${RESET}   Interactive wizard"
echo ""
echo -e "  ${GRAY}Project: ${SCRIPT_DIR}${RESET}"
echo -e "  ${GRAY}Data:    ~/.grouter/grouter.db${RESET}"
echo ""
