import chalk from "chalk";
import { listAccounts, getAccountById, updateAccount } from "../db/accounts.ts";
import { clearModelLocks } from "../rotator/lock.ts";

export function unlockCommand(id?: string): void {
  if (id) {
    const account = getAccountById(id);
    if (!account) { console.error(chalk.red(`\nAccount not found: ${id}\n`)); process.exit(1); }
    clearModelLocks(account.id);
    updateAccount(account.id, { backoff_level: 0, test_status: "unknown", last_error: null, error_code: null });
    const label = account.email ?? account.id.slice(0, 8);
    console.log(chalk.green(`\nAll model locks cleared for ${chalk.cyan(label)}\n`));
  } else {
    const accounts = listAccounts();
    if (accounts.length === 0) { console.log(chalk.gray("\nNo accounts found.\n")); return; }
    clearModelLocks();
    for (const acc of accounts) {
      updateAccount(acc.id, { backoff_level: 0, test_status: "unknown", last_error: null, error_code: null });
    }
    console.log(chalk.green(`\nAll model locks cleared for ${accounts.length} account(s)\n`));
  }
}
