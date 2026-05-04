import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import {
  resolveTarget,
  printActiveConfig,
  printWriteReport,
  type ResolvedTarget,
  type UpOptions,
} from "./up-shared.ts";

// ── opencode.json (global at ~/.config/opencode/opencode.json) ───────────────
//
// OpenCode's custom-provider schema (per https://opencode.ai/docs/providers):
//   {
//     "$schema": "https://opencode.ai/config.json",
//     "provider": {
//       "grouter": {
//         "npm": "@ai-sdk/openai-compatible",
//         "name": "Grouter",
//         "options": { "baseURL": "...", "apiKey": "grouter" },
//         "models": { "<model-id>": { "name": "<display>" } }
//       }
//     }
//   }

const PROVIDER_KEY = "grouter";

function getConfigPath(): string {
  const override = process.env.OPENCODE_CONFIG;
  if (override) return override;
  return join(homedir(), ".config", "opencode", "opencode.json");
}

function configLabel(): string {
  return getConfigPath().replace(homedir(), "~");
}

function readConfig(): Record<string, unknown> {
  const p = getConfigPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeConfig(obj: Record<string, unknown>): void {
  const p = getConfigPath();
  const dir = join(p, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function buildProviderEntry(t: ResolvedTarget): Record<string, unknown> {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "Grouter",
    options: {
      baseURL: t.baseURL,
      apiKey: t.apiKey,
    },
    models: {
      [t.model]: {
        name: t.model,
      },
    },
  };
}

function injectIntoOpencodeConfig(t: ResolvedTarget): "injected" | "updated" | "failed" {
  try {
    const cfg = readConfig();
    const had = (cfg.provider as Record<string, unknown> | undefined)?.[PROVIDER_KEY] !== undefined;
    if (!cfg.$schema) cfg.$schema = "https://opencode.ai/config.json";
    const provider = (cfg.provider as Record<string, unknown> | undefined) ?? {};
    provider[PROVIDER_KEY] = buildProviderEntry(t);
    cfg.provider = provider;
    writeConfig(cfg);
    return had ? "updated" : "injected";
  } catch {
    return "failed";
  }
}

function removeFromOpencodeConfig(): boolean {
  try {
    const cfg = readConfig();
    const provider = cfg.provider as Record<string, unknown> | undefined;
    if (!provider || provider[PROVIDER_KEY] === undefined) return true;
    delete provider[PROVIDER_KEY];
    if (Object.keys(provider).length === 0) delete cfg.provider;
    writeConfig(cfg);
    return true;
  } catch {
    return false;
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function upOpencodeCommand(options: UpOptions): Promise<void> {
  const target = await resolveTarget(options, "OpenCode");
  if (!target) return;

  console.log("");
  console.log(`  ${chalk.bold("grouter up opencode")}  ${chalk.gray("configuring OpenCode integration…")}`);
  console.log("");

  const result = injectIntoOpencodeConfig(target);
  printWriteReport({
    label: configLabel(),
    outcome: result,
    detail: `provider "${PROVIDER_KEY}" + model "${target.model}"`,
  });

  printActiveConfig(target);
  console.log("");
  console.log(`  ${chalk.bold("Use it in OpenCode:")}`);
  console.log(`    ${chalk.cyan(`opencode run --model ${PROVIDER_KEY}/${target.model} "hello"`)}`);
  console.log("");
  console.log(`  ${chalk.gray("or set as default in opencode.json:")}`);
  console.log(`    ${chalk.cyan(`"model": "${PROVIDER_KEY}/${target.model}"`)}`);
  console.log("");
  console.log(`  ${chalk.dim("To undo:")}  ${chalk.cyan("grouter up opencode --remove")}`);
  console.log("");
}

export function upOpencodeRemoveCommand(): void {
  console.log("");
  console.log(`  ${chalk.bold("grouter up opencode --remove")}  ${chalk.gray("removing OpenCode integration…")}`);
  console.log("");

  const ok = removeFromOpencodeConfig();
  printWriteReport({
    label: configLabel(),
    outcome: ok ? "updated" : "failed",
    detail: ok ? `provider "${PROVIDER_KEY}" removed` : "could not update",
  });
  console.log("");
}
