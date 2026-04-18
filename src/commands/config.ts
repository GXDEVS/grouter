import chalk from "chalk";
import { getSetting, setSetting, getStrategy, getStickyLimit, getProxyPort } from "../db/index.ts";

export function configCommand(options: { strategy?: "fill-first" | "round-robin"; port?: number; stickyLimit?: number }): void {
  if (!options.strategy && options.port === undefined && options.stickyLimit === undefined) {
    console.log("");
    console.log(chalk.bold("  grouter config"));
    console.log("");
    console.log(`  strategy:     ${chalk.cyan(getStrategy())}`);
    console.log(`  proxy port:   ${chalk.cyan(String(getProxyPort()))}`);
    console.log(`  sticky limit: ${chalk.cyan(String(getStickyLimit()))}`);
    console.log(chalk.gray(`\n  db: ~/.grouter/grouter.db`));
    console.log("");
    return;
  }

  if (options.strategy) { setSetting("strategy", options.strategy); console.log(chalk.green(`  strategy set to: ${options.strategy}`)); }
  if (options.port !== undefined) { setSetting("proxy_port", String(options.port)); console.log(chalk.green(`  proxy port set to: ${options.port}`)); }
  if (options.stickyLimit !== undefined) { setSetting("sticky_limit", String(options.stickyLimit)); console.log(chalk.green(`  sticky limit set to: ${options.stickyLimit}`)); }
  console.log("");
}
