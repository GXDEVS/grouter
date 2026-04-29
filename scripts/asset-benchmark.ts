#!/usr/bin/env bun

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";

const root = join(import.meta.dir, "..");
const logoDir = join(root, "src", "public", "logos");
const logosEmbeddedTs = join(root, "src", "web", "logos-embedded.ts");
const animationJs = join(root, "src", "public", "animation.js");
const animationEmbeddedTs = join(root, "src", "public", "animation-embedded.ts");
const distBin = join(root, "dist", "grouter");

const logoFiles = readdirSync(logoDir).filter((f) => f.endsWith(".png"));
let logosRaw = 0;
let logosBrotli = 0;
for (const file of logoFiles) {
  const raw = Buffer.from(await Bun.file(join(logoDir, file)).arrayBuffer());
  const br = brotliCompressSync(raw, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC,
    },
  });
  logosRaw += raw.length;
  logosBrotli += br.length;
}

const animRawBytes = Buffer.from(await Bun.file(animationJs).arrayBuffer());
const animGzipBytes = gzipSync(animRawBytes, { level: 9 });

const row = {
  logos_count: logoFiles.length,
  logos_raw_bytes: logosRaw,
  logos_brotli_bytes: logosBrotli,
  logos_embedded_ts_bytes: statSync(logosEmbeddedTs).size,
  animation_raw_bytes: animRawBytes.length,
  animation_gzip_bytes: animGzipBytes.length,
  animation_embedded_ts_bytes: statSync(animationEmbeddedTs).size,
  dist_grouter_bytes: statSync(distBin).size,
};

console.log(JSON.stringify(row, null, 2));
