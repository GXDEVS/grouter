import chalk from "chalk";
import { listAccounts } from "../db/accounts.ts";
import { getAccountById } from "../db/accounts.ts";
import { getStrategy, getStickyLimit, getProxyPort } from "../db/index.ts";
import { getActiveModelLocks } from "../rotator/lock.ts";
import { formatDuration } from "../rotator/fallback.ts";
import { getUsageTotals, getUsageByModel, getUsageByAccount } from "../db/usage.ts";
import { estimateCostUSD } from "../constants.ts";
import { isRunning, readPid } from "../daemon/index.ts";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd < 0.001) return chalk.gray("< $0.001");
  if (usd < 1)     return chalk.yellow(`$${usd.toFixed(4)}`);
  return chalk.yellow(`$${usd.toFixed(2)}`);
}

function bar(n: number, total: number, width = 14): string {
  if (total === 0) return chalk.gray("·".repeat(width));
  const filled = Math.round((n / total) * width);
  return chalk.cyan("█".repeat(filled)) + chalk.gray("░".repeat(width - filled));
}

const SEP = chalk.gray("  " + "─".repeat(53));

// ── Command ───────────────────────────────────────────────────────────────────

export function statusCommand(): void {
  const accounts  = listAccounts();
  const totals    = getUsageTotals();
  const byModel   = getUsageByModel();
  const byAccount = getUsageByAccount();
  const strategy  = getStrategy();
  const running   = isRunning();
  const pid       = readPid();
  const port      = getProxyPort();

  // Compute total estimated cost across all models
  const totalCost = byModel.reduce(
    (sum, m) => sum + estimateCostUSD(m.model, m.prompt_tokens, m.completion_tokens),
    0,
  );

  console.log("");

  // ── Proxy ────────────────────────────────────────────────────────────────
  console.log(`  ${chalk.bold("Proxy")}`);
  if (running) {
    console.log(`    ${chalk.green("●")} running  ${chalk.gray(`PID ${pid}`)}  ${chalk.gray("→")}  ${chalk.white(`http://localhost:${port}`)}`);
  } else {
    console.log(`    ${chalk.dim("○")} stopped  ${chalk.gray(`run ${chalk.cyan("grouter serve on")}`)}`);
  }
  console.log(`    ${chalk.gray("strategy")}   ${chalk.cyan(strategy)}${strategy === "round-robin" ? chalk.gray(` · sticky ×${getStickyLimit()}`) : ""}`);
  console.log("");

  // ── Accounts ──────────────────────────────────────────────────────────────
  // Derive effective status: if "unavailable" but the lock already expired, treat as active
  const accountsWithStatus = accounts.map((acc) => {
    const locks = getActiveModelLocks(acc.id);
    const effective =
      acc.test_status === "unavailable" && locks.length === 0 ? "active" : acc.test_status;
    return { ...acc, effective, locks };
  });

  const active      = accountsWithStatus.filter((a) => a.is_active && a.effective === "active").length;
  const unavailable = accountsWithStatus.filter((a) => a.effective === "unavailable").length;
  const unknown     = accountsWithStatus.filter((a) => a.effective === "unknown" || a.effective === "").length;

  console.log(`  ${chalk.bold("Accounts")}  ${chalk.gray(`(${accounts.length} total)`)}`);
  for (const acc of accountsWithStatus) {
    const label   = acc.email ?? acc.id.slice(0, 8);
    const locks   = acc.locks;
    const statusDot =
      !acc.is_active             ? chalk.gray("○") :
      acc.effective === "active" ? chalk.green("●") :
      acc.effective === "unavailable" ? chalk.red("●") :
      chalk.yellow("●");
    const lockStr = locks.length > 0
      ? chalk.yellow(` [locked: ${locks.map((l) => l.model === "__all" ? "ALL" : l.model).join(", ")}]`)
      : "";
    const usageRow = byAccount.find((r) => r.account_id === acc.id);
    const tokStr   = usageRow ? chalk.gray(` ${fmtNum(usageRow.total_tokens)}t · ${usageRow.requests}req`) : "";
    const statusHint =
      acc.effective === "unavailable" ? chalk.red(" [rate limited]") :
      acc.effective === "unknown"     ? chalk.gray(" [not tested yet]") :
      "";
    console.log(`    ${statusDot}  ${chalk.cyan(label)}${tokStr}${lockStr}${statusHint}`);
  }
  console.log("");

  // ── Usage totals ──────────────────────────────────────────────────────────
  console.log(`  ${chalk.bold("Usage totals")}`);
  console.log("");
  console.log(
    `    ${chalk.gray("requests")}     ${chalk.white(String(totals.requests).padStart(8))}`,
  );
  console.log(
    `    ${chalk.gray("input tok")}    ${chalk.white(fmtNum(totals.prompt_tokens).padStart(8))}  ${chalk.gray(`(${totals.prompt_tokens.toLocaleString("en")})`)}`,
  );
  console.log(
    `    ${chalk.gray("output tok")}   ${chalk.white(fmtNum(totals.completion_tokens).padStart(8))}  ${chalk.gray(`(${totals.completion_tokens.toLocaleString("en")})`)}`,
  );
  console.log(
    `    ${chalk.gray("total tok")}    ${chalk.white(fmtNum(totals.total_tokens).padStart(8))}  ${chalk.gray(`(${totals.total_tokens.toLocaleString("en")})`)}`,
  );
  console.log(
    `    ${chalk.gray("est. cost")}    ${fmtCost(totalCost).padStart(8)}  ${chalk.gray("(equivalent API pricing, OAuth is free)")}`,
  );
  console.log("");

  // ── Per model breakdown ───────────────────────────────────────────────────
  if (byModel.length > 0) {
    console.log(`  ${chalk.bold("By model")}`);
    console.log("");
    for (const m of byModel) {
      const cost     = estimateCostUSD(m.model, m.prompt_tokens, m.completion_tokens);
      const modelPct = totals.total_tokens > 0
        ? Math.round((m.total_tokens / totals.total_tokens) * 100)
        : 0;
      console.log(`    ${chalk.cyan(m.model)}`);
      console.log(
        `      ${bar(m.total_tokens, totals.total_tokens)}  ${chalk.white(fmtNum(m.total_tokens))}t  ${chalk.gray(`${modelPct}%`)}  ${chalk.gray(`${m.requests}req`)}  ${fmtCost(cost)}`,
      );
      console.log(
        `      ${chalk.gray(`in ${fmtNum(m.prompt_tokens)}`)}  ${chalk.gray("/")}  ${chalk.gray(`out ${fmtNum(m.completion_tokens)}`)}`,
      );
    }
    console.log("");
  }

  // ── Active locks ──────────────────────────────────────────────────────────
  const allLocks = accounts.flatMap((a) =>
    getActiveModelLocks(a.id).map((l) => ({ acc: a, lock: l })),
  );
  if (allLocks.length > 0) {
    console.log(`  ${chalk.bold.yellow("Rate-limit locks")}`);
    for (const { acc, lock } of allLocks) {
      const label = acc.email ?? acc.id.slice(0, 8);
      const model = lock.model === "__all" ? "ALL models" : lock.model;
      const eta   = formatDuration(new Date(lock.until).getTime() - Date.now());
      console.log(`    ${chalk.cyan(label)}  ${chalk.gray("·")}  ${model}  ${chalk.yellow(`resets in ${eta}`)}`);
    }
    console.log("");
  }
}
