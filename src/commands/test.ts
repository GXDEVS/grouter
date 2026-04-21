import chalk from "chalk";
import ora from "ora";
import { listAccounts, getAccountById, updateAccount } from "../db/accounts.ts";
import { checkAndRefreshAccount } from "../token/refresh.ts";
import { buildUpstream } from "../proxy/upstream.ts";
import { getModelsForProvider } from "../providers/model-fetcher.ts";
import type { Connection } from "../types.ts";

export async function testCommand(id?: string): Promise<void> {
  let accounts: Connection[];
  if (id) {
    const acc = getAccountById(id);
    if (!acc) {
      console.error(chalk.red(`\nAccount not found: ${id}\n`));
      process.exit(1);
    }
    accounts = [acc];
  } else {
    accounts = listAccounts();
  }

  if (accounts.length === 0) {
    console.log(chalk.gray("\nNo accounts to test.\n"));
    return;
  }

  console.log("");
  for (const acc of accounts) {
    const label = acc.email ?? acc.display_name ?? acc.id.slice(0, 8);
    const spinner = ora(`Testing ${chalk.cyan(label)}...`).start();

    try {
      const providerModels = getModelsForProvider(acc.provider);
      const preferred = providerModels.find((m) => m.is_free) ?? providerModels[0];
      if (!preferred) {
        updateAccount(acc.id, {
          test_status: "unknown",
          last_error: "No model found for provider",
          error_code: null,
          last_error_at: new Date().toISOString(),
        });
        spinner.warn(`${chalk.cyan(label)} ${chalk.yellow("SKIP")} ${chalk.gray("no model list")}`);
        continue;
      }

      const account = acc.auth_type === "oauth"
        ? await checkAndRefreshAccount(acc)
        : acc;

      const dispatch = buildUpstream({
        account,
        stream: false,
        body: {
          model: preferred.id,
          messages: [{ role: "user", content: "Ping" }],
          max_tokens: 8,
          stream: false,
        },
      });

      if (dispatch.kind === "unsupported") {
        updateAccount(acc.id, {
          test_status: "unknown",
          last_error: dispatch.reason,
          error_code: null,
          last_error_at: new Date().toISOString(),
        });
        spinner.warn(`${chalk.cyan(label)} ${chalk.yellow("SKIP")} ${chalk.gray(dispatch.reason.slice(0, 80))}`);
        continue;
      }

      const start = Date.now();
      const resp = await fetch(dispatch.req.url, {
        method: "POST",
        headers: dispatch.req.headers,
        body: JSON.stringify(dispatch.req.body),
        signal: AbortSignal.timeout(15000),
      });
      const latency = Date.now() - start;

      if (resp.ok) {
        updateAccount(acc.id, {
          test_status: "active",
          last_error: null,
          error_code: null,
          last_error_at: null,
        });
        spinner.succeed(`${chalk.cyan(label)} ${chalk.green("OK")} ${chalk.gray(`(${latency}ms, ${acc.provider}/${preferred.id})`)}`);
      } else {
        const errText = (await resp.text()).slice(0, 300);
        updateAccount(acc.id, {
          test_status: "unavailable",
          last_error: errText,
          error_code: resp.status,
          last_error_at: new Date().toISOString(),
        });
        spinner.fail(`${chalk.cyan(label)} ${chalk.red(`FAIL ${resp.status}`)} ${chalk.gray(errText.slice(0, 80))}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateAccount(acc.id, {
        test_status: "unavailable",
        last_error: msg.slice(0, 300),
        error_code: 0,
        last_error_at: new Date().toISOString(),
      });
      spinner.fail(`${chalk.cyan(label)} ${chalk.red("ERROR")} ${chalk.gray(msg.slice(0, 80))}`);
    }
  }
  console.log("");
}
