import chalk from "chalk";
import { listAccounts } from "../db/accounts.ts";
import { getActiveModelLocks } from "../rotator/lock.ts";

export function listCommand(): void {
  const accounts = listAccounts();
  if (accounts.length === 0) {
    console.log(chalk.gray("\nNo accounts found. Run `grouter add` to add one.\n"));
    return;
  }

  console.log("");
  console.log(chalk.bold(`  ${"#".padEnd(3)} ${"ID".padEnd(10)} ${"Email / Name".padEnd(32)} ${"Status".padEnd(13)} ${"Pri".padEnd(4)} ${"Expires"}`));
  console.log(chalk.gray("  " + "─".repeat(90)));

  accounts.forEach((acc, i) => {
    const id = acc.id.slice(0, 8);
    const email = (acc.email ?? acc.display_name ?? "(no email)").slice(0, 30).padEnd(32);
    const status = !acc.is_active ? chalk.gray("disabled".padEnd(13))
      : acc.test_status === "active" ? chalk.green("active".padEnd(13))
      : acc.test_status === "unavailable" ? chalk.red("unavailable".padEnd(13))
      : chalk.gray("unknown".padEnd(13));
    const exp = formatExpiry(acc.expires_at);

    console.log(`  ${String(i + 1).padEnd(3)} ${chalk.cyan(id.padEnd(10))} ${email} ${status} ${String(acc.priority).padEnd(4)} ${exp}`);

    for (const lock of getActiveModelLocks(acc.id)) {
      const m = lock.model === "__all" ? "ALL models" : lock.model;
      console.log(chalk.yellow(`         ⚠  locked: ${m} until ${formatExpiry(lock.until)}`));
    }
    if (acc.last_error) console.log(chalk.red(`         ✗ last error (${acc.error_code}): ${acc.last_error.slice(0, 60)}`));
  });
  console.log("");
}

function formatExpiry(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return chalk.red("expired");
  if (diff < 60_000) return chalk.yellow(`${Math.ceil(diff / 1000)}s`);
  if (diff < 3_600_000) return chalk.yellow(`${Math.ceil(diff / 60_000)}m`);
  if (diff < 86_400_000) return `${Math.ceil(diff / 3_600_000)}h`;
  return `${Math.ceil(diff / 86_400_000)}d`;
}
