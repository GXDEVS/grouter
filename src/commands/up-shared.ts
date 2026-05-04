// Shared bits used by every `grouter up <platform>` subcommand:
//  - the provider/model picker wizard
//  - the resolved EnvVars shape (base URL, key, model)
//  - the writable-target descriptor used for terminal output

import chalk from "chalk";
import { select, input } from "@inquirer/prompts";
import { getProxyPort } from "../db/index.ts";
import {
  getProvider,
  providerHasFreeModelsById,
  PROVIDERS,
  isProviderLocked,
} from "../providers/registry.ts";
import { getProviderPort } from "../db/ports.ts";
import { getConnectionCountByProvider } from "../db/accounts.ts";
import {
  fetchAndSaveProviderModels,
  getModelsForProvider,
} from "../providers/model-fetcher.ts";

export interface PickResult {
  providerId: string | null; // null = router (any provider)
  port: number;
  model: string;
}

export interface ResolvedTarget {
  providerId: string | null;
  port: number;
  model: string;
  baseURL: string;
  apiKey: string;
}

export type WriteOutcome = "injected" | "updated" | "failed" | "skipped";

export interface WriteReport {
  label: string;       // e.g. "~/.config/opencode/opencode.json"
  outcome: WriteOutcome;
  detail?: string;     // optional extra explanation appended after the icon
}

async function pickModel(
  choices: { name: string; value: string }[],
  message: string,
): Promise<string> {
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

export async function pickProviderAndModel(
  routerPort: number,
  promptLabel: string,
): Promise<PickResult> {
  const counts = getConnectionCountByProvider();

  const all = Object.values(PROVIDERS).filter((p) => !isProviderLocked(p));
  const sorted = [...all].sort(
    (a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0),
  );

  const choices = [
    {
      name: `${chalk.bold("Router")} ${chalk.gray("(uses first available provider · port " + routerPort + ")")}`,
      value: "__router__",
      description: "Send requests to the main router — it picks the account.",
    },
    ...sorted.map((p) => {
      const port = getProviderPort(p.id);
      const n = counts[p.id] ?? 0;
      const tag = providerHasFreeModelsById(p.id) ? chalk.green(" FREE") : "";
      const portStr = port ? chalk.cyan(`:${port}`) : chalk.gray("(no port yet)");
      const connStr = n > 0 ? chalk.green(`${n} conn`) : chalk.gray("0 conn");
      return {
        name: `${p.name.padEnd(18)} ${portStr}  ${connStr}${tag}`,
        value: p.id,
        description: p.description,
        disabled:
          n === 0 ? chalk.gray(" — no connections; run `grouter add` first") : false,
      };
    }),
  ];

  const providerId = await select({
    message: `Which provider should ${promptLabel} use?`,
    choices,
    pageSize: 14,
  });

  if (providerId === "__router__") {
    await Promise.allSettled(
      sorted
        .filter((p) => (counts[p.id] ?? 0) > 0)
        .map((p) => fetchAndSaveProviderModels(p.id)),
    );

    const modelChoices = sorted
      .filter((p) => (counts[p.id] ?? 0) > 0)
      .flatMap((p) => {
        const models = getModelsForProvider(p.id);
        return models.map((m) => ({
          name: `${chalk.cyan(m.id.padEnd(42))} ${chalk.gray(p.name + " · " + m.name)}${m.is_free ? chalk.green(" FREE") : ""}`,
          value: `${p.id}/${m.id}`,
        }));
      });
    if (modelChoices.length === 0) {
      console.log(
        `\n  ${chalk.yellow("⚠")}  No connected providers. Run ${chalk.cyan("grouter add")} first.\n`,
      );
      process.exit(1);
    }
    const model = await pickModel(modelChoices, "Which model?");
    return { providerId: null, port: routerPort, model };
  }

  const p = getProvider(providerId)!;
  const port = getProviderPort(p.id) ?? routerPort;
  await fetchAndSaveProviderModels(p.id).catch(() => null);
  const modelChoices = getModelsForProvider(p.id).map((m) => ({
    name: `${chalk.cyan(m.id.padEnd(42))} ${chalk.gray(m.name)}${m.is_free ? chalk.green(" FREE") : ""}`,
    value: m.id,
  }));
  const model = await pickModel(modelChoices, `Which ${p.name} model?`);

  return { providerId: p.id, port, model };
}

export interface UpOptions {
  model?: string;
  port?: number;
  provider?: string;
  noInteractive?: boolean;
}

export async function resolveTarget(
  options: UpOptions,
  promptLabel: string,
): Promise<ResolvedTarget | null> {
  const routerPort = getProxyPort();

  let providerId: string | null = options.provider ?? null;
  let port: number;
  let model: string;

  const hasEverything = options.model && (options.port || options.provider);
  const interactive =
    !options.noInteractive && process.stdout.isTTY && !hasEverything;

  if (interactive) {
    try {
      const res = await pickProviderAndModel(routerPort, promptLabel);
      providerId = res.providerId;
      port = res.port;
      model = res.model;
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "ExitPromptError") {
        console.log("");
        return null;
      }
      throw err;
    }
  } else {
    port =
      options.port ??
      (options.provider ? (getProviderPort(options.provider) ?? routerPort) : routerPort);
    model = options.model ?? "coder-model";
  }

  return {
    providerId,
    port,
    model,
    baseURL: `http://localhost:${port}/v1`,
    apiKey: "grouter",
  };
}

export function printActiveConfig(t: ResolvedTarget): void {
  console.log("");
  console.log(`  ${chalk.gray("─────────────────────────────────────────────")}`);
  console.log("");
  console.log(`  ${chalk.bold("Active config")}`);
  if (t.providerId) {
    const pMeta = getProvider(t.providerId);
    console.log(`    ${chalk.gray("provider")} ${chalk.cyan(pMeta?.name ?? t.providerId)}`);
  } else {
    console.log(`    ${chalk.gray("provider")} ${chalk.cyan("router")} ${chalk.gray("(picks from pool)")}`);
  }
  console.log(`    ${chalk.gray("model")}    ${chalk.cyan(t.model)}`);
  console.log(`    ${chalk.gray("endpoint")} ${chalk.white(t.baseURL)}`);
  console.log(`    ${chalk.gray("api key")}  ${chalk.white(t.apiKey)}`);
}

export function printWriteReport(report: WriteReport): void {
  const icon =
    report.outcome === "failed"
      ? chalk.yellow("⚠")
      : report.outcome === "skipped"
        ? chalk.gray("○")
        : chalk.green("✓");
  const action =
    report.outcome === "updated"
      ? "updated"
      : report.outcome === "injected"
        ? "written"
        : report.outcome === "skipped"
          ? "skipped"
          : "failed";
  const detail = report.detail ? ` ${chalk.gray(report.detail)}` : "";
  console.log(`  ${icon}  ${chalk.bold(report.label)}  ${chalk.gray(`→ ${action}`)}${detail}`);
}
