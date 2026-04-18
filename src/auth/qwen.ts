import open from "open";
import chalk from "chalk";
import ora from "ora";
import { QWEN_CLIENT_ID, QWEN_DEVICE_CODE_URL, QWEN_TOKEN_URL, QWEN_SCOPE } from "../constants.ts";
import { generatePKCE, parseIdTokenEmail } from "./pkce.ts";
import { addAccount } from "../db/accounts.ts";
import type { DeviceCodeResponse, QwenAccount, TokenResponse } from "../types.ts";

const POLL_MAX_ATTEMPTS = 60;

async function requestDeviceCode(codeChallenge: string): Promise<DeviceCodeResponse> {
  const resp = await fetch(QWEN_DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: QWEN_CLIENT_ID,
      scope: QWEN_SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }),
  });
  if (!resp.ok) throw new Error(`Device code request failed (${resp.status}): ${await resp.text()}`);
  return resp.json() as Promise<DeviceCodeResponse>;
}

async function pollForToken(
  deviceCode: string,
  codeVerifier: string,
  intervalSecs: number,
  expiresIn: number,
  onTick?: (secsLeft: number) => void,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: deviceCode,
    client_id: QWEN_CLIENT_ID,
    code_verifier: codeVerifier,
  });
  const deadline = Date.now() + expiresIn * 1000;

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    onTick?.(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    await Bun.sleep(intervalSecs * 1000);
    if (Date.now() >= deadline) throw new Error("Device code expired. Please try again.");

    const resp = await fetch(QWEN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    if (resp.ok) return resp.json() as Promise<TokenResponse>;

    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    const error = data.error as string | undefined;
    if (error === "authorization_pending") continue;
    if (error === "slow_down") { intervalSecs = Math.min(intervalSecs + 5, 30); continue; }
    if (error === "expired_token") throw new Error("Device code expired. Please try again.");
    if (error === "access_denied") throw new Error("Authorization denied by user.");
    throw new Error(`Token poll failed (${resp.status}): ${data.error_description ?? error ?? "unknown"}`);
  }
  throw new Error("Timed out waiting for authorization.");
}

export async function login(): Promise<QwenAccount> {
  const { codeVerifier, codeChallenge } = generatePKCE();

  const spinner = ora("Requesting device code from Qwen...").start();
  let device: DeviceCodeResponse;
  try {
    device = await requestDeviceCode(codeChallenge);
    spinner.succeed("Device code received");
  } catch (err) { spinner.fail("Failed to get device code"); throw err; }

  console.log("");
  console.log(chalk.bold("  Authorize in your browser:"));
  console.log(`  ${chalk.cyan("URL:")}  ${chalk.underline(device.verification_uri_complete ?? device.verification_uri)}`);
  console.log(`  ${chalk.cyan("Code:")} ${chalk.yellow.bold(device.user_code)}`);
  console.log("");

  try { await open(device.verification_uri_complete ?? device.verification_uri); console.log(chalk.gray("  (Browser opened automatically)")); }
  catch { console.log(chalk.gray("  (Open the URL above manually)")); }

  console.log("");
  const pollSpinner = ora("Waiting for authorization...").start();
  const updateSpinner = (secsLeft: number) => {
    const m = Math.floor(secsLeft / 60), s = secsLeft % 60;
    pollSpinner.text = chalk.gray(`Waiting for authorization… ${chalk.yellow(m > 0 ? `${m}m ${s}s` : `${s}s`)} remaining`);
  };

  let tokens: TokenResponse;
  try {
    tokens = await pollForToken(device.device_code, codeVerifier, device.interval ?? 5, device.expires_in ?? 300, updateSpinner);
    pollSpinner.succeed(chalk.green("Authorization successful!"));
  } catch (err) { pollSpinner.fail("Authorization failed"); throw err; }

  const email = tokens.id_token ? parseIdTokenEmail(tokens.id_token) : null;
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const saveSpinner = ora("Saving account...").start();
  const account = addAccount({
    email,
    display_name: email,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    resource_url: tokens.resource_url ?? null,
  });
  saveSpinner.succeed(`Account saved: ${chalk.green(account.email ?? account.id.slice(0, 8))} (priority ${account.priority})`);

  return account;
}
