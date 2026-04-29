import chalk from "chalk";
import { estimateCostUSD } from "../constants.ts";
import { listAccounts } from "../db/accounts.ts";
import { getProxyPort, getStickyLimit, getStrategy } from "../db/index.ts";
import { getUsageByAccount, getUsageByModel, getUsageTotals } from "../db/usage.ts";
import { isRunning, readPid } from "../daemon/index.ts";
import { formatDuration } from "../rotator/fallback.ts";
import { getActiveModelLocks } from "../rotator/lock.ts";

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd < 0.001) return chalk.gray("< $0.001");
  if (usd < 1) return chalk.yellow(`$${usd.toFixed(4)}`);
  return chalk.yellow(`$${usd.toFixed(2)}`);
}

function bar(n: number, total: number, width = 14): string {
  if (total === 0) return chalk.gray("-".repeat(width));
  const filled = Math.round((n / total) * width);
  return chalk.cyan("#".repeat(filled)) + chalk.gray("-".repeat(width - filled));
}

export function statusCommand(): void {
  const accounts = listAccounts();
  const totals = getUsageTotals();
  const byModel = getUsageByModel();
  const byAccount = getUsageByAccount();
  const strategy = getStrategy();
  const running = isRunning();
  const pid = readPid();
  const port = getProxyPort();

  const totalCost = byModel.reduce(
    (sum, modelUsage) => sum + estimateCostUSD(modelUsage.model, modelUsage.prompt_tokens, modelUsage.completion_tokens),
    0,
  );

  console.log("");

  console.log(`  ${chalk.bold("Proxy")}`);
  if (running) {
    console.log(`    ${chalk.green("[UP]")} running  ${chalk.gray(`PID ${pid}`)}  ${chalk.gray("->")}  ${chalk.white(`http://localhost:${port}`)}`);
  } else {
    console.log(`    ${chalk.dim("[--]")} stopped  ${chalk.gray(`run ${chalk.cyan("grouter serve on")}`)}`);
  }
  const stickySuffix = strategy === "round-robin" ? chalk.gray(` - sticky x${getStickyLimit()}`) : "";
  console.log(`    ${chalk.gray("strategy")}   ${chalk.cyan(strategy)}${stickySuffix}`);
  console.log("");

  const accountsWithStatus = accounts.map((account) => {
    const locks = getActiveModelLocks(account.id);
    const effective =
      account.test_status === "unavailable" && locks.length === 0 ? "active" : account.test_status;
    return { ...account, effective, locks };
  });

  console.log(`  ${chalk.bold("Accounts")}  ${chalk.gray(`(${accounts.length} total)`)}`);
  for (const account of accountsWithStatus) {
    const label = account.email ?? account.id.slice(0, 8);
    const usageRow = byAccount.find((row) => row.account_id === account.id);
    const tokenInfo = usageRow ? chalk.gray(` ${fmtNum(usageRow.total_tokens)}t - ${usageRow.requests}req`) : "";

    const statusTag =
      !account.is_active
        ? chalk.gray("[OFF]")
        : account.effective === "active"
          ? chalk.green("[OK ]")
          : account.effective === "unavailable"
            ? chalk.red("[ERR]")
            : chalk.yellow("[???]");

    const lockInfo = account.locks.length > 0
      ? chalk.yellow(` [locked: ${account.locks.map((lock) => (lock.model === "__all" ? "ALL" : lock.model)).join(", ")}]`)
      : "";

    const statusHint =
      account.effective === "unavailable"
        ? chalk.red(" [rate limited]")
        : account.effective === "unknown"
          ? chalk.gray(" [not tested yet]")
          : "";

    console.log(`    ${statusTag} ${chalk.cyan(label)}${tokenInfo}${lockInfo}${statusHint}`);
  }
  console.log("");

  console.log(`  ${chalk.bold("Usage totals")}`);
  console.log("");
  console.log(`    ${chalk.gray("requests")}     ${chalk.white(String(totals.requests).padStart(8))}`);
  console.log(`    ${chalk.gray("input tok")}    ${chalk.white(fmtNum(totals.prompt_tokens).padStart(8))}  ${chalk.gray(`(${totals.prompt_tokens.toLocaleString("en")})`)}`);
  console.log(`    ${chalk.gray("output tok")}   ${chalk.white(fmtNum(totals.completion_tokens).padStart(8))}  ${chalk.gray(`(${totals.completion_tokens.toLocaleString("en")})`)}`);
  console.log(`    ${chalk.gray("total tok")}    ${chalk.white(fmtNum(totals.total_tokens).padStart(8))}  ${chalk.gray(`(${totals.total_tokens.toLocaleString("en")})`)}`);
  console.log(`    ${chalk.gray("est. cost")}    ${fmtCost(totalCost).padStart(8)}  ${chalk.gray("(equivalent API pricing, OAuth is free)")}`);
  console.log("");

  if (byModel.length > 0) {
    console.log(`  ${chalk.bold("By model")}`);
    console.log("");
    for (const modelUsage of byModel) {
      const modelCost = estimateCostUSD(modelUsage.model, modelUsage.prompt_tokens, modelUsage.completion_tokens);
      const modelPct = totals.total_tokens > 0
        ? Math.round((modelUsage.total_tokens / totals.total_tokens) * 100)
        : 0;
      console.log(`    ${chalk.cyan(modelUsage.model)}`);
      console.log(
        `      ${bar(modelUsage.total_tokens, totals.total_tokens)}  ${chalk.white(fmtNum(modelUsage.total_tokens))}t  ${chalk.gray(`${modelPct}%`)}  ${chalk.gray(`${modelUsage.requests}req`)}  ${fmtCost(modelCost)}`,
      );
      console.log(
        `      ${chalk.gray(`in ${fmtNum(modelUsage.prompt_tokens)}`)}  ${chalk.gray("/")}  ${chalk.gray(`out ${fmtNum(modelUsage.completion_tokens)}`)}`,
      );
    }
    console.log("");
  }

  const allLocks = accounts.flatMap((account) =>
    getActiveModelLocks(account.id).map((lock) => ({ account, lock })),
  );
  if (allLocks.length > 0) {
    console.log(`  ${chalk.bold.yellow("Rate-limit locks")}`);
    for (const { account, lock } of allLocks) {
      const label = account.email ?? account.id.slice(0, 8);
      const model = lock.model === "__all" ? "ALL models" : lock.model;
      const eta = formatDuration(new Date(lock.until).getTime() - Date.now());
      console.log(`    ${chalk.cyan(label)}  ${chalk.gray("-")}  ${model}  ${chalk.yellow(`resets in ${eta}`)}`);
    }
    console.log("");
  }
}
