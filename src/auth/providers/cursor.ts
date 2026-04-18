import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

// Cursor stores its tokens in a local SQLite database (state.vscdb).
// The web-side "import" flow accepts a pasted JWT access token directly.
// The user copies it from the Cursor IDE (Settings → General → Access Token)
// or extracts it from the local DB.
//
// Accepted input shapes:
// 1. Raw JWT access token (starts with "ey")
// 2. JSON blob: { accessToken, machineId?, email? }
// 3. "accessToken\nmachineId" (two lines)

function parseEmailFromJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payloadPart = parts[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf-8"));
    return (payload.email as string | undefined) ?? (payload.sub as string | undefined) ?? null;
  } catch { return null; }
}

function parseExpiryFromJwt(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return Date.now() + 30 * 24 * 60 * 60 * 1000;
    const payloadPart = parts[1];
    if (!payloadPart) return Date.now() + 30 * 24 * 60 * 60 * 1000;
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf-8"));
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch { /* ignore */ }
  return Date.now() + 30 * 24 * 60 * 60 * 1000;
}

export const cursorAdapter: OAuthAdapter = {
  id: "cursor",
  flow: "import_token",

  async importToken(rawInput) {
    const input = rawInput.trim();
    if (!input) throw new Error("Empty input");

    let accessToken = "";
    let machineId: string | null = null;
    let email: string | null = null;

    // Try JSON first
    if (input.startsWith("{")) {
      try {
        const o = JSON.parse(input) as Record<string, unknown>;
        accessToken = (o.accessToken as string | undefined) ?? (o.access_token as string | undefined) ?? "";
        machineId = (o.machineId as string | undefined) ?? (o.serviceMachineId as string | undefined) ?? null;
        email = (o.email as string | undefined) ?? null;
      } catch {
        throw new Error("Input looked like JSON but failed to parse");
      }
    } else if (input.includes("\n")) {
      const [a, b] = input.split("\n").map(s => s.trim());
      accessToken = a ?? "";
      machineId = b ?? null;
    } else {
      accessToken = input;
    }

    if (!accessToken || !accessToken.startsWith("ey")) {
      throw new Error("accessToken must be a JWT (starts with 'ey'). Paste the full token.");
    }

    if (!email) email = parseEmailFromJwt(accessToken);
    const expiresAt = new Date(parseExpiryFromJwt(accessToken)).toISOString();

    const normalized: NormalizedTokens = {
      accessToken,
      refreshToken: null,
      expiresAt,
      email,
      displayName: email,
      providerData: { machineId, authMethod: "imported" },
    };
    return normalized;
  },

  // Cursor has no public refresh endpoint. When the imported token expires,
  // the user has to re-paste. checkAndRefreshAccount returns null → no refresh.
};
