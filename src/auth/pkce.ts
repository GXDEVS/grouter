import crypto from "node:crypto";

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function parseIdTokenEmail(idToken: string): string | null {
  try {
    const parts = idToken.split(".");
    const part = parts[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf-8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
