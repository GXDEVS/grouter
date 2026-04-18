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
echo -e "  ${BOLD}${CYAN}grouter-auth${RESET} — uninstall"
echo -e "  ${GRAY}─────────────────────────────────────────${RESET}"

if ! command -v grouter &>/dev/null && [ ! -f "$HOME/.bun/bin/grouter" ]; then
  echo -e "  ${YELLOW}⚠${RESET}  grouter is not installed"
  echo ""
  exit 0
fi

# bun unlink from the project dir
echo -e "  ${GRAY}unlink${RESET}  ${CYAN}…${RESET} removing bun link"
cd "$SCRIPT_DIR"
bun unlink &>/dev/null || true

# Remove binary directly
rm -f "$HOME/.bun/bin/grouter"

# Remove global node_modules symlink
rm -rf "$HOME/.bun/install/global/node_modules/grouter-auth" 2>/dev/null || true

if command -v grouter &>/dev/null; then
  echo -e "  ${RED}✗${RESET}  Could not remove grouter at $(which grouter)"
  echo -e "  ${GRAY}   Try removing it manually.${RESET}"
  echo ""
  exit 1
fi

echo -e "  ${GRAY}unlink${RESET}  ${GREEN}✓${RESET} grouter removed from PATH"
echo -e "  ${GRAY}─────────────────────────────────────────${RESET}"
echo -e "  ${GREEN}✓${RESET} ${BOLD}grouter uninstalled${RESET}"
echo ""
echo -e "  ${GRAY}Data at ~/.grouter/ was kept.${RESET}"
echo -e "  ${GRAY}To remove it too:${RESET} ${CYAN}rm -rf ~/.grouter${RESET}"
echo -e "  ${GRAY}To reinstall:${RESET}     ${CYAN}bun run install:cli${RESET}"
echo ""
