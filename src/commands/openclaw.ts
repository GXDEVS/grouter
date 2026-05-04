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
// Schema (verified against `openclaw config schema` v2026.5.3-1):
//   models.providers["grouter"] = {
//     baseUrl, apiKey, auth: "api-key", api: "openai-completions",
//     models: [ { id: "<model>", name: "<display>" }, ... ]
//   }
//   agents.defaults.model.primary = "grouter/<model>"
//
// We register one provider entry called "grouter" and append each requested
// model into its `models[]` array so re-running `up openclaw` with a different
// model adds to the catalog instead of replacing it.

const PROVIDER_KEY = "grouter";
const PROVIDER_NAME = "Grouter";

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

interface ProviderModel {
  id: string;
  name?: string;
}

interface ProviderEntry {
  baseUrl: string;
  apiKey: string;
  auth: "api-key";
  api: "openai-completions";
  models: ProviderModel[];
  [k: string]: unknown;
}

function buildModelEntry(t: ResolvedTarget): ProviderModel {
  const display = t.providerId
    ? `${PROVIDER_NAME} (${t.providerId} · ${t.model})`
    : `${PROVIDER_NAME} (${t.model})`;
  return { id: t.model, name: display };
}

function injectIntoOpenclawConfig(t: ResolvedTarget): {
  outcome: "injected" | "updated" | "failed";
  primaryId: string;
} {
  const primaryId = `${PROVIDER_KEY}/${t.model}`;
  try {
    const cfg = readConfig();

    // models.providers["grouter"] — preserve existing models, dedupe by id
    const models = (cfg.models as Record<string, unknown> | undefined) ?? {};
    const providers = (models.providers as Record<string, unknown> | undefined) ?? {};
    const existing = providers[PROVIDER_KEY] as ProviderEntry | undefined;

    const had = existing !== undefined;
    const existingModels = Array.isArray(existing?.models) ? existing!.models : [];
    const merged: ProviderModel[] = [
      ...existingModels.filter((m) => m && m.id !== t.model),
      buildModelEntry(t),
    ];

    const entry: ProviderEntry = {
      ...(existing ?? {}),
      baseUrl: t.baseURL,
      apiKey: t.apiKey,
      auth: "api-key",
      api: "openai-completions",
      models: merged,
    };

    providers[PROVIDER_KEY] = entry;
    models.providers = providers;
    cfg.models = models;

    // agents.defaults.model.primary — only set if no primary is configured
    const agents = (cfg.agents as Record<string, unknown> | undefined) ?? {};
    const defaults = (agents.defaults as Record<string, unknown> | undefined) ?? {};
    const modelDefaults = (defaults.model as Record<string, unknown> | undefined) ?? {};
    if (!modelDefaults.primary) modelDefaults.primary = primaryId;
    defaults.model = modelDefaults;
    agents.defaults = defaults;
    cfg.agents = agents;

    writeConfig(cfg);
    return { outcome: had ? "updated" : "injected", primaryId };
  } catch {
    return { outcome: "failed", primaryId };
  }
}

function removeFromOpenclawConfig(): { ok: boolean; removed: boolean } {
  try {
    const cfg = readConfig();
    const models = cfg.models as Record<string, unknown> | undefined;
    const providers = models?.providers as Record<string, unknown> | undefined;
    let removed = false;

    if (providers && providers[PROVIDER_KEY] !== undefined) {
      delete providers[PROVIDER_KEY];
      removed = true;
      if (Object.keys(providers).length === 0) delete models!.providers;
      if (Object.keys(models!).length === 0) delete cfg.models;
    }

    // If the configured primary points at a grouter/* model, drop it so OpenClaw
    // falls back to its own resolution instead of failing.
    const agents = cfg.agents as Record<string, unknown> | undefined;
    const defaults = agents?.defaults as Record<string, unknown> | undefined;
    const modelDefaults = defaults?.model as Record<string, unknown> | undefined;
    if (
      modelDefaults &&
      typeof modelDefaults.primary === "string" &&
      modelDefaults.primary.startsWith(`${PROVIDER_KEY}/`)
    ) {
      delete modelDefaults.primary;
      if (Object.keys(modelDefaults).length === 0) delete defaults!.model;
    }

    writeConfig(cfg);
    return { ok: true, removed };
  } catch {
    return { ok: false, removed: false };
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
    detail: `model "${result.primaryId}"`,
  });

  printActiveConfig(target);
  console.log("");
  console.log(`  ${chalk.bold("Use it in OpenClaw:")}`);
  console.log(`    ${chalk.cyan(`openclaw infer model run --model ${result.primaryId} --prompt "hello"`)}`);
  console.log("");
  console.log(`  ${chalk.gray("Verify the provider is recognized:")}`);
  console.log(`    ${chalk.cyan("openclaw infer model providers")}  ${chalk.gray("# look for \"provider\":\"grouter\"")}`);
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
    detail: res.ok
      ? (res.removed ? `provider "${PROVIDER_KEY}" removed` : "nothing to remove")
      : "could not update",
  });
  console.log("");
}
