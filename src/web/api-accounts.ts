import { listAccounts, removeAccount, updateAccount } from "../db/accounts.ts";
import type { AccountPatch } from "../db/accounts.ts";
import { getProxyPoolById } from "../db/pools.ts";
import { errorResponse, handleApiError, json, readJson } from "./api-http.ts";

export function handleAccountToggle(id: string): Response {
  const accounts = listAccounts();
  const account = accounts.find((item) => item.id === id);
  if (!account) return errorResponse(404, "Account not found");

  const newActive = account.is_active === 1 ? 0 : 1;
  updateAccount(id, { is_active: newActive });
  return json({ ok: true, is_active: newActive });
}

export function handleAccountRemove(id: string): Response {
  const ok = removeAccount(id);
  return ok ? json({ ok: true }) : errorResponse(404, "Account not found");
}

export async function handleUpdateConnection(id: string, req: Request): Promise<Response> {
  try {
    const accounts = listAccounts();
    const account = accounts.find((item) => item.id === id);
    if (!account) return json({ error: "Connection not found" }, 404);

    const body = await readJson<Record<string, unknown>>(req, {});
    const unknownFields = Object.keys(body).filter((key) => key !== "proxy_pool_id");
    if (unknownFields.length > 0) {
      return errorResponse(400, `Unknown field(s): ${unknownFields.join(", ")}`);
    }
    if (!("proxy_pool_id" in body)) {
      return errorResponse(400, "proxy_pool_id is required");
    }

    const poolId = body.proxy_pool_id;
    if (poolId !== null && typeof poolId !== "string") {
      return errorResponse(400, "proxy_pool_id must be a string or null");
    }

    const patch: AccountPatch = {};
    if (poolId === null) {
      patch.proxy_pool_id = null;
    } else {
      const trimmed = poolId.trim();
      if (!trimmed) return errorResponse(400, "proxy_pool_id must not be empty");
      if (!getProxyPoolById(trimmed)) {
        return errorResponse(404, `Proxy pool not found: ${trimmed}`);
      }
      patch.proxy_pool_id = trimmed;
    }

    updateAccount(id, patch);
    return json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
