import { buildCorsHeaders } from "../cors.ts";
import { ApiError, isApiError } from "./api-errors.ts";

export function cors(): Record<string, string> {
  return buildCorsHeaders("Content-Type, Authorization");
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: cors() });
}

export function errorResponse(status: number, message: string): Response {
  return json({ error: message }, status);
}

export async function readJson<T>(req: Request, fallback?: T): Promise<T> {
  try {
    return await req.json() as T;
  } catch {
    if (fallback !== undefined) return fallback;
    throw new ApiError(400, "Invalid JSON body", "invalid_json_body");
  }
}

export function handleApiError(err: unknown): Response {
  if (isApiError(err)) {
    const payload: Record<string, unknown> = { error: err.message };
    if (err.code) payload.code = err.code;
    if (err.extra) Object.assign(payload, err.extra);
    return json(payload, err.status);
  }

  const message = err instanceof Error ? err.message : String(err);
  return errorResponse(500, message || "Internal server error");
}
