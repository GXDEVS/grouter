import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { select, input } from "@inquirer/prompts";
import { getProxyPort } from "../db/index.ts";
import { getProvider, providerHasFreeModelsById, PROVIDERS, isProviderLocked } from "../providers/registry.ts";
import { getProviderPort } from "../db/ports.ts";
import { getConnectionCountByProvider } from "../db/accounts.ts";
import { fetchAndSaveProviderModels, getModelsForProvider } from "../providers/model-fetcher.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnvVars {
  CLAUDE_CODE_USE_OPENAI: string;
  OPENAI_BASE_URL: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
}

const ENV_KEYS: (keyof EnvVars)[] = [
  "CLAUDE_CODE_USE_OPENAI",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
];

// ── settings.json (Linux → .claude / Windows → .openclaude) ──────────────────

function getSettingsPath(): string {
  const dir = process.platform === "win32" ? ".openclaude" : ".claude";
  return join(homedir(), dir, "settings.json");
}

function readSettings(): Record<string, unknown> {
  const p = getSettingsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettings(obj: Record<string, unknown>): void {
  const p = getSettingsPath();
  const dir = join(p, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function injectIntoSettings(env: EnvVars): boolean {
  try {
    const settings = readSettings();
    settings.env = { ...(settings.env as Record<string, string> ?? {}), ...env };
    writeSettings(settings);
    return true;
  } catch {
    return false;
  }
}

function removeFromSettings(): boolean {
  try {
    const settings = readSettings();
    const e = settings.env as Record<string, string> | undefined;
    if (!e) return true;
    for (const k of ENV_KEYS) delete e[k];
    if (Object.keys(e).length === 0) delete settings.env;
    writeSettings(settings);
    return true;
  } catch {
    return false;
  }
}

function settingsLabel(): string {
  const dir = process.platform === "win32" ? ".openclaude" : ".claude";
  return `~/${dir}/settings.json`;
}

// ── Windows: PowerShell profile ($env: syntax) ────────────────────────────────

function getPsProfilePath(): string {
  // $PROFILE resolves inside PowerShell; fall back to the standard location
  return process.env.PSPROFILE
    ?? join(homedir(), "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
}

const PS_MARKER_START = "# >>> grouter-openclaude >>>";
const PS_MARKER_END   = "# <<< grouter-openclaude <<<";
const PS_LEGACY_START = "# >>> gqwen-openclaude >>>";
const PS_LEGACY_END   = "# <<< gqwen-openclaude <<<";

function psBlock(env: EnvVars): string {
  return [
    PS_MARKER_START,
    `$env:CLAUDE_CODE_USE_OPENAI = "${env.CLAUDE_CODE_USE_OPENAI}"`,
    `$env:OPENAI_BASE_URL = "${env.OPENAI_BASE_URL}"`,
    `$env:OPENAI_API_KEY = "${env.OPENAI_API_KEY}"`,
    `$env:OPENAI_MODEL = "${env.OPENAI_MODEL}"`,
    PS_MARKER_END,
  ].join("\n");
}

function stripLegacyBlock(content: string, start: string, end: string): string {
  const re = new RegExp(`\\n?${start}[\\s\\S]*?${end}\\n?`, "g");
  return content.replace(re, "\n");
}

function injectIntoPsProfile(env: EnvVars): "injected" | "updated" | "failed" {
  const path = getPsProfilePath();
  try {
    let content = existsSync(path) ? readFileSync(path, "utf8") : "";
    const hadLegacy = content.includes(PS_LEGACY_START);
    if (hadLegacy) content = stripLegacyBlock(content, PS_LEGACY_START, PS_LEGACY_END);
    const block = psBlock(env);
    if (content.includes(PS_MARKER_START)) {
      const re = new RegExp(`${PS_MARKER_START}[\\s\\S]*?${PS_MARKER_END}`, "g");
      content = content.replace(re, block);
      writeFileSync(path, content, "utf8");
      return "updated";
    }
    const sep = content.endsWith("\n") || content === "" ? "\n" : "\n\n";
    writeFileSync(path, content + sep + block + "\n", "utf8");
    return hadLegacy ? "updated" : "injected";
  } catch {
    return "failed";
  }
}

function removeFromPsProfile(): boolean {
  const path = getPsProfilePath();
  try {
    if (!existsSync(path)) return true;
    let content = readFileSync(path, "utf8");
    const hasCurrent = content.includes(PS_MARKER_START);
    const hasLegacy  = content.includes(PS_LEGACY_START);
    if (!hasCurrent && !hasLegacy) return true;
    if (hasCurrent) content = stripLegacyBlock(content, PS_MARKER_START, PS_MARKER_END);
    if (hasLegacy)  content = stripLegacyBlock(content, PS_LEGACY_START, PS_LEGACY_END);
    writeFileSync(path, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

// ── Linux/macOS: shell config injection ───────────────────────────────────────

interface ShellConfig {
  label: string;
  path: string;
  exportBlock(env: EnvVars): string;
}

const MARKER_START = "# >>> grouter-openclaude >>>";
const MARKER_END   = "# <<< grouter-openclaude <<<";
const LEGACY_START = "# >>> gqwen-openclaude >>>";
const LEGACY_END   = "# <<< gqwen-openclaude <<<";

function shellConfigs(): ShellConfig[] {
  const home = homedir();

  const posixBlock = (e: EnvVars) => [
    MARKER_START,
    `export CLAUDE_CODE_USE_OPENAI="${e.CLAUDE_CODE_USE_OPENAI}"`,
    `export OPENAI_BASE_URL="${e.OPENAI_BASE_URL}"`,
    `export OPENAI_API_KEY="${e.OPENAI_API_KEY}"`,
    `export OPENAI_MODEL="${e.OPENAI_MODEL}"`,
    MARKER_END,
  ].join("\n");

  const fishBlock = (e: EnvVars) => [
    MARKER_START,
    `set -gx CLAUDE_CODE_USE_OPENAI "${e.CLAUDE_CODE_USE_OPENAI}"`,
    `set -gx OPENAI_BASE_URL "${e.OPENAI_BASE_URL}"`,
    `set -gx OPENAI_API_KEY "${e.OPENAI_API_KEY}"`,
    `set -gx OPENAI_MODEL "${e.OPENAI_MODEL}"`,
    MARKER_END,
  ].join("\n");

  const candidates: ShellConfig[] = [
    { label: "bash", path: join(home, ".bashrc"),                      exportBlock: posixBlock },
    { label: "zsh",  path: join(home, ".zshrc"),                       exportBlock: posixBlock },
    { label: "fish", path: join(home, ".config", "fish", "config.fish"), exportBlock: fishBlock },
  ];

  return candidates.filter((c) => existsSync(c.path));
}

function injectIntoShell(config: ShellConfig, env: EnvVars): "injected" | "updated" | "failed" {
  try {
    let content = existsSync(config.path) ? readFileSync(config.path, "utf8") : "";
    const hadLegacy = content.includes(LEGACY_START);
    if (hadLegacy) content = stripLegacyBlock(content, LEGACY_START, LEGACY_END);
    const block = config.exportBlock(env);
    if (content.includes(MARKER_START)) {
      const re = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`, "g");
      content = content.replace(re, block);
      writeFileSync(config.path, content, "utf8");
      return "updated";
    }
    const sep = content.endsWith("\n") || content === "" ? "\n" : "\n\n";
    writeFileSync(config.path, content + sep + block + "\n", "utf8");
    return hadLegacy ? "updated" : "injected";
  } catch {
    return "failed";
  }
}

function removeFromShell(config: ShellConfig): boolean {
  try {
    if (!existsSync(config.path)) return true;
    let content = readFileSync(config.path, "utf8");
    const hasCurrent = content.includes(MARKER_START);
    const hasLegacy  = content.includes(LEGACY_START);
    if (!hasCurrent && !hasLegacy) return true;
    if (hasCurrent) content = stripLegacyBlock(content, MARKER_START, MARKER_END);
    if (hasLegacy)  content = stripLegacyBlock(content, LEGACY_START, LEGACY_END);
    writeFileSync(config.path, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

// ── Main commands ─────────────────────────────────────────────────────────────

interface UpOptions {
  model?: string;
  port?: number;
  provider?: string;
  noInteractive?: boolean;
}

async function pickModel(choices: { name: string; value: string }[], message: string): Promise<string> {
  const customSentinel = "__custom__";
  const allChoices = [
    ...choices,
    { name: "✏  Digite um modelo personalizado…", value: customSentinel },
  ];
  const picked = await select({ message, choices: allChoices, pageSize: 16 });
  if (picked === customSentinel) {
    let modelId = "";
    while (!modelId.trim()) {
      modelId = await input({ message: "Model ID (não pode ser vazio):" });
    }
    return modelId.trim();
  }
  return picked;
}

async function wizard(routerPort: number): Promise<{ providerId: string | null; port: number; model: string }> {
  const counts = getConnectionCountByProvider();

  // Build provider list: connected providers first, then the rest.
  const all = Object.values(PROVIDERS).filter(p => !isProviderLocked(p));
  const sorted = [...all].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));

  const choices = [
    {
      name: `${chalk.bold("Router")} ${chalk.gray("(uses first available provider · port " + routerPort + ")")}`,
      value: "__router__",
      description: "Send requests to the main router — it picks the account.",
    },
    ...sorted.map(p => {
      const port = getProviderPort(p.id);
      const n    = counts[p.id] ?? 0;
      const tag  = providerHasFreeModelsById(p.id) ? chalk.green(" FREE") : "";
      const portStr = port ? chalk.cyan(`:${port}`) : chalk.gray("(no port yet)");
      const connStr = n > 0 ? chalk.green(`${n} conn`) : chalk.gray("0 conn");
      return {
        name: `${p.name.padEnd(18)} ${portStr}  ${connStr}${tag}`,
        value: p.id,
        description: p.description,
        disabled: n === 0 ? chalk.gray(" — no connections; run `grouter add` first") : false,
      };
    }),
  ];

  const providerId = await select({
    message: "Which provider should OpenClaude use?",
    choices,
    pageSize: 14,
  });

  if (providerId === "__router__") {
    // Try to refresh connected providers so model choices are up to date.
    await Promise.allSettled(
      sorted
        .filter((p) => (counts[p.id] ?? 0) > 0)
        .map((p) => fetchAndSaveProviderModels(p.id)),
    );

    const modelChoices = sorted
      .filter(p => (counts[p.id] ?? 0) > 0)
      .flatMap((p) => {
        const models = getModelsForProvider(p.id);
        return models.map((m) => ({
          name: `${chalk.cyan(m.id.padEnd(42))} ${chalk.gray(p.name + " · " + m.name)}${m.is_free ? chalk.green(" FREE") : ""}`,
          value: `${p.id}/${m.id}`,
        }));
      });
    if (modelChoices.length === 0) {
      console.log(`\n  ${chalk.yellow("⚠")}  No connected providers. Run ${chalk.cyan("grouter add")} first.\n`);
      process.exit(1);
    }
    const model = await pickModel(modelChoices, "Which model?");
    return { providerId: null, port: routerPort, model };
  }

  const p = getProvider(providerId)!;
  const port = getProviderPort(p.id) ?? routerPort;
  // Refresh chosen provider models before presenting the picker.
  await fetchAndSaveProviderModels(p.id).catch(() => null);
  const modelChoices = getModelsForProvider(p.id).map((m) => ({
    name: `${chalk.cyan(m.id.padEnd(42))} ${chalk.gray(m.name)}${m.is_free ? chalk.green(" FREE") : ""}`,
    value: m.id,
  }));
  const model = await pickModel(modelChoices, `Which ${p.name} model?`);

  return { providerId: p.id, port, model };
}

export async function upOpenclaudeCommand(options: UpOptions): Promise<void> {
  const routerPort = getProxyPort();

  let port: number;
  let model: string;
  let providerId: string | null = options.provider ?? null;

  // If caller supplied both --model and (--port or --provider), skip the wizard.
  const hasEverything = options.model && (options.port || options.provider);
  const interactive = !options.noInteractive && process.stdout.isTTY && !hasEverything;

  if (interactive) {
    try {
      const res = await wizard(routerPort);
      providerId = res.providerId;
      port = res.port;
      model = res.model;
    } catch (err: unknown) {
      // user hit Ctrl+C → exit quietly
      const e = err as { name?: string; message?: string };
      if (e?.name === "ExitPromptError") { console.log(""); return; }
      throw err;
    }
  } else {
    port = options.port
      ?? (options.provider ? (getProviderPort(options.provider) ?? routerPort) : routerPort);
    model = options.model ?? "coder-model";
  }

  const env: EnvVars = {
    CLAUDE_CODE_USE_OPENAI: "1",
    OPENAI_BASE_URL: `http://localhost:${port}/v1`,
    OPENAI_API_KEY: "grouter",
    OPENAI_MODEL: model,
  };

  console.log("");
  console.log(`  ${chalk.bold("grouter up openclaude")}  ${chalk.gray("configuring OpenClaude integration…")}`);
  console.log("");

  // 1. settings.json
  const settingsOk = injectIntoSettings(env);
  if (settingsOk) {
    console.log(`  ${chalk.green("✓")}  ${chalk.bold(settingsLabel())}  ${chalk.gray("→ env block written")}`);
  } else {
    console.log(`  ${chalk.yellow("⚠")}  ${chalk.bold(settingsLabel())}  ${chalk.gray("could not write — check permissions")}`);
  }

  // 2. Platform-specific env setup
  if (process.platform === "win32") {
    const psPath = getPsProfilePath();
    const result = injectIntoPsProfile(env);
    const icon   = result === "failed" ? chalk.yellow("⚠") : chalk.green("✓");
    const action = result === "updated" ? "updated" : result === "injected" ? "written" : "failed";
    const shortPs = psPath.replace(homedir(), "~");
    console.log(`  ${icon}  ${chalk.bold(shortPs)}  ${chalk.gray(`(PowerShell profile) → ${action}`)}`);
  } else {
    const configs = shellConfigs();
    if (configs.length === 0) {
      console.log(`  ${chalk.gray("○")}  No shell configs found (bash/zsh/fish)`);
    } else {
      for (const cfg of configs) {
        const result = injectIntoShell(cfg, env);
        const icon   = result === "failed" ? chalk.yellow("⚠") : chalk.green("✓");
        const action = result === "updated" ? "updated" : result === "injected" ? "written" : "failed";
        console.log(`  ${icon}  ${chalk.bold(`~/${cfg.path.replace(homedir() + "/", "")}`)}  ${chalk.gray(`(${cfg.label}) → ${action}`)}`);
      }
    }
  }

  console.log("");
  console.log(`  ${chalk.gray("─────────────────────────────────────────────")}`);
  console.log("");
  console.log(`  ${chalk.bold("Active config")}`);
  if (providerId) {
    const pMeta = getProvider(providerId);
    console.log(`    ${chalk.gray("provider")} ${chalk.cyan(pMeta?.name ?? providerId)}`);
  } else {
    console.log(`    ${chalk.gray("provider")} ${chalk.cyan("router")} ${chalk.gray("(picks from pool)")}`);
  }
  console.log(`    ${chalk.gray("model")}    ${chalk.cyan(model)}`);
  console.log(`    ${chalk.gray("endpoint")} ${chalk.white(`http://localhost:${port}/v1`)}`);
  console.log(`    ${chalk.gray("api key")}  ${chalk.white("grouter")}`);
  console.log("");
  console.log(`  ${chalk.bold("Apply to current terminal session:")}`);
  console.log("");

  if (process.platform === "win32") {
    console.log(`  ${chalk.gray("PowerShell — paste and run:")}`);
    console.log(`    ${chalk.cyan(`$env:CLAUDE_CODE_USE_OPENAI = "1"`)}`);
    console.log(`    ${chalk.cyan(`$env:OPENAI_BASE_URL = "http://localhost:${port}/v1"`)}`);
    console.log(`    ${chalk.cyan(`$env:OPENAI_API_KEY = "grouter"`)}`);
    console.log(`    ${chalk.cyan(`$env:OPENAI_MODEL = "${model}"`)}`);
  } else {
    const shell = process.env.SHELL ?? "";
    if (shell.includes("fish")) {
      console.log(`  ${chalk.gray("fish — paste and run:")}`);
      console.log(`    ${chalk.cyan(`set -gx CLAUDE_CODE_USE_OPENAI "1"`)}`);
      console.log(`    ${chalk.cyan(`set -gx OPENAI_BASE_URL "http://localhost:${port}/v1"`)}`);
      console.log(`    ${chalk.cyan(`set -gx OPENAI_API_KEY "grouter"`)}`);
      console.log(`    ${chalk.cyan(`set -gx OPENAI_MODEL "${model}"`)}`);
    } else {
      console.log(`  ${chalk.gray("bash/zsh — paste and run:")}`);
      console.log(`    ${chalk.cyan(`export CLAUDE_CODE_USE_OPENAI="1"`)}`);
      console.log(`    ${chalk.cyan(`export OPENAI_BASE_URL="http://localhost:${port}/v1"`)}`);
      console.log(`    ${chalk.cyan(`export OPENAI_API_KEY="grouter"`)}`);
      console.log(`    ${chalk.cyan(`export OPENAI_MODEL="${model}"`)}`);
    }
  }

  console.log("");
  console.log(`  ${chalk.dim("To undo:")}  ${chalk.cyan("grouter up openclaude --remove")}`);
  console.log("");
  console.log(`  ${chalk.yellow("⚠")}  ${chalk.bold("Restart your Claude Code / openclaude session")} to apply the new model.`);
  console.log(`     ${chalk.gray("The model is read at startup — changes only take effect in a new session.")}`);
  console.log(`     ${chalk.gray("Close this terminal and run")} ${chalk.cyan("claude")} ${chalk.gray("again.")}`);
  console.log("");
}

export function upOpenclaudeRemoveCommand(): void {
  console.log("");
  console.log(`  ${chalk.bold("grouter up openclaude --remove")}  ${chalk.gray("removing OpenClaude integration…")}`);
  console.log("");

  const settingsOk = removeFromSettings();
  if (settingsOk) {
    console.log(`  ${chalk.green("✓")}  ${chalk.bold(settingsLabel())}  ${chalk.gray("→ env block removed")}`);
  } else {
    console.log(`  ${chalk.yellow("⚠")}  ${chalk.bold(settingsLabel())}  ${chalk.gray("could not update")}`);
  }

  if (process.platform === "win32") {
    const ok = removeFromPsProfile();
    const psPath = getPsProfilePath().replace(homedir(), "~");
    const icon = ok ? chalk.green("✓") : chalk.yellow("⚠");
    console.log(`  ${icon}  ${chalk.bold(psPath)}  ${chalk.gray("(PowerShell profile) → cleaned")}`);
  } else {
    for (const cfg of shellConfigs()) {
      const ok   = removeFromShell(cfg);
      const icon = ok ? chalk.green("✓") : chalk.yellow("⚠");
      console.log(`  ${icon}  ${chalk.bold(`~/${cfg.path.replace(homedir() + "/", "")}`)}  ${chalk.gray(`(${cfg.label}) → cleaned`)}`);
    }
  }

  console.log("");
}

