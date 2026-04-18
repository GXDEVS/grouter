import { LOGO_B64 } from "./logos-embedded.ts";

// Decode once per file — keep binary copies alive for the daemon's lifetime.
const LOGO_BYTES: Record<string, Uint8Array> = {};
for (const [name, b64] of Object.entries(LOGO_B64)) {
  LOGO_BYTES[name] = Uint8Array.from(Buffer.from(b64, "base64"));
}

export function serveLogo(filename: string): Response {
  const bytes = LOGO_BYTES[filename];
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
