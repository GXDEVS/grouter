import chalk from "chalk";
import ora from "ora";
import open from "open";
import { select, input, password, editor, Separator } from "@inquirer/prompts";
import { PROVIDERS, getProvider, type Provider } from "../providers/registry.ts";
import { getAdapter } from "../auth/providers/index.ts";
import { startCallbackListener } from "../auth/server.ts";
import {
  startDeviceFlow,
  pollDeviceFlow,
  startAuthCodeFlow,
  completeAuthCodeFlow,
  importToken as orchestratorImport,
} from "../auth/orchestrator.ts";
import { addApiKeyConnection } from "../db/accounts.ts";

/**
 * Multi-provider interactive `grouter add`.
 * Picks provider with arrow keys, then runs the right flow in-terminal.
 */
export async function addCommand(): Promise<void> {
  console.log("");

  try {
    const providerId = await pickProvider();
    if (!providerId) return;

    const p = getProvider(providerId)!;

    if (p.category === "apikey") {
      await runApiKeyFlow(p);
    } else {
      const adapter = getAdapter(providerId);
      if (!adapter) {
        console.log(`\n  ${chalk.red("✖")}  No OAuth adapter registered for ${providerId}\n`);
        return;
      }
      if (adapter.flow === "device_code")            await runDeviceFlow(providerId);
      else if (adapter.flow === "authorization_code"
            || adapter.flow === "authorization_code_pkce") await runAuthCodeFlow(providerId, p);
      else if (adapter.flow === "import_token")       await runImportFlow(providerId, p);
      else throw new Error(`Unsupported flow: ${adapter.flow}`);
    }

    console.log("");
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    if (e?.name === "ExitPromptError") { console.log(""); return; }
    console.error(`\n  ${chalk.red("✖")}  ${e?.message ?? String(err)}\n`);
    process.exit(1);
  }
}

// ── Provider picker ──────────────────────────────────────────────────────────

async function pickProvider(): Promise<string | null> {
  const all = Object.values(PROVIDERS).filter(p => !p.deprecated);

  const freeOAuth = all.filter(p => p.authType === "oauth" && p.freeTier);
  const paidOAuth = all.filter(p => p.authType === "oauth" && !p.freeTier);
  const apiKey    = all.filter(p => p.authType === "apikey");

  const row = (p: Provider) => {
    const tag = p.freeTier ? chalk.green(" FREE") : "";
    return {
      name: `${p.name.padEnd(18)} ${chalk.gray(p.authType)}${tag}`,
      value: p.id,
      description: p.description,
    };
  };

  const choices: Array<Separator | { name: string; value: string; description?: string }> = [];
  if (freeOAuth.length) { choices.push(new Separator(chalk.green("── OAuth — FREE ──"))); choices.push(...freeOAuth.map(row)); }
  if (paidOAuth.length) { choices.push(new Separator(chalk.cyan("── OAuth — subscription ──"))); choices.push(...paidOAuth.map(row)); }
  if (apiKey.length)    { choices.push(new Separator(chalk.yellow("── API Key ──"))); choices.push(...apiKey.map(row)); }

  return await select<string>({
    message: "Which provider do you want to add?",
    choices,
    pageSize: 20,
  });
}

// ── Device-code flow ──────────────────────────────────────────────────────────

async function runDeviceFlow(providerId: string): Promise<void> {
  const p = getProvider(providerId)!;
  const spinner = ora(`Requesting device code from ${p.name}…`).start();

  let started;
  try {
    started = await startDeviceFlow(providerId);
    spinner.succeed("Device code received");
  } catch (err) {
    spinner.fail(`${p.name} device code failed`);
    throw err;
  }

  const url = started.verification_uri_complete ?? started.verification_uri;

  console.log("");
  console.log(chalk.bold("  Authorize in your browser:"));
  console.log(`  ${chalk.cyan("URL:")}  ${chalk.underline(url)}`);
  if (started.user_code) console.log(`  ${chalk.cyan("Code:")} ${chalk.yellow.bold(started.user_code)}`);
  console.log("");

  try { await open(url); console.log(chalk.gray("  (Browser opened automatically)")); }
  catch { console.log(chalk.gray("  (Open the URL above manually)")); }

  console.log("");
  const pollSpinner = ora("Waiting for authorization…").start();

  const intervalMs = Math.max(2, started.interval ?? 5) * 1000;
  const deadline = Date.now() + started.expires_in * 1000;

  while (Date.now() < deadline) {
    await Bun.sleep(intervalMs);
    pollSpinner.text = chalk.gray(`Waiting for authorization… ${chalk.yellow(remaining(deadline))}`);

    const res = await pollDeviceFlow(started.session_id);
    if (res.status === "complete") {
      pollSpinner.succeed(chalk.green("Authorization successful!"));
      printSavedAccount(res.connection, p);
      return;
    }
    if (res.status === "denied") { pollSpinner.fail("Access denied in the browser."); return; }
    if (res.status === "expired") { pollSpinner.fail("Device code expired."); return; }
    if (res.status === "error")   { pollSpinner.fail(res.message); return; }
    // pending → keep polling
  }
  pollSpinner.fail("Timed out waiting for authorization.");
}

// ── Authorization-code flow ──────────────────────────────────────────────────

async function runAuthCodeFlow(providerId: string, p: Provider): Promise<void> {
  const adapter = getAdapter(providerId)!;

  // Prompt for meta fields if the provider requires them (GitLab baseUrl/clientId/secret)
  let meta: Record<string, string> | undefined;
  if (p.requiresMeta?.length) {
    meta = {};
    console.log(chalk.gray(`\n  ${p.name} requires additional OAuth app credentials:\n`));
    for (const m of p.requiresMeta) {
      const v = await input({
        message: m.label + (m.required ? " *" : ""),
        default: m.placeholder && !m.placeholder.startsWith("(") ? m.placeholder : undefined,
        validate: (x) => m.required && !x.trim() ? `${m.label} is required` : true,
      });
      if (v.trim()) meta[m.key] = v.trim();
    }
  }

  // Spin up ephemeral listener
  const listener = startCallbackListener({
    port: adapter.fixedPort ?? 0,
    path: adapter.callbackPath ?? "/callback",
  });

  const started = startAuthCodeFlow(providerId, listener.redirectUri, meta);

  console.log("");
  console.log(chalk.bold(`  Authorize ${p.name} in your browser:`));
  console.log(`  ${chalk.cyan("URL:")}  ${chalk.underline(started.authUrl)}`);
  console.log("");

  try { await open(started.authUrl); console.log(chalk.gray("  (Browser opened automatically)")); }
  catch { console.log(chalk.gray("  (Open the URL above manually)")); }

  console.log("");
  const spinner = ora("Waiting for callback…").start();

  try {
    const capture = await listener.wait();
    listener.close();
    if (capture.error) { spinner.fail(`Authorization denied: ${capture.error}`); return; }
    if (!capture.code || !capture.state) { spinner.fail("Missing code or state in callback"); return; }

    spinner.text = "Exchanging code for tokens…";
    const connection = await completeAuthCodeFlow(started.session_id, capture.code, capture.state);
    spinner.succeed(chalk.green("Authorization successful!"));
    printSavedAccount(connection, p);
  } catch (err) {
    listener.close();
    spinner.fail(err instanceof Error ? err.message : String(err));
  }
}

// ── Import-token flow ─────────────────────────────────────────────────────────

async function runImportFlow(providerId: string, p: Provider): Promise<void> {
  console.log(chalk.gray(`\n  Paste the access token from ${p.name}.`));
  if (p.id === "cursor") {
    console.log(chalk.gray("  Find it in Cursor IDE → Settings → General → Access Token."));
  }
  if (p.id === "opencode") {
    console.log(chalk.gray("  OpenCode is a public shared pool — press Enter to continue."));
  }
  console.log("");

  const token = p.id === "opencode"
    ? "activate"
    : await editor({
        message: "Token",
        default: "",
        waitForUserInput: false,
      }).catch(() => "");

  if (!token.trim()) { console.log(chalk.yellow("  Empty token — aborting.\n")); return; }

  const spinner = ora(`Importing ${p.name} token…`).start();
  try {
    const connection = await orchestratorImport(providerId, token.trim());
    spinner.succeed(chalk.green("Token imported"));
    printSavedAccount(connection, p);
  } catch (err) {
    spinner.fail(err instanceof Error ? err.message : String(err));
  }
}

// ── API-key flow ──────────────────────────────────────────────────────────────

async function runApiKeyFlow(p: Provider): Promise<void> {
  console.log("");
  if (p.apiKeyUrl) console.log(chalk.gray(`  Get a key at: ${chalk.underline(p.apiKeyUrl)}`));
  if (p.freeTier?.notice) console.log(chalk.green(`  ${p.freeTier.notice}`));
  console.log("");

  const apiKey = await password({
    message: `${p.name} API key`,
    mask: "•",
    validate: (v) => v.trim() ? true : "API key is required",
  });

  const displayName = await input({
    message: "Display name (optional)",
    default: "",
  });

  const spinner = ora("Saving connection…").start();
  try {
    const connection = addApiKeyConnection({
      provider: p.id,
      api_key: apiKey.trim(),
      display_name: displayName.trim() || null,
    });
    spinner.succeed(chalk.green("API key saved"));
    printSavedAccount(connection, p);
  } catch (err) {
    spinner.fail(err instanceof Error ? err.message : String(err));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function remaining(deadline: number): string {
  const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function printSavedAccount(connection: { id: string; email: string | null; priority: number }, p: Provider): void {
  const label = connection.email ?? connection.id.slice(0, 8);
  console.log("");
  console.log(`  ${chalk.green("✓")}  ${p.name} connection saved  ${chalk.gray(`${label} · priority ${connection.priority}`)}`);
  console.log(`  ${chalk.gray("next:")}  ${chalk.cyan("grouter up openclaude")}  ${chalk.gray("to wire up your tool")}`);
}
