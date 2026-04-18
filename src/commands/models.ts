import chalk from "chalk";
import { PROVIDERS, getProvider } from "../providers/registry.ts";
import { getProxyPort } from "../db/index.ts";
import { getProviderPort } from "../db/ports.ts";
import { getConnectionCountByProvider } from "../db/accounts.ts";

/**
 * `grouter models [provider]`
 *
 * No arg  → list every provider with its dedicated port + model IDs.
 * With arg → show just that provider's models (IDs + names), plus the exact
 *            OPENAI_BASE_URL + OPENAI_MODEL examples for OpenClaude/Codex/etc.
 */
export async function modelsCommand(provider?: string): Promise<void> {
  const routerPort = getProxyPort();
  const counts = getConnectionCountByProvider();

  if (!provider) {
    console.log("");
    console.log(`  ${chalk.bold("grouter models")}  ${chalk.gray("— available models per provider")}`);
    console.log(`  ${chalk.gray("router:")}  ${chalk.white(`http://localhost:${routerPort}/v1`)}`);
    console.log(`  ${chalk.gray("─────────────────────────────────────────────")}`);
    console.log("");

    for (const p of Object.values(PROVIDERS)) {
      const port = getProviderPort(p.id);
      const n    = counts[p.id] ?? 0;
      const dot  = n > 0 ? chalk.green("●") : chalk.gray("○");
      const tag  = p.deprecated ? chalk.red(" (deprecated)")
                 : p.freeTier   ? chalk.green(" · FREE")
                 : "";
      const portStr = port ? chalk.cyan(`:${port}`) : chalk.gray("—");
      console.log(`  ${dot} ${chalk.bold(p.name.padEnd(18))} ${portStr}   ${chalk.gray(`${n} conn`)}${tag}`);
      for (const m of p.models) {
        console.log(`      ${chalk.cyan(m.id.padEnd(42))} ${chalk.gray(m.name)}`);
      }
      console.log("");
    }

    console.log(`  ${chalk.gray("run")} ${chalk.cyan("grouter models <provider>")} ${chalk.gray("for a single provider + copy-paste examples")}`);
    console.log("");
    return;
  }

  // ── Single provider view ────────────────────────────────────────────────────
  const p = getProvider(provider);
  if (!p) {
    console.log("");
    console.log(`  ${chalk.red("✖")}  Unknown provider: ${chalk.bold(provider)}`);
    console.log(`  ${chalk.gray("valid providers:")} ${Object.keys(PROVIDERS).join(", ")}`);
    console.log("");
    process.exit(1);
    return;
  }

  const port = getProviderPort(p.id);
  const n    = counts[p.id] ?? 0;

  console.log("");
  console.log(`  ${chalk.bold(p.name)}  ${p.freeTier ? chalk.green("FREE") : p.deprecated ? chalk.red("deprecated") : chalk.gray(p.authType)}`);
  console.log(`  ${chalk.gray(p.description)}`);
  console.log(`  ${chalk.gray("─────────────────────────────────────────────")}`);
  console.log(`  ${chalk.gray("connections")}  ${n > 0 ? chalk.green(`${n} active`) : chalk.gray("none — run `grouter add` first")}`);
  console.log(`  ${chalk.gray("port")}         ${port ? chalk.cyan(port) : chalk.gray(`(assigned on first connection — router is ${routerPort})`)}`);
  if (p.freeTier?.notice) console.log(`  ${chalk.gray("free tier")}    ${chalk.green(p.freeTier.notice)}`);
  if (p.deprecated)       console.log(`  ${chalk.red("warning")}      ${chalk.red(p.deprecationReason ?? "no longer accepting new connections")}`);
  console.log("");
  console.log(`  ${chalk.bold("Models")}`);
  for (const m of p.models) {
    console.log(`    ${chalk.cyan(m.id.padEnd(42))} ${chalk.gray(m.name)}`);
  }
  console.log("");

  const boundPort = port ?? routerPort;
  const exampleModel = p.models[0]?.id ?? "default";
  console.log(`  ${chalk.bold("Use with OpenClaude / Codex / Cline:")}`);
  console.log(`    ${chalk.gray("OPENAI_BASE_URL")}  ${chalk.white(`http://localhost:${boundPort}/v1`)}`);
  console.log(`    ${chalk.gray("OPENAI_API_KEY")}   ${chalk.white("grouter")}`);
  console.log(`    ${chalk.gray("OPENAI_MODEL")}     ${chalk.white(exampleModel)}`);
  console.log("");
  console.log(`  ${chalk.gray("apply:")} ${chalk.cyan(`grouter up openclaude --provider ${p.id} --model ${exampleModel}`)}`);
  console.log("");
}
