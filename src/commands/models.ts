import chalk from "chalk";
import { PROVIDERS, getProvider, providerHasFreeModelsById, getProviderLock } from "../providers/registry.ts";
import { getProxyPort } from "../db/index.ts";
import { getProviderPort } from "../db/ports.ts";
import { getConnectionCountByProvider } from "../db/accounts.ts";
import { getModelsForProvider } from "../providers/model-fetcher.ts";

/**
 * `grouter models [provider]`
 *
 * No arg: list every provider with its dedicated port + model IDs.
 * With arg: show only that provider models and exact OpenAI env examples.
 */
export async function modelsCommand(provider?: string): Promise<void> {
  const routerPort = getProxyPort();
  const counts = getConnectionCountByProvider();

  if (!provider) {
    console.log("");
    console.log(`  ${chalk.bold("grouter models")}  ${chalk.gray("- available models per provider")}`);
    console.log(`  ${chalk.gray("router:")}  ${chalk.white(`http://localhost:${routerPort}/v1`)}`);
    console.log(`  ${chalk.gray("-----------------------------------------------------")}`);
    console.log("");

    for (const p of Object.values(PROVIDERS)) {
      const port = getProviderPort(p.id);
      const n = counts[p.id] ?? 0;
      const models = getModelsForProvider(p.id);
      const hasFreeModels = models.length > 0
        ? models.some((m) => m.is_free)
        : providerHasFreeModelsById(p.id);
      const dot = n > 0 ? chalk.green("*") : chalk.gray("o");
      const lock = getProviderLock(p);
      const tag = lock?.kind === "deprecated" ? chalk.red(" (deprecated)")
        : lock?.kind === "under-construction" ? chalk.yellow(" (em construção)")
        : hasFreeModels ? chalk.green(" FREE")
          : "";
      const portStr = port ? chalk.cyan(`:${port}`) : chalk.gray("-");
      console.log(`  ${dot} ${chalk.bold(p.name.padEnd(18))} ${portStr}   ${chalk.gray(`${n} conn`)}${tag}`);
      for (const m of models) {
        const freeTag = m.is_free ? chalk.green(" FREE") : "";
        console.log(`      ${chalk.cyan(m.id.padEnd(42))} ${chalk.gray(m.name)}${freeTag}`);
      }
      console.log("");
    }

    console.log(`  ${chalk.gray("run")} ${chalk.cyan("grouter models <provider>")} ${chalk.gray("for a single provider + copy-paste examples")}`);
    console.log("");
    return;
  }

  const p = getProvider(provider);
  if (!p) {
    console.log("");
    console.log(`  ${chalk.red("x")}  Unknown provider: ${chalk.bold(provider)}`);
    console.log(`  ${chalk.gray("valid providers:")} ${Object.keys(PROVIDERS).join(", ")}`);
    console.log("");
    process.exit(1);
    return;
  }

  const port = getProviderPort(p.id);
  const n = counts[p.id] ?? 0;
  const models = getModelsForProvider(p.id);
  const hasFreeModels = models.length > 0
    ? models.some((m) => m.is_free)
    : providerHasFreeModelsById(p.id);

  const detailLock = getProviderLock(p);
  const headerBadge = detailLock?.kind === "deprecated" ? chalk.red("deprecated")
    : detailLock?.kind === "under-construction" ? chalk.yellow("em construção")
    : hasFreeModels ? chalk.green("FREE")
    : chalk.gray(p.authType);
  console.log("");
  console.log(`  ${chalk.bold(p.name)}  ${headerBadge}`);
  console.log(`  ${chalk.gray(p.description)}`);
  console.log(`  ${chalk.gray("-----------------------------------------------------")}`);
  console.log(`  ${chalk.gray("connections")}  ${n > 0 ? chalk.green(`${n} active`) : chalk.gray("none - run `grouter add` first")}`);
  console.log(`  ${chalk.gray("port")}         ${port ? chalk.cyan(port) : chalk.gray(`(assigned on first connection - router is ${routerPort})`)}`);
  if (hasFreeModels && p.freeTier?.notice) {
    console.log(`  ${chalk.gray("free tier")}    ${chalk.green(p.freeTier.notice)}`);
  }
  if (detailLock?.kind === "deprecated") console.log(`  ${chalk.red("warning")}      ${chalk.red(detailLock.reason)}`);
  if (detailLock?.kind === "under-construction") console.log(`  ${chalk.yellow("aviso")}        ${chalk.yellow(detailLock.reason)}`);
  console.log("");
  console.log(`  ${chalk.bold("Models")}`);
  for (const m of models) {
    const freeTag = m.is_free ? chalk.green(" FREE") : "";
    console.log(`    ${chalk.cyan(m.id.padEnd(42))} ${chalk.gray(m.name)}${freeTag}`);
  }
  console.log("");

  const boundPort = port ?? routerPort;
  const exampleModel = models[0]?.id ?? "default";
  console.log(`  ${chalk.bold("Use with OpenClaude / Codex / Cline:")}`);
  console.log(`    ${chalk.gray("OPENAI_BASE_URL")}  ${chalk.white(`http://localhost:${boundPort}/v1`)}`);
  console.log(`    ${chalk.gray("OPENAI_API_KEY")}   ${chalk.white("grouter")}`);
  console.log(`    ${chalk.gray("OPENAI_MODEL")}     ${chalk.white(exampleModel)}`);
  console.log("");
  console.log(`  ${chalk.gray("apply:")} ${chalk.cyan(`grouter up openclaude --provider ${p.id} --model ${exampleModel}`)}`);
  console.log("");
}
