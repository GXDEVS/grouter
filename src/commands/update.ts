import chalk from "chalk";
import ora   from "ora";
import { CURRENT_VERSION, isNewer, fetchAndCacheVersion } from "../update/checker.ts";
import { setSetting } from "../db/index.ts";

export async function updateCommand(): Promise<void> {
  console.log("");
  console.log(`  ${chalk.bold("grouter update")}  ${chalk.gray("checking for updates…")}`);
  console.log("");

  const spinner = ora({ text: "Fetching latest version…", indent: 2 }).start();
  const remote = await fetchAndCacheVersion();

  if (!remote) {
    spinner.fail(chalk.red("Could not reach npm registry"));
    console.log("");
    return;
  }

  const newer = isNewer(remote, CURRENT_VERSION);
  setSetting("update_latest_version", remote);
  setSetting("update_last_check", String(Date.now()));

  if (newer) {
    spinner.succeed(`${chalk.yellow.bold("Update available!")}  ${chalk.gray(CURRENT_VERSION)} → ${chalk.green.bold(remote)}`);
    console.log("");
    console.log(`  ${chalk.dim("To install the new version, run:")}`);
    console.log(`    ${chalk.cyan("bun install -g grouter-auth@latest")}`);
    console.log(`    ${chalk.dim("or with npm:")}`);
    console.log(`    ${chalk.cyan("npm install -g grouter-auth@latest")}`);
  } else {
    spinner.succeed(`${chalk.green("Up to date")}  ${chalk.gray(`v${CURRENT_VERSION}`)}`);
  }

  console.log("");
}
