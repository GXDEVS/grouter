import { estimateCostUSD } from "../constants.ts";
import { getConnectionCountByProvider, listAccounts } from "../db/accounts.ts";
import { db, getProxyPort, getSetting, getStickyLimit, getStrategy, setSetting } from "../db/index.ts";
import { getConnectionCountForPool, listProxyPools } from "../db/pools.ts";
import { listProviderPorts } from "../db/ports.ts";
import { getUsageByAccount, getUsageByModel, getUsageTotals } from "../db/usage.ts";
import { isRunning, readPid, removePid } from "../daemon/index.ts";
import { PROVIDERS } from "../providers/registry.ts";
import { clearModelLocks, getActiveModelLocks } from "../rotator/lock.ts";
import { errorResponse, handleApiError, json, readJson } from "./api-http.ts";

export function handleStatus(): Response {
  const accounts = listAccounts();
  const totals = getUsageTotals();
  const byModel = getUsageByModel();
  const byAccount = getUsageByAccount();
  const running = isRunning();
  const pid = readPid();
  const port = getProxyPort();
  const strategy = getStrategy();
  const stickyLimit = getStickyLimit();

  const totalCost = byModel.reduce(
    (sum, modelUsage) => sum + estimateCostUSD(modelUsage.model, modelUsage.prompt_tokens, modelUsage.completion_tokens),
    0,
  );

  const accountsWithUsage = accounts.map((account) => {
    const usage = byAccount.find((entry) => entry.account_id === account.id);
    const hasActiveLock = getActiveModelLocks(account.id).length > 0;
    const effectiveStatus =
      account.test_status === "unavailable" && !hasActiveLock ? "active" : account.test_status;
    return { ...account, effective_status: effectiveStatus, usage: usage ?? null };
  });

  const effectiveActive = accountsWithUsage.filter((item) => item.is_active === 1 && item.effective_status === "active").length;
  const effectiveUnavailable = accountsWithUsage.filter((item) => item.effective_status === "unavailable").length;
  const effectiveUnknown = accountsWithUsage.filter((item) => item.effective_status === "unknown").length;

  const providerCounts = getConnectionCountByProvider();
  const portMap = Object.fromEntries(listProviderPorts().map((row) => [row.provider, row.port]));
  const providerSummary = Object.entries(PROVIDERS)
    .map(([id, provider]) => ({
      id,
      name: provider.name,
      color: provider.color,
      logo: provider.logo ?? null,
      authType: provider.authType,
      deprecated: provider.deprecated ?? false,
      underConstruction: provider.underConstruction ?? false,
      connections: providerCounts[id] ?? 0,
      port: portMap[id] ?? null,
    }))
    .filter((provider) => provider.connections > 0);

  const proxyPools = listProxyPools().map((pool) => ({
    ...pool,
    connections: getConnectionCountForPool(pool.id),
  }));

  return json({
    proxy: { running, pid, port, strategy, stickyLimit },
    accounts: {
      list: accountsWithUsage,
      total: accounts.length,
      active: effectiveActive,
      unavailable: effectiveUnavailable,
      unknown: effectiveUnknown,
    },
    usage: { totals, byModel, totalCost },
    providers: providerSummary,
    proxyPools,
  });
}

export function handleSetupStatus(): Response {
  const done = getSetting("setup_done") === "1";
  return json({ done });
}

export function handleSetupDone(): Response {
  setSetting("setup_done", "1");
  return json({ ok: true });
}

export function handleGetConfig(): Response {
  const requireClientAuth = getSetting("require_client_auth") ?? "false";
  return json({
    strategy: getStrategy(),
    stickyLimit: getStickyLimit(),
    port: getProxyPort(),
    require_client_auth: requireClientAuth,
  });
}

export async function handleSetConfig(req: Request): Promise<Response> {
  try {
    const body = await readJson<{
      strategy?: string;
      stickyLimit?: number;
      port?: number;
      require_client_auth?: string | boolean;
    }>(req);

    if (body.strategy !== undefined) {
      if (body.strategy !== "fill-first" && body.strategy !== "round-robin") {
        return errorResponse(400, "strategy must be fill-first or round-robin");
      }
      setSetting("strategy", body.strategy);
    }

    if (body.stickyLimit !== undefined) {
      const value = Number(body.stickyLimit);
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        return errorResponse(400, "stickyLimit must be an integer 1-100");
      }
      setSetting("sticky_limit", String(value));
    }

    if (body.port !== undefined) {
      const value = Number(body.port);
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        return errorResponse(400, "port must be 1-65535");
      }
      setSetting("proxy_port", String(value));
    }

    if (body.require_client_auth !== undefined) {
      const normalized =
        body.require_client_auth === true || body.require_client_auth === "true"
          ? "true"
          : body.require_client_auth === false || body.require_client_auth === "false"
            ? "false"
            : null;
      if (!normalized) {
        return errorResponse(400, "require_client_auth must be true or false");
      }
      setSetting("require_client_auth", normalized);
    }

    return json({
      ok: true,
      strategy: getStrategy(),
      stickyLimit: getStickyLimit(),
      port: getProxyPort(),
      require_client_auth: getSetting("require_client_auth") ?? "false",
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export function handleProxyStop(): Response {
  setTimeout(() => {
    try {
      removePid();
    } catch {
      // ignore PID cleanup errors
    }
    process.exit(0);
  }, 300);
  return json({ ok: true });
}

export function handleUnlockAll(): Response {
  clearModelLocks();
  db().exec("UPDATE accounts SET backoff_level = 0, test_status = 'unknown', last_error = NULL, error_code = NULL, last_error_at = NULL");
  return json({ ok: true });
}
