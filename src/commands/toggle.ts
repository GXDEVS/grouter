import chalk from "chalk";
import { getAccountById, getAccountByEmail, updateAccount } from "../db/accounts.ts";

async function toggleAccount(id: string, enable: boolean): Promise<void> {
  const account = getAccountById(id) ?? getAccountByEmail(id);
  if (!account) { console.error(chalk.red(`\nAccount not found: ${id}\n`)); process.exit(1); }

  const label = account.email ?? account.id.slice(0, 8);
  if (!!account.is_active === enable) {
    console.log(chalk.gray(`\nAccount ${chalk.cyan(label)} is already ${enable ? "enabled" : "disabled"}.\n`));
    return;
  }
  updateAccount(account.id, { is_active: enable ? 1 : 0 });
  console.log(`\nAccount ${chalk.cyan(label)} ${enable ? chalk.green("enabled") : chalk.yellow("disabled")}.\n`);
}

export async function enableCommand(id: string) { await toggleAccount(id, true); }
export async function disableCommand(id: string) { await toggleAccount(id, false); }
