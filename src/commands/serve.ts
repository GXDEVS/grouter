import { openSync } from "node:fs";
import chalk from "chalk";
import { getStrategy, getStickyLimit, getProxyPort } from "../db/index.ts";
import { startAllServers } from "../proxy/server.ts";
import { listProviderPorts } from "../db/ports.ts";
import { listAccounts } from "../db/accounts.ts";
import { readPid, writePid, removePid, isRunning, LOG_FILE } from "../daemon/index.ts";

// ── Daemon start ──────────────────────────────────────────────────────────────

export function serveOnCommand(options: { port?: number }): void {
  if (isRunning()) {
    console.log(`\n  ${chalk.yellow("⚠")}  Proxy already running ${chalk.gray(`(PID ${readPid()})`)}\n`);
    return;
  }

  const port = options.port ?? getProxyPort();

  // Spawn detached child — pipes stdout+stderr to log file
  const logFd = openSync(LOG_FILE, "a");
  const child = Bun.spawn(["bun", Bun.main, "_daemon", "--port", String(port)], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  writePid(child.pid);

  // Brief wait so the port binds before we return
  Bun.sleepSync(300);

  if (!isRunning()) {
    removePid();
    console.log(`\n  ${chalk.red("✖")}  Daemon failed to start — check logs: ${chalk.gray(LOG_FILE)}\n`);
    return;
  }

  console.log("");
  console.log(`  ${chalk.green("●")} ${chalk.bold("Proxy started")}  ${chalk.gray(`PID ${child.pid}`)}  →  ${chalk.bold.white(`http://localhost:${port}`)}`);
  console.log(`  ${chalk.gray("stop:")}  ${chalk.cyan("grouter serve off")}`);
  console.log(`  ${chalk.gray("logs:")}  ${chalk.cyan("grouter serve logs")}`);
  console.log("");
}

// ── Daemon stop ───────────────────────────────────────────────────────────────

export function serveOffCommand(): void {
  if (!isRunning()) {
    removePid();
    console.log(`\n  ${chalk.gray("Proxy is not running.")}\n`);
    return;
  }
  const pid = readPid()!;
  try {
    process.kill(pid, "SIGTERM");
    removePid();
    console.log(`\n  ${chalk.green("✓")}  Proxy stopped  ${chalk.gray(`(PID ${pid})`)}\n`);
  } catch (err) {
    console.error(`\n  ${chalk.red("✖")}  Failed to stop: ${err}\n`);
  }
}

// ── Status ────────────────────────────────────────────────────────────────────

export function serveStatusCommand(): void {
  const running = isRunning();
  const pid = readPid();
  const port = getProxyPort();
  const accounts = listAccounts();
  const active = accounts.filter((a) => a.is_active && a.test_status !== "unavailable").length;
  const unavailable = accounts.filter((a) => a.test_status === "unavailable").length;
  const strategy = getStrategy();

  console.log("");
  if (running) {
    console.log(`  ${chalk.green("●")} ${chalk.bold("Proxy running")}  ${chalk.gray(`PID ${pid}`)}  →  ${chalk.bold.white(`http://localhost:${port}`)}`);
  } else {
    console.log(`  ${chalk.dim("○")} ${chalk.bold("Proxy stopped")}  —  ${chalk.gray(`run ${chalk.cyan("grouter serve on")} to start`)}`);
  }

  console.log(`  ${chalk.gray("─────────────────────────────────────────────")}`);

  const parts: string[] = [chalk.green(`${active} active`)];
  if (unavailable > 0) parts.push(chalk.red(`${unavailable} unavailable`));
  const other = accounts.length - active - unavailable;
  if (other > 0) parts.push(chalk.gray(`${other} unknown`));
  console.log(`  ${chalk.gray("accounts")}   ${parts.join("  ")}  ${chalk.gray(`/ ${accounts.length} total`)}`);
  console.log(`  ${chalk.gray("strategy")}   ${chalk.cyan(strategy)}${strategy === "round-robin" ? chalk.gray(` (sticky ×${getStickyLimit()})`) : ""}`);

  if (running) {
    console.log(`  ${chalk.gray("endpoint")}   ${chalk.white("/v1/chat/completions")}  ${chalk.gray("/v1/models")}  ${chalk.gray("/health")}`);
    console.log(`  ${chalk.gray("logs")}       ${chalk.gray(LOG_FILE)}`);
  }
  console.log("");
}

// ── Port helpers ──────────────────────────────────────────────────────────────

function getPidsOnPort(port: number): number[] {
  try {
    if (process.platform === "win32") {
      // netstat -ano lists TCP connections with PIDs
      const out = Bun.spawnSync(["netstat", "-ano"], { stderr: "ignore" })
        .stdout.toString();
      const pids = new Set<number>();
      for (const line of out.split("\n")) {
        // match lines like "  TCP  0.0.0.0:3099  ... LISTENING  1234"
        if (line.includes(`:${port}`) && /LISTEN/i.test(line)) {
          const m = line.trim().split(/\s+/).pop();
          const n = parseInt(m ?? "", 10);
          if (!isNaN(n) && n > 0) pids.add(n);
        }
      }
      return [...pids];
    } else {
      // Linux / macOS
      const out = Bun.spawnSync(["lsof", "-ti", `tcp:${port}`], { stderr: "ignore" })
        .stdout.toString();
      return out.trim().split("\n").filter(Boolean).map(Number).filter((n) => !isNaN(n));
    }
  } catch {
    return [];
  }
}

// ── Restart ───────────────────────────────────────────────────────────────────

export async function serveRestartCommand(options: { port?: number }): Promise<void> {
  const port = options.port ?? getProxyPort();

  console.log("");

  // 1. Stop via PID if daemon is tracked
  if (isRunning()) {
    const pid = readPid()!;
    try {
      process.kill(pid, "SIGTERM");
      removePid();
      console.log(`  ${chalk.green("✓")}  Stopped daemon  ${chalk.gray(`(PID ${pid})`)}`);
    } catch {
      removePid();
    }
    // give the process time to release the port
    Bun.sleepSync(400);
  }

  // 2. Kill anything still holding the port (fallback / external processes)
  const pids = getPidsOnPort(port);
  for (const n of pids) {
    try {
      process.kill(n, "SIGKILL");
      console.log(`  ${chalk.green("✓")}  Killed PID ${n} holding port ${port}`);
    } catch { /* already dead */ }
  }

  if (pids.length) Bun.sleepSync(200);

  // 3. Start fresh daemon
  serveOnCommand({ port });
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export function serveLogsCommand(): void {
  console.log(chalk.gray(`\n  Tailing ${LOG_FILE}  (Ctrl+C to stop)\n`));

  if (process.platform === "win32") {
    // Windows: use PowerShell's Get-Content -Wait (equivalent to tail -f)
    Bun.spawn(["powershell", "-NoProfile", "-Command", `Get-Content -Path '${LOG_FILE}' -Tail 50 -Wait`], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  } else {
    Bun.spawn(["tail", "-f", "-n", "50", LOG_FILE], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  }
}

// ── Foreground (legacy / daemon entry point) ──────────────────────────────────

/** Called by the daemon child process — no decorations, just the server. */
export function daemonEntrypoint(options: { port?: number }): void {
  const port = options.port ?? getProxyPort();
  startAllServers(port);
}

/** Legacy foreground serve — prints banner then blocks. */
export function serveCommand(options: { port?: number }): void {
  const port = options.port ?? getProxyPort();
  const providerPorts = listProviderPorts();
  const accounts = listAccounts();
  const active = accounts.filter((a) => a.is_active).length;
  const unavailable = accounts.filter((a) => a.test_status === "unavailable").length;
  const strategy = getStrategy();

  console.log("");
  console.log(`  ${chalk.bold.cyan("grouter")} ${chalk.gray("proxy")}  ${chalk.green("●")} ${chalk.bold(`http://localhost:${port}`)}`);
  console.log(`  ${chalk.gray("─────────────────────────────────────────────")}`);

  const parts: string[] = [chalk.green(`${active} active`)];
  if (unavailable > 0) parts.push(chalk.red(`${unavailable} unavailable`));
  const idle = accounts.length - active - unavailable;
  if (idle > 0) parts.push(chalk.gray(`${idle} unknown`));
  console.log(`  ${chalk.gray("accounts")}   ${parts.join("  ")} ${chalk.gray(`/ ${accounts.length} total`)}`);
  console.log(`  ${chalk.gray("strategy")}   ${chalk.cyan(strategy)}${strategy === "round-robin" ? chalk.gray(` (sticky ×${getStickyLimit()})`) : ""}`);
  console.log(`  ${chalk.gray("endpoints")}  ${chalk.white("/v1/chat/completions")}  ${chalk.gray("/v1/models")}  ${chalk.gray("/health")}`);

  if (providerPorts.length > 0) {
    console.log(`  ${chalk.gray("providers")}  ` + providerPorts.map(p => `${chalk.cyan(p.provider)}${chalk.gray(`:${p.port}`)}`).join("  "));
  }
  console.log(`  ${chalk.gray("─────────────────────────────────────────────")}`);

  if (active === 0) console.log(`  ${chalk.yellow("⚠")}  No active accounts — run ${chalk.cyan("grouter add")} first\n`);
  else console.log(`  ${chalk.gray("Ctrl+C to stop")}\n`);

  startAllServers(port);
}
