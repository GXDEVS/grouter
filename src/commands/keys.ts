import chalk from "chalk";
import { listClientKeys, createClientKey, deleteClientKey } from "../db/client_keys.ts";

export function keysCommand(action?: string, rawArgs?: string[] | any): void {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  if (action === "ls" || action === "list" || !action) {
    const keys = listClientKeys();
    if (keys.length === 0) {
      console.log(chalk.gray("\nNo Client API Keys found. Add one with: grouter keys add <name>\n"));
      return;
    }
    console.log("");
    console.log(chalk.bold(`  ${"Name".padEnd(25)} ${"API Key".padEnd(36)} ${"Usage".padEnd(15)} ${"Providers"}`));
    console.log(chalk.gray("  " + "─".repeat(95)));

    keys.forEach((k) => {
      const name = k.name.slice(0, 23).padEnd(25);
      const keyStr = k.api_key.padEnd(36);
      const usageStr = `${k.tokens_used}${k.token_limit > 0 ? " / " + k.token_limit : ""}`.padEnd(15);
      let provs = "All";
      if (k.allowed_providers) {
        try {
          const parsed = JSON.parse(k.allowed_providers);
          provs = parsed.join(", ");
        } catch {}
      }
      if (provs.length > 18) provs = provs.slice(0, 15) + "...";
      
      console.log(`  ${chalk.cyan(name)} ${keyStr} ${usageStr} ${chalk.gray(provs)}`);
    });
    console.log("");
  } else if (action === "add") {
    const name = args.join(" ").trim();
    if (!name) {
      console.log(chalk.red("Error: You must provide a name for the key."));
      console.log(chalk.gray("Usage: grouter keys add <name>"));
      return;
    }
    const newKey = "grouter-sk-" + crypto.randomUUID().replace(/-/g, "");
    createClientKey({ name, api_key: newKey });
    console.log(chalk.green(`\n✔ Created new Client API Key "${name}":`));
    console.log(chalk.bold.cyan(`   ${newKey}\n`));
    console.log(chalk.gray("Use the dashboard for advanced configuration (limits, allowed providers)."));
    console.log("");
  } else if (action === "rm" || action === "remove") {
    const key = args[0]?.trim();
    if (!key) {
      console.log(chalk.red("Error: You must provide the exact API Key to remove."));
      console.log(chalk.gray("Usage: grouter keys rm <api_key>"));
      return;
    }
    deleteClientKey(key);
    console.log(chalk.green(`\n✔ Removed Client API Key.`));
    console.log("");
  } else {
    console.log(chalk.red(`Unknown action: ${action}`));
    console.log(chalk.gray(`Valid actions: add, ls, rm`));
  }
}
