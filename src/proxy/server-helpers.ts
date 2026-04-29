import chalk from "chalk";
import { buildCorsHeaders } from "../cors.ts";

// Bun route params are not in the standard Request type.
export interface BunRequest extends Request {
  params: Record<string, string>;
}

export const MAX_RETRIES = 3;
export const SERVER_IDLE_TIMEOUT_SECONDS = 240;
export const DISABLED_PROVIDER_IDS = new Set<string>();

export function logReq(
  method: string,
  path: string,
  status: number,
  ms: number,
  meta?: { model?: string | null; account?: string; rotated?: number; tokens?: number },
): void {
  const time = chalk.gray(new Date().toLocaleTimeString("pt-BR", { hour12: false }));
  const sc = status < 300 ? chalk.green : status < 400 ? chalk.cyan : status < 500 ? chalk.yellow : chalk.red;
  const lat = ms < 1000 ? chalk.gray(`${ms}ms`) : chalk.yellow(`${(ms / 1000).toFixed(1)}s`);
  let extras = "";
  if (meta?.model) extras += chalk.magenta(` ${meta.model}`);
  if (meta?.account) extras += chalk.gray(` -> ${meta.account}`);
  if (meta?.rotated && meta.rotated > 0) extras += chalk.yellow(` x${meta.rotated}`);
  if (meta?.tokens) extras += chalk.gray(` [${meta.tokens}t]`);
  console.log(`  ${time} ${chalk.bold(method.padEnd(4))} ${path}${extras} ${sc(String(status))} ${lat}`);
}

export function parseProviderModel(raw: string | null, pinnedProvider?: string): { provider: string | null; model: string } {
  if (pinnedProvider) {
    if (!raw) return { provider: pinnedProvider, model: "" };
    const slash = raw.indexOf("/");
    // On provider-pinned ports, keep model IDs exactly as provided because
    // many providers use namespaced models (e.g. "Qwen/Qwen3-...").
    // Only strip when the prefix matches the pinned provider itself.
    if (slash === -1) return { provider: pinnedProvider, model: raw };
    const maybeProvider = raw.slice(0, slash).toLowerCase();
    if (maybeProvider === pinnedProvider.toLowerCase()) {
      return { provider: pinnedProvider, model: raw.slice(slash + 1) };
    }
    return { provider: pinnedProvider, model: raw };
  }
  // Without a pinned provider the format "provider/model" is required.
  if (!raw) return { provider: null, model: "" };
  const slash = raw.indexOf("/");
  if (slash === -1) return { provider: null, model: raw };
  return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
}

export function corsHeaders(): Record<string, string> {
  return buildCorsHeaders("Content-Type, Authorization");
}

export function jsonResponse(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return Response.json(data, { status, headers: { ...corsHeaders(), ...extra } });
}
