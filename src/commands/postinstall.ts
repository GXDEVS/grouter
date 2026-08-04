import chalk from "chalk";
import { isRunning } from "../daemon/index.ts";

export function postinstallCommand(): void {
  const isDocker = process.env.GROUTER_IN_DOCKER === "1";

  console.log("");
  console.log(chalk.bold.cyan("  grouter-auth") + chalk.gray(" installed successfully"));
  console.log(chalk.gray("  " + "─".repeat(45)));
  console.log("");

  if (isRunning()) {
    console.log(chalk.green("  ●") + " Proxy already running → " + chalk.bold.white("http://localhost:3099/dashboard"));
    console.log("");
    return;
  }

  if (isDocker) {
    console.log(chalk.green("  ●") + " " + chalk.bold("Running in Docker") + " — auto-start handled by container");
    console.log(chalk.gray("    Dashboard: ") + chalk.white("http://localhost:3099/dashboard"));
    console.log("");
    return;
  }

  console.log(chalk.bold("  Quick start:"));
  console.log("");
  console.log("    " + chalk.cyan("grouter serve on") + chalk.gray("      Start proxy in background"));
  console.log("    " + chalk.cyan("grouter add") + chalk.gray("           Add a provider connection"));
  console.log("    " + chalk.cyan("grouter setup") + chalk.gray("         Interactive wizard"));
  console.log("");
  console.log(chalk.gray("  Dashboard: ") + chalk.bold.white("http://localhost:3099/dashboard"));
  console.log(chalk.gray("  Configure providers, monitor usage, and manage settings"));
  console.log(chalk.gray("  directly from your browser — no terminal needed."));
  console.log("");
  console.log(chalk.gray("  " + "─".repeat(45)));
  console.log(chalk.gray("  Endpoint: ") + chalk.white("http://localhost:3099/v1/chat/completions"));
  console.log(chalk.gray("  Docs:     ") + chalk.white("https://github.com/GXDEVS/grouter"));
  console.log("");
}
