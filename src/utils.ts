/**
 * Shared utility functions used across multiple modules.
 * Extracted to avoid code duplication (DRY principle).
 */

/**
 * Safely parse a JSON string stored in `provider_data` column.
 * Returns null on invalid/missing input instead of throwing.
 */
export function parseProviderData(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { return null; }
}

/**
 * Decode and parse a JWT payload (middle segment) without verifying signature.
 * Used to extract account IDs and claims from access/id tokens.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  const payload = parts[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Map `process.platform` to a human-readable OS name.
 * Used by Stainless headers and Codex user-agent strings.
 */
export function mapPlatformOs(): string {
  if (process.platform === "darwin") return "MacOS";
  if (process.platform === "win32") return "Windows";
  return "Linux";
}
