import { buildCorsHeaders } from "../cors.ts";

export function cors(): Record<string, string> {
  return buildCorsHeaders("Content-Type, Authorization");
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: cors() });
}
