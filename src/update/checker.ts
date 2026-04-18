// ── Update checker (throttled, cached in settings DB) ────────────────────────
// Queries the public npm registry for the latest `grouter-auth` version.

import chalk from "chalk";
import { getSetting, setSetting } from "../db/index.ts";
import pkg from "../../package.json" with { type: "json" };

export const CURRENT_VERSION: string = pkg.version;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const NPM_REGISTRY_URL  = `https://registry.npmjs.org/${pkg.name}/latest`;

// ── Semver compare (simple, no pre-release) ───────────────────────────────────

export function isNewer(remote: string, local: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [rMaj = 0, rMin = 0, rPat = 0] = parse(remote);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

// ── Network fetch — npm registry ──────────────────────────────────────────────

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(NPM_REGISTRY_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { version?: unknown };
    return typeof json.version === "string" ? json.version.trim() : null;
  } catch {
    return null;
  }
}

// ── Banner print (sync, reads DB cache only — no network) ─────────────────────

function printBanner(remote: string): void {
  console.log("");
  console.log(`  ${chalk.dim("┌─")} ${chalk.yellow.bold("Update available")} ${chalk.dim("─────────────────────────────────")}`);
  console.log(`  ${chalk.dim("│")} ${chalk.dim("current")}  ${chalk.gray(CURRENT_VERSION)}   ${chalk.dim("→")}   ${chalk.green.bold(remote)}`);
  console.log(`  ${chalk.dim("│")} ${chalk.dim("run")}      ${chalk.cyan("grouter update")}  ${chalk.dim("to install")}`);
  console.log(`  ${chalk.dim("└──────────────────────────────────────────────────")}`);
  console.log("");
}

export function printUpdateBannerSync(): void {
  try {
    const cached = getSetting("update_latest_version");
    if (cached && isNewer(cached, CURRENT_VERSION)) printBanner(cached);
  } catch { /* non-fatal */ }
}

// ── Background network refresh (fire-and-forget) ──────────────────────────────

export function scheduleUpdateCheck(): void {
  setImmediate(async () => {
    try {
      const lastCheck = getSetting("update_last_check");
      if (lastCheck && Date.now() - parseInt(lastCheck, 10) < CHECK_INTERVAL_MS) return;

      const remote = await fetchLatestVersion();
      if (!remote) return;
      setSetting("update_last_check", String(Date.now()));
      setSetting("update_latest_version", remote);
    } catch { /* non-fatal */ }
  });
}

// ── Async version for grouter update command (forces fresh fetch) ───────────────

export async function fetchAndCacheVersion(): Promise<string | null> {
  const remote = await fetchLatestVersion();
  if (remote) {
    setSetting("update_last_check", String(Date.now()));
    setSetting("update_latest_version", remote);
  }
  return remote;
}

// ── hasUpdate (for proxy /api/version endpoint) ───────────────────────────────

export async function hasUpdate(): Promise<{ has: boolean; remote: string | null }> {
  const remote = getSetting("update_latest_version") ?? await fetchLatestVersion();
  if (!remote) return { has: false, remote: null };
  return { has: isNewer(remote, CURRENT_VERSION), remote };
}
