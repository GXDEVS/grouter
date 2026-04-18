import chalk from "chalk";
import ora from "ora";
import { listAccounts, getAccountById, updateAccount } from "../db/accounts.ts";
import { checkAndRefreshAccount } from "../token/refresh.ts";
import { buildQwenHeaders, buildQwenUrl, QWEN_SYSTEM_MSG } from "../constants.ts";
import type { QwenAccount } from "../types.ts";

export async function testCommand(id?: string): Promise<void> {
  let accounts: QwenAccount[];
  if (id) {
    const acc = getAccountById(id);
    if (!acc) { console.error(chalk.red(`\nAccount not found: ${id}\n`)); process.exit(1); }
    accounts = [acc];
  } else {
    accounts = listAccounts();
  }
  if (accounts.length === 0) { console.log(chalk.gray("\nNo accounts to test.\n")); return; }

  console.log("");
  for (const acc of accounts) {
    const label = acc.email ?? acc.id.slice(0, 8);
    const spinner = ora(`Testing ${chalk.cyan(label)}...`).start();
    try {
      const refreshed = await checkAndRefreshAccount(acc);
      const start = Date.now();
      const resp = await fetch(buildQwenUrl(refreshed.resource_url), {
        method: "POST",
        headers: buildQwenHeaders(refreshed.access_token, false),
        body: JSON.stringify({ model: "qwen3-coder-flash", messages: [QWEN_SYSTEM_MSG, { role: "user", content: "Hi" }], max_tokens: 5, stream: false }),
        signal: AbortSignal.timeout(15_000),
      });
      const latency = Date.now() - start;
      if (resp.ok) {
        updateAccount(acc.id, { test_status: "active", last_error: null, error_code: null });
        spinner.succeed(`${chalk.cyan(label)} ${chalk.green("OK")} ${chalk.gray(`(${latency}ms)`)}`);
      } else {
        const errText = await resp.text();
        updateAccount(acc.id, { test_status: "unavailable", last_error: errText.slice(0, 300), error_code: resp.status, last_error_at: new Date().toISOString() });
        spinner.fail(`${chalk.cyan(label)} ${chalk.red(`FAIL ${resp.status}`)} ${chalk.gray(errText.slice(0, 60))}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateAccount(acc.id, { test_status: "unavailable", last_error: msg.slice(0, 300), error_code: 0, last_error_at: new Date().toISOString() });
      spinner.fail(`${chalk.cyan(label)} ${chalk.red("ERROR")} ${chalk.gray(msg.slice(0, 60))}`);
    }
  }
  console.log("");
}
