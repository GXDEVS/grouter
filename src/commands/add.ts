import chalk from "chalk";
import ora from "ora";
import open from "open";
import { select, input, password, editor, Separator } from "@inquirer/prompts";
import { PROVIDERS, getProvider, providerHasFreeModelsById, isProviderLocked, type Provider, saveCustomProvider } from "../providers/registry.ts";
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
import { getProxyPort } from "../db/index.ts";

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

    if (p.authType === "apikey") {
      await runApiKeyFlow(p);
    } else {
      const adapter = getAdapter(providerId);
      if (!adapter) {
        console.log(`\n  ${chalk.red("Ã¢Å“â€“")}  No OAuth adapter registered for ${providerId}\n`);
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
    console.error(`\n  ${chalk.red("Ã¢Å“â€“")}  ${e?.message ?? String(err)}\n`);
    process.exit(1);
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Provider picker Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

async function pickProvider(): Promise<string | null> {
  const all = Object.values(PROVIDERS).filter(p => !isProviderLocked(p));

  const freeOAuth = all.filter(p => p.authType === "oauth" && providerHasFreeModelsById(p.id));
  const paidOAuth = all.filter(p => p.authType === "oauth" && !providerHasFreeModelsById(p.id));
  const apiKey    = all.filter(p => p.authType === "apikey");

  const row = (p: Provider) => {
    const tag = providerHasFreeModelsById(p.id) ? chalk.green(" FREE") : "";
    return {
      name: `${p.name.padEnd(18)} ${chalk.gray(p.authType)}${tag}`,
      value: p.id,
      description: p.description,
    };
  };

  const choices: Array<Separator | { name: string; value: string; description?: string }> = [];
  if (freeOAuth.length) { choices.push(new Separator(chalk.green("Ã¢â€â‚¬Ã¢â€â‚¬ OAuth Ã¢â‚¬â€ FREE Ã¢â€â‚¬Ã¢â€â‚¬"))); choices.push(...freeOAuth.map(row)); }
  if (paidOAuth.length) { choices.push(new Separator(chalk.cyan("Ã¢â€â‚¬Ã¢â€â‚¬ OAuth Ã¢â‚¬â€ subscription Ã¢â€â‚¬Ã¢â€â‚¬"))); choices.push(...paidOAuth.map(row)); }
  if (apiKey.length)    { choices.push(new Separator(chalk.yellow("Ã¢â€â‚¬Ã¢â€â‚¬ API Key Ã¢â€â‚¬Ã¢â€â‚¬"))); choices.push(...apiKey.map(row)); }

  return await select<string>({
    message: "Which provider do you want to add?",
    choices,
    pageSize: 20,
  });
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Device-code flow Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

async function runDeviceFlow(providerId: string): Promise<void> {
  const p = getProvider(providerId)!;
  const spinner = ora(`Requesting device code from ${p.name}Ã¢â‚¬Â¦`).start();

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
  const pollSpinner = ora("Waiting for authorizationÃ¢â‚¬Â¦").start();

  const intervalMs = Math.max(2, started.interval ?? 5) * 1000;
  const deadline = Date.now() + started.expires_in * 1000;

  while (Date.now() < deadline) {
    await Bun.sleep(intervalMs);
    pollSpinner.text = chalk.gray(`Waiting for authorizationÃ¢â‚¬Â¦ ${chalk.yellow(remaining(deadline))}`);

    const res = await pollDeviceFlow(started.session_id);
    if (res.status === "complete") {
      pollSpinner.succeed(chalk.green("Authorization successful!"));
      printSavedAccount(res.connection, p);
      return;
    }
    if (res.status === "denied") { pollSpinner.fail("Access denied in the browser."); return; }
    if (res.status === "expired") { pollSpinner.fail("Device code expired."); return; }
    if (res.status === "error")   { pollSpinner.fail(res.message); return; }
    // pending Ã¢â€ â€™ keep polling
  }
  pollSpinner.fail("Timed out waiting for authorization.");
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Authorization-code flow Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

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

  // Spin up ephemeral listener - wrap in try/finally to guarantee cleanup
  let listener;
  try {
    listener = startCallbackListener({
      port: adapter.fixedPort ?? 0,
      path: adapter.callbackPath ?? "/callback",
      redirectHost: adapter.callbackHost,
    });
  } catch (err) {
    // Port already in use - provide helpful error
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("port") && adapter.fixedPort) {
      throw new Error(
        `Port ${adapter.fixedPort} is already in use. ` +
        `Another OAuth session may be in progress. ` +
        `Try: killing any process on port ${adapter.fixedPort} or wait a few minutes.`
      );
    }
    throw err;
  }

  try {
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
      if (capture.error) { spinner.fail(`Authorization denied: ${capture.error}`); return; }
      if (!capture.code || !capture.state) { spinner.fail("Missing code or state in callback"); return; }

      spinner.text = "Exchanging code for tokens…";
      const connection = await completeAuthCodeFlow(started.session_id, capture.code, capture.state);
      spinner.succeed(chalk.green("Authorization successful!"));
      printSavedAccount(connection, p);
    } catch (err) {
      spinner.fail(err instanceof Error ? err.message : String(err));
    }
  } finally {
    // ALWAYS close the listener, even if startAuthCodeFlow or any other step throws
    listener.close();
  }
}
async function runImportFlow(providerId: string, p: Provider): Promise<void> {
  console.log(chalk.gray(`\n  Paste the access token from ${p.name}.`));
  if (p.id === "cursor") {
    console.log(chalk.gray("  Find it in Cursor IDE Ã¢â€ â€™ Settings Ã¢â€ â€™ General Ã¢â€ â€™ Access Token."));
  }
  if (p.id === "opencode") {
    console.log(chalk.gray("  OpenCode is a public shared pool Ã¢â‚¬â€ press Enter to continue."));
  }
  console.log("");

  const token = p.id === "opencode"
    ? "activate"
    : await editor({
        message: "Token",
        default: "",
        waitForUserInput: false,
      }).catch(() => "");

  if (!token.trim()) { console.log(chalk.yellow("  Empty token Ã¢â‚¬â€ aborting.\n")); return; }

  const spinner = ora(`Importing ${p.name} tokenÃ¢â‚¬Â¦`).start();
  try {
    const connection = await orchestratorImport(providerId, token.trim());
    spinner.succeed(chalk.green("Token imported"));
    printSavedAccount(connection, p);
  } catch (err) {
    spinner.fail(err instanceof Error ? err.message : String(err));
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ API-key flow Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

async function runApiKeyFlow(p: Provider): Promise<void> {
  console.log("");
  let providerToSave = p;
  
  if (p.id === "custom") {
    const customName = await input({
      message: "Provider Name (e.g. My Remote API)",
      validate: (v) => !!v.trim() || "Name is required",
    });
    const customUrl = await input({
      message: "API URL (e.g. https://api.example.com/v1)",
      validate: (v) => !!v.trim() || "URL is required",
    });
    
    const safeId = "custom_" + crypto.randomUUID().slice(0, 8) + "_" + customName.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    providerToSave = {
      id: safeId,
      name: customName,
      description: "Custom provider",
      category: "apikey",
      authType: "apikey",
      color: "#94a3b8",
      baseUrl: customUrl,
      models: [{ id: "default", name: "Default" }]
    };
    
    saveCustomProvider(providerToSave);
  }

  if (providerToSave.apiKeyUrl) console.log(chalk.gray(`  Get a key at: ${chalk.underline(providerToSave.apiKeyUrl)}`));
  if (providerHasFreeModelsById(providerToSave.id) && providerToSave.freeTier?.notice) {
    console.log(chalk.green(`  ${providerToSave.freeTier.notice}`));
  }
  console.log("");

  const apiKey = await password({
    message: `${providerToSave.name} API key`,
    mask: "Ã¢â‚¬Â¢",
    validate: (v) => v.trim() ? true : "API key is required",
  });

  const displayName = await input({
    message: "Display name (optional)",
    default: "",
  });

  const spinner = ora("Saving connection...").start();
  try {
    const connection = addApiKeyConnection({
      provider: providerToSave.id,
      api_key: apiKey.trim(),
      display_name: displayName.trim() || null,
    });
    spinner.succeed(chalk.green("API key saved"));

    // Notify the running daemon to start the provider server on-the-fly.
    // Fire-and-forget: if the daemon isn't running this is a no-op.
    const daemonPort = getProxyPort();
    fetch(`http://localhost:${daemonPort}/api/providers/${providerToSave.id}/wake`, { method: "POST" }).catch(() => {});

    printSavedAccount(connection, providerToSave);
  } catch (err) {
    spinner.fail(err instanceof Error ? err.message : String(err));
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function remaining(deadline: number): string {
  const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function printSavedAccount(connection: { id: string; email: string | null; priority: number }, p: Provider): void {
  const label = connection.email ?? connection.id.slice(0, 8);
  console.log("");
  console.log(`  ${chalk.green("Ã¢Å“â€œ")}  ${p.name} connection saved  ${chalk.gray(`${label} Ã‚Â· priority ${connection.priority}`)}`);
  console.log(`  ${chalk.gray("next:")}  ${chalk.cyan("grouter up openclaude")}  ${chalk.gray("to wire up your tool")}`);
}

