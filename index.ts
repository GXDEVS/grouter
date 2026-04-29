#!/usr/bin/env bun
import { Command } from "commander";
import { addCommand } from "./src/commands/add.ts";
import { listCommand } from "./src/commands/list.ts";
import { removeCommand } from "./src/commands/remove.ts";
import { testCommand } from "./src/commands/test.ts";
import {
  serveCommand,
  serveOnCommand,
  serveOffCommand,
  serveRestartCommand,
  serveStatusCommand,
  serveLogsCommand,
  daemonEntrypoint,
} from "./src/commands/serve.ts";
import { statusCommand } from "./src/commands/status.ts";
import { configCommand } from "./src/commands/config.ts";
import { unlockCommand } from "./src/commands/unlock.ts";
import { enableCommand, disableCommand } from "./src/commands/toggle.ts";
import { setupCommand } from "./src/commands/setup.ts";
import { modelsCommand } from "./src/commands/models.ts";
import { updateCommand } from "./src/commands/update.ts";
import { keysCommand } from "./src/commands/keys.ts";
import { upOpenclaudeCommand, upOpenclaudeRemoveCommand } from "./src/commands/openclaude.ts";
import { printUpdateBannerSync, scheduleUpdateCheck, CURRENT_VERSION } from "./src/update/checker.ts";

const program = new Command()
  .name("grouter")
  .description("Universal AI router — OAuth + API Key providers behind one OpenAI-compatible proxy")
  .version(CURRENT_VERSION)
  .addHelpText("after", `
Examples:
  $ grouter setup              Interactive first-run wizard
  $ grouter add                Wizard — pick provider, run the right OAuth/API-key flow
  $ grouter serve on           Start proxy in background (router :3099 + per-provider :3100+)
  $ grouter serve off          Stop background proxy
  $ grouter serve logs         Tail proxy logs
  $ grouter serve              Show proxy status
  $ grouter list               Show all connections with status
  $ grouter models [provider]  List models per provider (+ dedicated port)
  $ grouter up openclaude      Wizard — configure OpenClaude with a provider/model
  $ grouter test               Check connectivity
  $ grouter update             Check for a new version on the npm registry
  $ grouter unlock             Clear all rate-limit locks
`);

// ── Update banner + background refresh (skip for update/serve/_daemon) ────────
{
  const skipCmds = new Set(['update', 'serve', '_daemon']);
  const firstArg = process.argv[2] ?? '';
  if (!firstArg.startsWith('-') && !skipCmds.has(firstArg)) {
    printUpdateBannerSync();   // instant — reads from DB cache only
    scheduleUpdateCheck();     // background network refresh, no blocking
  }
}

program.command("setup")
  .description("Interactive first-run wizard (add → test → serve)")
  .action(setupCommand);

program.command("add")
  .description("Wizard — add a connection for any provider (OAuth, API key, import token)")
  .action(addCommand);

program.command("list").alias("ls")
  .description("List all stored connections with status")
  .action(listCommand);

program.command("remove <id>").alias("rm")
  .description("Remove an account by ID prefix or email")
  .action(removeCommand);

program.command("enable <id>")
  .description("Enable a disabled account")
  .action(enableCommand);

program.command("disable <id>")
  .description("Disable an account (keeps it stored, skips rotation)")
  .action(disableCommand);

program.command("models [provider]")
  .description("List models per provider, or drill into one (grouter models claude)")
  .action(modelsCommand);

program.command("test [id]")
  .description("Test account connectivity (all or one by ID)")
  .action(testCommand);

program.command("unlock [id]")
  .description("Clear all model locks for one account or all accounts")
  .action(unlockCommand);

program.command("keys [action] [arg...]")
  .description("Manage local Client API Keys (ls, add <name>, rm <key>)")
  .action(keysCommand);

// ── serve ─────────────────────────────────────────────────────────────────────

const serve = program.command("serve")
  .description("Manage the OpenAI-compatible proxy server")
  .option("-p, --port <number>", "Port to listen on (default: 3099)")
  .action(() => {
    // bare `grouter serve` → show status
    serveStatusCommand();
  });

serve.command("on")
  .description("Start proxy in background (daemon)")
  .option("-p, --port <number>", "Port to listen on (default: 3099)")
  .action((opts: { port?: string }) =>
    serveOnCommand({ port: opts.port ? parseInt(opts.port, 10) : undefined })
  );

serve.command("off")
  .description("Stop the background proxy")
  .action(() => serveOffCommand());

serve.command("restart")
  .description("Stop proxy, kill port, and restart fresh")
  .option("-p, --port <number>", "Port to restart on (default: configured port)")
  .action((opts: { port?: string }) =>
    serveRestartCommand({ port: opts.port ? parseInt(opts.port, 10) : undefined })
  );

serve.command("logs")
  .description("Tail the proxy log file")
  .action(() => serveLogsCommand());

serve.command("status")
  .description("Show proxy status and account summary")
  .action(() => serveStatusCommand());

serve.command("fg")
  .description("Start proxy in foreground (blocks terminal)")
  .option("-p, --port <number>", "Port to listen on (default: 3099)")
  .action((opts: { port?: string }) =>
    serveCommand({ port: opts.port ? parseInt(opts.port, 10) : undefined })
  );

// ── up ────────────────────────────────────────────────────────────────────────

const upCmd = program.command("up")
  .description("Install integrations and providers");

upCmd.command("openclaude")
  .description("Configure Claude Code to use grouter (interactive wizard by default)")
  .option("--provider <id>", "Provider ID (e.g. claude, kiro, github, qwen)")
  .option("-m, --model <model>", "Model to use")
  .option("-p, --port <number>", "Proxy port (default: provider's port or router port)")
  .option("--no-interactive", "Skip the wizard and use flag values / defaults")
  .option("--remove", "Remove the integration")
  .action((opts: { provider?: string; model?: string; port?: string; remove?: boolean; interactive?: boolean }) => {
    if (opts.remove) return upOpenclaudeRemoveCommand();
    return upOpenclaudeCommand({
      provider: opts.provider,
      model: opts.model,
      port: opts.port ? parseInt(opts.port, 10) : undefined,
      noInteractive: opts.interactive === false,
    });
  });

// ── update ────────────────────────────────────────────────────────────────────

program.command("update")
  .description("Check for a new version on the npm registry")
  .action(() => updateCommand());

// ── Hidden daemon entrypoint (spawned internally by `serve on`) ───────────────

program.command("_daemon", { hidden: true })
  .option("-p, --port <number>")
  .action((opts: { port?: string }) =>
    daemonEntrypoint({ port: opts.port ? parseInt(opts.port, 10) : undefined })
  );

// ── status / config ───────────────────────────────────────────────────────────

program.command("status")
  .description("Show accounts health, rotation state, and active locks")
  .action(statusCommand);

program.command("config")
  .description("Show or update proxy configuration")
  .option("--strategy <strategy>", "fill-first | round-robin")
  .option("--port <number>", "Default proxy port")
  .option("--sticky-limit <number>", "Round-robin consecutive-use limit")
  .action((opts: { strategy?: string; port?: string; stickyLimit?: string }) => {
    const options: Parameters<typeof configCommand>[0] = {};
    if (opts.strategy === "fill-first" || opts.strategy === "round-robin") options.strategy = opts.strategy;
    if (opts.port) options.port = parseInt(opts.port, 10);
    if (opts.stickyLimit) options.stickyLimit = parseInt(opts.stickyLimit, 10);
    configCommand(options);
  });

program.parse();
