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

// ── openclaw.json (~/.openclaw/openclaw.json) ────────────────────────────────
//
// Schema (per https://docs.openclaw.ai/gateway/configuration):
//   {
//     "agents": {
//       "defaults": {
//         "model": { "primary": "<provider>/<model>" },
//         "models": {
//           "<provider>/<model>": {
//             "alias": "...",
//             "baseUrl": "http://localhost:3099/v1",
//             "apiKey": "grouter"
//           }
//         }
//       }
//     }
//   }
//
// We register under the namespaced id "grouter/<model>" so multiple grouter
// entries can coexist with the user's own custom providers.

const NAMESPACE = "grouter";

function getConfigPath(): string {
  const override = process.env.OPENCLAW_CONFIG_PATH;
  if (override) return override;
  const home = process.env.OPENCLAW_HOME ?? join(homedir(), ".openclaw");
  return join(home, "openclaw.json");
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

function modelKey(target: ResolvedTarget): string {
  // OpenClaw expects "<provider>/<model>" — namespace under "grouter/" so the
  // entry is unambiguous regardless of which grouter provider is behind it.
  // We also strip any "kiro/" / "claude/" prefix to keep the id flat.
  const flat = target.model.replace(/\//g, "-");
  return `${NAMESPACE}/${flat}`;
}

function aliasFor(target: ResolvedTarget): string {
  return target.providerId
    ? `Grouter (${target.providerId} · ${target.model})`
    : `Grouter (${target.model})`;
}

function injectIntoOpenclawConfig(t: ResolvedTarget): {
  outcome: "injected" | "updated" | "failed";
  key: string;
} {
  const key = modelKey(t);
  try {
    const cfg = readConfig();
    const agents = (cfg.agents as Record<string, unknown> | undefined) ?? {};
    const defaults = (agents.defaults as Record<string, unknown> | undefined) ?? {};
    const models = (defaults.models as Record<string, unknown> | undefined) ?? {};
    const had = models[key] !== undefined;
    models[key] = {
      alias: aliasFor(t),
      baseUrl: t.baseURL,
      apiKey: t.apiKey,
    };
    defaults.models = models;
    // Only set as primary if no primary is configured yet — don't hijack.
    const model = (defaults.model as Record<string, unknown> | undefined) ?? {};
    if (!model.primary) model.primary = key;
    defaults.model = model;
    agents.defaults = defaults;
    cfg.agents = agents;
    writeConfig(cfg);
    return { outcome: had ? "updated" : "injected", key };
  } catch {
    return { outcome: "failed", key };
  }
}

function removeFromOpenclawConfig(): { ok: boolean; removed: string[] } {
  const removed: string[] = [];
  try {
    const cfg = readConfig();
    const agents = cfg.agents as Record<string, unknown> | undefined;
    const defaults = agents?.defaults as Record<string, unknown> | undefined;
    const models = defaults?.models as Record<string, unknown> | undefined;
    if (!models) return { ok: true, removed };
    for (const k of Object.keys(models)) {
      if (k.startsWith(`${NAMESPACE}/`)) {
        delete models[k];
        removed.push(k);
      }
    }
    if (Object.keys(models).length === 0) delete defaults!.models;
    // If the configured primary points at a removed entry, drop it so OpenClaw
    // falls back to its own resolution rather than failing.
    const model = defaults?.model as Record<string, unknown> | undefined;
    if (model && typeof model.primary === "string" && removed.includes(model.primary)) {
      delete model.primary;
      if (Object.keys(model).length === 0) delete defaults!.model;
    }
    writeConfig(cfg);
    return { ok: true, removed };
  } catch {
    return { ok: false, removed };
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function upOpenclawCommand(options: UpOptions): Promise<void> {
  const target = await resolveTarget(options, "OpenClaw");
  if (!target) return;

  console.log("");
  console.log(`  ${chalk.bold("grouter up openclaw")}  ${chalk.gray("configuring OpenClaw integration…")}`);
  console.log("");

  const result = injectIntoOpenclawConfig(target);
  printWriteReport({
    label: configLabel(),
    outcome: result.outcome,
    detail: `model "${result.key}"`,
  });

  printActiveConfig(target);
  console.log("");
  console.log(`  ${chalk.bold("Use it in OpenClaw:")}`);
  console.log(`    ${chalk.gray("the entry is registered under")}  ${chalk.cyan(result.key)}`);
  console.log(`    ${chalk.gray("OpenClaw will use it as the primary model unless one is already set.")}`);
  console.log("");
  console.log(`  ${chalk.dim("To undo:")}  ${chalk.cyan("grouter up openclaw --remove")}`);
  console.log("");
}

export function upOpenclawRemoveCommand(): void {
  console.log("");
  console.log(`  ${chalk.bold("grouter up openclaw --remove")}  ${chalk.gray("removing OpenClaw integration…")}`);
  console.log("");

  const res = removeFromOpenclawConfig();
  printWriteReport({
    label: configLabel(),
    outcome: res.ok ? "updated" : "failed",
    detail: res.removed.length > 0
      ? `${res.removed.length} grouter entry(ies) removed`
      : (res.ok ? "nothing to remove" : "could not update"),
  });
  console.log("");
}
