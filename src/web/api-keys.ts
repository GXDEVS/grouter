import {
  createClientKey,
  deleteClientKey,
  getClientKey,
  listClientKeys,
  parseAllowedProviders,
  updateClientKey,
} from "../db/client_keys.ts";
import { errorResponse, handleApiError, json, readJson } from "./api-http.ts";

function normalizeAllowedProvidersInput(raw: unknown): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  const cleaned = raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeExpiresAtInput(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

export function handleListClientKeys(): Response {
  return json({ keys: listClientKeys() });
}

export async function handleCreateClientKey(req: Request): Promise<Response> {
  try {
    const body = await readJson<{
      name?: string;
      allowed_providers?: string[] | null;
      token_limit?: number;
      api_key?: string;
      expires_at?: string | null;
    }>(req);

    const name = body.name?.trim();
    if (!name) return errorResponse(400, "Missing name");

    const allowedProviders = normalizeAllowedProvidersInput(body.allowed_providers);
    if (allowedProviders === undefined) {
      return errorResponse(400, "allowed_providers must be an array of provider ids or null");
    }

    const tokenLimit = Number(body.token_limit ?? 0);
    if (!Number.isInteger(tokenLimit) || tokenLimit < 0) {
      return errorResponse(400, "token_limit must be a non-negative integer");
    }

    const expiresAt = normalizeExpiresAtInput(body.expires_at);
    if (expiresAt === undefined) {
      return errorResponse(400, "expires_at must be a valid ISO date or null");
    }

    const key = body.api_key?.trim() || "grouter-sk-" + crypto.randomUUID().replace(/-/g, "");
    createClientKey({
      name,
      api_key: key,
      allowed_providers: allowedProviders ?? null,
      token_limit: tokenLimit,
      expires_at: expiresAt ?? null,
    });
    return json({ ok: true, key, client_key: getClientKey(key) });
  } catch (err) {
    if (String(err).includes("UNIQUE constraint failed")) {
      return errorResponse(409, "Client key already exists");
    }
    return handleApiError(err);
  }
}

export function handleDeleteClientKey(key: string): Response {
  deleteClientKey(key);
  return json({ ok: true });
}

export async function handleUpdateClientKey(req: Request, key: string): Promise<Response> {
  try {
    const body = await readJson<{
      name?: string;
      allowed_providers?: string[] | null;
      token_limit?: number;
      expires_at?: string | null;
    }>(req);

    const existing = getClientKey(key);
    if (!existing) return errorResponse(404, "Key not found");

    const hasAnyField =
      body.name !== undefined ||
      body.allowed_providers !== undefined ||
      body.token_limit !== undefined ||
      body.expires_at !== undefined;
    if (!hasAnyField) {
      return errorResponse(400, "No fields provided for update");
    }

    const name = body.name !== undefined ? body.name.trim() : existing.name;
    if (!name) return errorResponse(400, "Missing name");

    const allowedProvidersRaw = normalizeAllowedProvidersInput(body.allowed_providers);
    if (body.allowed_providers !== undefined && allowedProvidersRaw === undefined) {
      return errorResponse(400, "allowed_providers must be an array of provider ids or null");
    }
    const allowedProviders =
      body.allowed_providers !== undefined
        ? (allowedProvidersRaw ?? null)
        : (parseAllowedProviders(existing.allowed_providers) ?? null);

    const tokenLimit = body.token_limit !== undefined ? Number(body.token_limit) : existing.token_limit;
    if (!Number.isInteger(tokenLimit) || tokenLimit < 0) {
      return errorResponse(400, "token_limit must be a non-negative integer");
    }

    const expiresAtRaw = normalizeExpiresAtInput(body.expires_at);
    if (body.expires_at !== undefined && expiresAtRaw === undefined) {
      return errorResponse(400, "expires_at must be a valid ISO date or null");
    }
    const expiresAt = body.expires_at !== undefined ? (expiresAtRaw ?? null) : existing.expires_at;

    updateClientKey(key, {
      name,
      allowed_providers: allowedProviders,
      token_limit: tokenLimit,
      expires_at: expiresAt,
    });
    return json({ ok: true, client_key: getClientKey(key) });
  } catch (err) {
    return handleApiError(err);
  }
}
