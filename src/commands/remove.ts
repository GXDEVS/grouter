import chalk from "chalk";
import { getAccountById, getAccountByEmail, removeAccount } from "../db/accounts.ts";

export async function removeCommand(idOrEmail: string): Promise<void> {
  const account = getAccountById(idOrEmail) ?? getAccountByEmail(idOrEmail);
  if (!account) { console.error(chalk.red(`\nAccount not found: ${idOrEmail}\n`)); process.exit(1); }

  const label = account.email ?? account.id.slice(0, 8);
  console.log(`\nRemoving: ${chalk.cyan(label)} (ID: ${account.id.slice(0, 8)}...)`);
  process.stdout.write("Confirm removal? [y/N] ");

  const answer = await new Promise<string>((resolve) => {
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (chunk) => resolve(chunk.toString()));
  });

  if (answer.trim().toLowerCase() !== "y") { console.log(chalk.gray("Cancelled.\n")); return; }
  removeAccount(account.id);
  console.log(chalk.green(`\nAccount removed: ${label}\n`));
}
