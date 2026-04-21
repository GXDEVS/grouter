import { brotliDecompressSync } from "node:zlib";
import { LOGO_INDEX, LOGO_PACK_B64 } from "./logos-embedded.ts";

const LOGO_PACK_BYTES = Buffer.from(LOGO_PACK_B64, "base64");
const LOGO_CACHE = new Map<string, Uint8Array>();

function hasMatchingEtag(req: Request | undefined, etag: string): boolean {
  if (!req) return false;
  const ifNoneMatch = req.headers.get("if-none-match");
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((part) => part.trim())
    .some((candidate) => candidate === etag || candidate === "*");
}

function getLogoBytes(filename: string): Uint8Array | null {
  const cached = LOGO_CACHE.get(filename);
  if (cached) return cached;

  const meta = LOGO_INDEX[filename];
  if (!meta) return null;

  const start = meta.offset;
  const end = meta.offset + meta.compressedLength;
  const compressedSlice = LOGO_PACK_BYTES.subarray(start, end);
  const decompressed = Uint8Array.from(brotliDecompressSync(compressedSlice));
  if (decompressed.length !== meta.rawLength) return null;

  LOGO_CACHE.set(filename, decompressed);
  return decompressed;
}

export function serveLogo(filename: string, req?: Request): Response {
  const meta = LOGO_INDEX[filename];
  const bytes = getLogoBytes(filename);
  if (!meta || !bytes) return new Response("Not found", { status: 404 });

  const etag = `"${meta.sha1}"`;
  const headers: Record<string, string> = {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400",
    ETag: etag,
  };

  if (hasMatchingEtag(req, etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(bytes, { headers });
}
