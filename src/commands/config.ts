import chalk from "chalk";
import { setSetting, getStrategy, getStickyLimit, getProxyPort, getSetting } from "../db/index.ts";
import { RTK_CONFIG_DEFAULT } from "../proxy/rtk-types";
import { COST_CONFIG_DEFAULT } from "../proxy/cost-predictor";

export function configCommand(options: {
  strategy?: "fill-first" | "round-robin";
  port?: number;
  stickyLimit?: number;
  rtk?: string;
  rtkAggressiveness?: string;
  costPredictor?: string;
  costThreshold?: number;
  costWarn?: number;
}): void {
  if (!options.strategy && options.port === undefined && options.stickyLimit === undefined &&
      !options.rtk && !options.rtkAggressiveness && !options.costPredictor &&
      options.costThreshold === undefined && options.costWarn === undefined) {
    const rtkEnabled = getSetting("rtk_enabled") ?? "true";
    const rtkAgg = getSetting("rtk_aggressiveness") ?? "balanced";
    const costEnabled = getSetting("cost_predictor_enabled") ?? "true";
    const costThreshold = getSetting("cost_threshold") ?? "0.05";
    const costWarn = getSetting("cost_warn_threshold") ?? "0.10";

    console.log("");
    console.log(chalk.bold("  grouter config"));
    console.log("");
    console.log(`  strategy:           ${chalk.cyan(getStrategy())}`);
    console.log(`  proxy port:         ${chalk.cyan(String(getProxyPort()))}`);
    console.log(`  sticky limit:       ${chalk.cyan(String(getStickyLimit()))}`);
    console.log("");
    console.log(chalk.bold("  RTK Token Saver:"));
    console.log(`    enabled:          ${chalk.cyan(rtkEnabled)}`);
    console.log(`    aggressiveness:   ${chalk.cyan(rtkAgg)}`);
    console.log("");
    console.log(chalk.bold("  Cost Predictor:"));
    console.log(`    enabled:          ${chalk.cyan(costEnabled)}`);
    console.log(`    threshold:        ${chalk.cyan(costThreshold)}`);
    console.log(`    warn threshold:   ${chalk.cyan(costWarn)}`);
    console.log(chalk.gray(`\n  db: ~/.grouter/grouter.db`));
    console.log("");
    return;
  }

  if (options.strategy) { setSetting("strategy", options.strategy); console.log(chalk.green(`  strategy set to: ${options.strategy}`)); }
  if (options.port !== undefined) { setSetting("proxy_port", String(options.port)); console.log(chalk.green(`  proxy port set to: ${options.port}`)); }
  if (options.stickyLimit !== undefined) { setSetting("sticky_limit", String(options.stickyLimit)); console.log(chalk.green(`  sticky limit set to: ${options.stickyLimit}`)); }
  if (options.rtk) { setSetting("rtk_enabled", options.rtk === "on" ? "true" : "false"); console.log(chalk.green(`  rtk enabled set to: ${options.rtk}`)); }
  if (options.rtkAggressiveness) { setSetting("rtk_aggressiveness", options.rtkAggressiveness); console.log(chalk.green(`  rtk aggressiveness set to: ${options.rtkAggressiveness}`)); }
  if (options.costPredictor) { setSetting("cost_predictor_enabled", options.costPredictor === "on" ? "true" : "false"); console.log(chalk.green(`  cost predictor enabled set to: ${options.costPredictor}`)); }
  if (options.costThreshold !== undefined) { setSetting("cost_threshold", String(options.costThreshold)); console.log(chalk.green(`  cost threshold set to: ${options.costThreshold}`)); }
  if (options.costWarn !== undefined) { setSetting("cost_warn_threshold", String(options.costWarn)); console.log(chalk.green(`  cost warn threshold set to: ${options.costWarn}`)); }
  console.log("");
}
