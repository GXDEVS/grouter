#!/usr/bin/env bun

import { mkdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { OFFICIAL_LOGO_SOURCES } from "../src/providers/logo-sources.ts";

const OUT_DIR = join(import.meta.dir, "..", "src", "public", "logos");

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

async function downloadOne(providerId: string, url: string): Promise<"saved" | "skipped" | "failed"> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) {
      console.error(`x ${providerId}: HTTP ${resp.status} ${resp.statusText}`);
      return "failed";
    }

    const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("image/png")) {
      console.warn(`! ${providerId}: skipped (content-type ${contentType || "unknown"})`);
      return "skipped";
    }

    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.byteLength < 1024) {
      console.warn(`! ${providerId}: skipped (file too small)`);
      return "skipped";
    }

    const outPath = join(OUT_DIR, `${providerId}.png`);
    await Bun.write(outPath, bytes);
    console.log(`✓ ${providerId}: ${basename(outPath)} (${Math.round(bytes.byteLength / 1024)} KB)`);
    return "saved";
  } catch (err) {
    console.error(`x ${providerId}: ${(err as Error).message}`);
    return "failed";
  }
}

let saved = 0;
let skipped = 0;
let failed = 0;

for (const entry of OFFICIAL_LOGO_SOURCES) {
  const result = await downloadOne(entry.providerId, entry.pngUrl);
  if (result === "saved") saved += 1;
  else if (result === "skipped") skipped += 1;
  else failed += 1;
}

console.log("");
console.log(`done: saved=${saved} skipped=${skipped} failed=${failed}`);
if (failed > 0) process.exit(1);
