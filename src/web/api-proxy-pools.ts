import {
  createProxyPool,
  deleteProxyPool,
  getConnectionCountForPool,
  getProxyPoolById,
  listProxyPools,
  testProxyPool,
  updateProxyPool,
  type ProxyPoolPatch,
} from "../db/pools.ts";
import { errorResponse, handleApiError, json, readJson } from "./api-http.ts";

export function handleListProxyPools(): Response {
  const pools = listProxyPools().map((pool) => ({
    ...pool,
    connections: getConnectionCountForPool(pool.id),
  }));
  return json({ pools });
}

export async function handleCreateProxyPool(req: Request): Promise<Response> {
  try {
    const body = await readJson<{ name?: string; proxy_url?: string; no_proxy?: string }>(req);
    if (!body.name) return errorResponse(400, "name is required");
    if (!body.proxy_url) return errorResponse(400, "proxy_url is required");
    const pool = createProxyPool({ name: body.name, proxy_url: body.proxy_url, no_proxy: body.no_proxy ?? null });
    return json({ ok: true, pool });
  } catch (err) {
    return handleApiError(err);
  }
}

export function handleDeleteProxyPool(id: string): Response {
  const pool = getProxyPoolById(id);
  if (!pool) return errorResponse(404, "Pool not found");
  const bound = getConnectionCountForPool(id);
  if (bound > 0) return errorResponse(409, `Cannot delete - ${bound} connection(s) still use this pool`);
  deleteProxyPool(id);
  return json({ ok: true });
}

export async function handleUpdateProxyPool(id: string, req: Request): Promise<Response> {
  try {
    const pool = getProxyPoolById(id);
    if (!pool) return errorResponse(404, "Pool not found");

    const body = await readJson<Record<string, unknown>>(req, {});
    const allowed = new Set(["name", "proxy_url", "no_proxy", "is_active"]);
    const unknownFields = Object.keys(body).filter((key) => !allowed.has(key));
    if (unknownFields.length > 0) {
      return errorResponse(400, `Unknown field(s): ${unknownFields.join(", ")}`);
    }

    const patch: ProxyPoolPatch = {};
    if ("name" in body) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return errorResponse(400, "name must be a non-empty string");
      }
      patch.name = body.name.trim();
    }
    if ("proxy_url" in body) {
      if (typeof body.proxy_url !== "string" || !body.proxy_url.trim()) {
        return errorResponse(400, "proxy_url must be a non-empty string");
      }
      patch.proxy_url = body.proxy_url.trim();
    }
    if ("no_proxy" in body) {
      if (body.no_proxy !== null && typeof body.no_proxy !== "string") {
        return errorResponse(400, "no_proxy must be a string or null");
      }
      patch.no_proxy = body.no_proxy === null ? null : body.no_proxy.trim();
    }
    if ("is_active" in body) {
      const value = Number(body.is_active);
      if (!Number.isInteger(value) || (value !== 0 && value !== 1)) {
        return errorResponse(400, "is_active must be 0 or 1");
      }
      patch.is_active = value;
    }

    if (Object.keys(patch).length === 0) {
      return errorResponse(400, "No valid fields provided for update");
    }

    updateProxyPool(id, patch);
    return json({ ok: true, pool: getProxyPoolById(id) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function handleTestProxyPool(id: string): Promise<Response> {
  const pool = getProxyPoolById(id);
  if (!pool) return errorResponse(404, "Pool not found");
  const result = await testProxyPool(pool);
  return json(result);
}
