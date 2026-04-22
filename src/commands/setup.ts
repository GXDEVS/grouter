import { createInterface } from "node:readline";
import chalk from "chalk";
import { listAccounts } from "../db/accounts.ts";
import { testCommand } from "./test.ts";
import { serveOnCommand } from "./serve.ts";
import { upOpenclaudeCommand } from "./openclaude.ts";
import { addCommand } from "./add.ts";

const AUTHOR = "gxdev";

// ── readline ──────────────────────────────────────────────────────────────────

let _rl: ReturnType<typeof createInterface> | null = null;

function getRl() {
  if (!_rl) _rl = createInterface({ input: process.stdin, output: process.stdout });
  return _rl;
}

function closeRl() {
  _rl?.close();
  _rl = null;
}

function prompt(q: string): Promise<string> {
  return new Promise((resolve) => getRl().question(q, resolve));
}

// ── Banner ────────────────────────────────────────────────────────────────────

function printBanner() {
  const c = chalk.bold.cyan;
  const d = chalk.cyan; // slightly dimmer for depth effect
  console.log("");
  console.log(c(" ██████╗ ██████╗  ██████╗ ██╗   ██╗████████╗███████╗██████╗ "));
  console.log(c("██╔════╝ ██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██╔══██╗"));
  console.log(c("██║  ███╗██████╔╝██║   ██║██║   ██║   ██║   █████╗  ██████╔╝"));
  console.log(c("██║   ██║██╔══██╗██║   ██║██║   ██║   ██║   ██╔══╝  ██╔══██╗"));
  console.log(c("╚██████╔╝██║  ██║╚██████╔╝╚██████╔╝   ██║   ███████╗██║  ██║"));
  console.log(d(" ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝"));
  console.log("");
  console.log(chalk.gray(" Universal AI router — OAuth + API Key providers, one local proxy"));
  console.log(chalk.gray(` by ${AUTHOR}  ·  No certificates. No MITM.`));
  console.log("");
  console.log(chalk.gray(" " + "─".repeat(51)));
  console.log("");
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export async function setupCommand(): Promise<void> {
  printBanner();

  const accounts = listAccounts();

  // ── Step 1: Connection ────────────────────────────────────────────────────
  console.log(
    `  ${chalk.bold.white("1 ›")} ${chalk.bold("Connection")}`,
  );

  if (accounts.length === 0) {
    console.log(chalk.gray("    grouter suporta 15+ providers (Claude, GitHub, Kimi, Kiro, Gemini CLI, API keys…)\n"));
    const a1 = await prompt(chalk.gray("    Adicionar uma conexão agora? ") + chalk.white("[Y/n] "));
    closeRl();
    if (a1.trim().toLowerCase() !== "n") {
      try {
        await addCommand();
      } catch (err) {
        console.error(
          chalk.red(`\n    ✖ ${err instanceof Error ? err.message : String(err)}\n`),
        );
        console.log(chalk.gray("    Run `grouter add` again when ready."));
        printSummary();
        return;
      }
    } else {
      console.log(chalk.gray("\n    Skipped. Run `grouter add` to add a connection later."));
      printSummary();
      return;
    }
  } else {
    console.log(
      `    ${chalk.green("✓")} ${chalk.green(`${accounts.length} connection${accounts.length > 1 ? "s" : ""} configured`)}`,
    );
    console.log("");
  }

  // ── Step 2: Test ──────────────────────────────────────────────────────────
  console.log(`  ${chalk.bold.white("2 ›")} ${chalk.bold("Connectivity test")}`);
  console.log(chalk.gray("    Pinging Qwen API with each account...\n"));

  await testCommand();

  // ── Step 3: Proxy ─────────────────────────────────────────────────────────
  console.log(`  ${chalk.bold.white("3 ›")} ${chalk.bold("Proxy server")}`);
  console.log(
    chalk.gray(
      `    Endpoint: ${chalk.white("http://localhost:3099/v1/chat/completions")}`,
    ),
  );
  console.log("");

  const a3 = await prompt(chalk.gray("    Start proxy in background? ") + chalk.white("[Y/n] "));

  if (a3.trim().toLowerCase() !== "n") {
    serveOnCommand({});
  }

  // ── Step 4: Claude Code integration ───────────────────────────────────────
  console.log(`  ${chalk.bold.white("4 ›")} ${chalk.bold("OpenClaude integration")}`);
  console.log(chalk.gray("    Configure OpenClaude to use grouter as its AI provider.\n"));
  console.log(chalk.gray(`    Writes env vars to settings.json and your shell config`));
  console.log(chalk.gray(`    so OpenClaude automatically routes through grouter.\n`));

  const a4 = await prompt(chalk.gray("    Set up OpenClaude integration? ") + chalk.white("[Y/n] "));
  closeRl();

  if (a4.trim().toLowerCase() !== "n") {
    await upOpenclaudeCommand({});
  } else {
    console.log(chalk.gray("\n    Skipped. Run `grouter up openclaude` anytime to configure OpenClaude.\n"));
  }

  printSummary();
}

// ── Summary ───────────────────────────────────────────────────────────────────

function printSummary(): void {
  console.log("");
  console.log(chalk.gray("  " + "─".repeat(51)));
  console.log("");
  console.log(`  ${chalk.bold("Commands")}`);
  console.log("");
  console.log(`    ${chalk.cyan("grouter add")}              Wizard — add a connection (any provider)`);
  console.log(`    ${chalk.cyan("grouter list")}             Show connections`);
  console.log(`    ${chalk.cyan("grouter models [p]")}       Models per provider (+ dedicated port)`);
  console.log(`    ${chalk.cyan("grouter test")}             Check connectivity`);
  console.log(`    ${chalk.cyan("grouter serve on")}         Start proxy in background`);
  console.log(`    ${chalk.cyan("grouter serve off")}        Stop background proxy`);
  console.log(`    ${chalk.cyan("grouter serve logs")}       Tail proxy logs`);
  console.log(`    ${chalk.cyan("grouter unlock")}           Clear rate-limit locks`);
  console.log(`    ${chalk.cyan("grouter status")}           Health dashboard`);
  console.log(`    ${chalk.cyan("grouter config")}           Show / update settings`);
  console.log(`    ${chalk.cyan("grouter up openclaude")}    Configure OpenClaude integration (wizard)`);
  console.log("");
  console.log(`  ${chalk.gray("Dashboard:")} ${chalk.white("http://localhost:3099/dashboard")}`);
  console.log(`  ${chalk.gray("Endpoint: ")} ${chalk.white("http://localhost:3099/v1/chat/completions")}`);
  console.log("");
}
