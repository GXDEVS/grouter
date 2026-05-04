import chalk from "chalk";
import { spawnSync } from "node:child_process";
import {
  resolveTarget,
  printActiveConfig,
  type UpOptions,
} from "./up-shared.ts";

// ── Cline CLI integration ────────────────────────────────────────────────────
//
// The Cline CLI exposes:
//   cline auth -p openai -k <key> -b <baseURL> -m <model>
//
// (Per https://docs.cline.bot — provider id `openai` is the OpenAI-compatible
// adapter, distinct from `openai-native` which is the official OpenAI API.)
// We shell out to `cline` directly — the binary owns its own state file
// (~/.config/cline/...) and dealing with that schema by hand would couple us
// to internal layout.

function findClineBinary(): string | null {
  const candidates = ["cline"];
  for (const name of candidates) {
    const found = Bun.which(name);
    if (found) return found;
  }
  return null;
}

function runCline(args: string[]): { ok: boolean; stdout: string; stderr: string; code: number | null } {
  const result = spawnSync("cline", args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status,
  };
}

function printInstallHint(): void {
  console.log(`  ${chalk.yellow("⚠")}  ${chalk.bold("cline")} CLI not found on PATH.`);
  console.log("");
  console.log(`  ${chalk.gray("Install it globally with npm:")}`);
  console.log(`    ${chalk.cyan("npm install -g cline")}`);
  console.log("");
  console.log(`  ${chalk.gray("Or — for the VS Code extension — install \"Cline\" from the marketplace,")}`);
  console.log(`  ${chalk.gray("then open the extension settings and configure manually:")}`);
  console.log(`    ${chalk.gray("Provider")}    ${chalk.cyan("OpenAI Compatible")}`);
  console.log(`    ${chalk.gray("Base URL")}    ${chalk.cyan("(see below)")}`);
  console.log(`    ${chalk.gray("API Key")}     ${chalk.cyan("grouter")}`);
  console.log(`    ${chalk.gray("Model ID")}    ${chalk.cyan("(see below)")}`);
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function upClineCommand(options: UpOptions): Promise<void> {
  const target = await resolveTarget(options, "Cline");
  if (!target) return;

  console.log("");
  console.log(`  ${chalk.bold("grouter up cline")}  ${chalk.gray("configuring Cline CLI integration…")}`);
  console.log("");

  const bin = findClineBinary();
  if (!bin) {
    printInstallHint();
    printActiveConfig(target);
    console.log("");
    return;
  }

  const args = [
    "auth",
    "-p", "openai",
    "-k", target.apiKey,
    "-b", target.baseURL,
    "-m", target.model,
  ];

  console.log(`  ${chalk.gray("running:")}  ${chalk.cyan("cline " + args.join(" "))}`);
  const res = runCline(args);
  if (res.ok) {
    console.log(`  ${chalk.green("✓")}  ${chalk.bold("cline auth")}  ${chalk.gray("→ updated")}`);
    if (res.stdout.trim()) {
      console.log("");
      for (const line of res.stdout.trim().split("\n")) console.log(`    ${chalk.gray(line)}`);
    }
  } else {
    console.log(`  ${chalk.yellow("⚠")}  ${chalk.bold("cline auth")}  ${chalk.gray(`→ failed (exit ${res.code ?? "?"})`)}`);
    const out = (res.stderr || res.stdout).trim();
    if (out) {
      console.log("");
      for (const line of out.split("\n").slice(0, 8)) console.log(`    ${chalk.gray(line)}`);
    }
  }

  printActiveConfig(target);
  console.log("");
  console.log(`  ${chalk.dim("To switch providers later, run:")}  ${chalk.cyan("cline auth")}`);
  console.log("");
}

export function upClineRemoveCommand(): void {
  console.log("");
  console.log(`  ${chalk.bold("grouter up cline --remove")}  ${chalk.gray("the Cline CLI keeps its own auth state…")}`);
  console.log("");
  console.log(`  ${chalk.gray("Cline doesn't expose a 'logout' subcommand. To switch back to a different")}`);
  console.log(`  ${chalk.gray("provider, run the interactive wizard:")}`);
  console.log("");
  console.log(`    ${chalk.cyan("cline auth")}`);
  console.log("");
  console.log(`  ${chalk.gray("Or pick another quick-setup, e.g.:")}`);
  console.log(`    ${chalk.cyan("cline auth -p anthropic -k sk-ant-…")}`);
  console.log("");
}
