#!/usr/bin/env bun
/**
 * fetch-logos.ts — Fetch high-quality provider logos
 *
 * Strategy:
 * 1. Try simpleicons CDN first (clean SVGs, transparent)
 * 2. Fall back to provider favicons
 * 3. Process with sharp: resize to 256x256, ensure transparent background
 * 4. Output clean square PNGs to src/public/logos/
 *
 * Usage: bun run scripts/fetch-logos.ts [--force]
 */

import sharp from "sharp";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(import.meta.dir, "..", "src", "public", "logos");
const FORCE = process.argv.includes("--force");
const SIZE = 256;

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

interface LogoSource {
  id: string;
  name: string;
  urls: string[];
}

const LOGOS: LogoSource[] = [
  // --- simpleicons CDN (verified working, transparent SVGs) ---
  // IDs MUST match the filenames expected by src/providers/registry.ts
  { id: "claude-code-antrophic", name: "Claude", urls: ["https://cdn.simpleicons.org/anthropic"] },
  { id: "qwen-code", name: "Qwen", urls: ["https://cdn.simpleicons.org/qwen"] },
  { id: "github-copilot", name: "GitHub Copilot", urls: ["https://cdn.simpleicons.org/github"] },
  { id: "Gemini-CLI", name: "Gemini CLI", urls: ["https://cdn.simpleicons.org/google", "https://www.gstatic.com/images/branding/product/1x/gemini_48dp.png"] },
  { id: "cursor", name: "Cursor", urls: ["https://cdn.simpleicons.org/cursor"] },
  { id: "Cline", name: "Cline", urls: ["https://cdn.simpleicons.org/cline", "https://avatars.githubusercontent.com/u/221424008?s=200&v=4"] },
  { id: "openrouter", name: "OpenRouter", urls: ["https://cdn.simpleicons.org/openrouter"] },
  { id: "Deepseek", name: "DeepSeek", urls: ["https://cdn.simpleicons.org/deepseek"] },
  { id: "huggingface", name: "Hugging Face", urls: ["https://cdn.simpleicons.org/huggingface"] },
  { id: "modal", name: "Modal", urls: ["https://cdn.simpleicons.org/modal"] },
  { id: "ollama-cloud", name: "Ollama Cloud", urls: ["https://cdn.simpleicons.org/ollama"] },
  { id: "nvidia-nim", name: "NVIDIA NIM", urls: ["https://cdn.simpleicons.org/nvidia"] },
  { id: "Gitlab", name: "GitLab Duo", urls: ["https://cdn.simpleicons.org/gitlab"] },
  { id: "chatgpt", name: "OpenAI", urls: ["https://cdn.simpleicons.org/openai"] },
  { id: "codex", name: "OpenAI Codex", urls: ["https://cdn.simpleicons.org/openai"] },

  // --- Provider apple-touch-icon PNGs (sharp can't decode .ico) ---
  { id: "groq", name: "Groq", urls: ["https://groq.com/apple-touch-icon.png"] },
  { id: "mistral", name: "Mistral", urls: ["https://mistral.ai/apple-touch-icon.png"] },
  { id: "Kiro", name: "Kiro", urls: ["https://kiro.dev/apple-touch-icon.png"] },
  { id: "kimi-ai", name: "Kimi", urls: ["https://www.kimi.com/apple-touch-icon.png"] },
  { id: "kilo-code", name: "KiloCode", urls: ["https://kilo.ai/apple-touch-icon.png"] },

  // --- Existing good logos (skip if >1KB) ---
  { id: "opencode", name: "OpenCode", urls: ["https://cdn.simpleicons.org/opencode"] },
  { id: "iflow", name: "iFlow", urls: ["https://cdn.simpleicons.org/iflow"] },
  { id: "qoder", name: "Qoder", urls: ["https://cdn.simpleicons.org/qoder"] },
  { id: "cerebras", name: "Cerebras", urls: ["https://cdn.simpleicons.org/cerebras"] },
  { id: "together", name: "Together AI", urls: ["https://cdn.simpleicons.org/together"] },
  { id: "tokenrouter", name: "TokenRouter", urls: ["https://www.tokenrouter.com/apple-touch-icon.png"] },
];

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; grouter-logos/1.0)" },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

async function processToPng(input: Buffer, url: string): Promise<Buffer | null> {
  try {
    const image = sharp(input);
    const meta = await image.metadata();
    const isSvg = meta.format === "svg" || url.endsWith(".svg") || url.includes("simpleicons");

    let pipeline: ReturnType<typeof sharp>;

    if (isSvg) {
      pipeline = sharp(input, { density: 300 })
        .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
    } else {
      const { width = 0, height = 0 } = meta;
      const isNonSquare = Math.abs(width - height) > Math.max(width, height) * 0.15;

      if (isNonSquare) {
        const cropSize = Math.min(width, height);
        const left = Math.floor((width - cropSize) / 2);
        const top = Math.floor((height - cropSize) / 2);
        pipeline = sharp(input)
          .extract({ left, top, width: cropSize, height: cropSize })
          .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
      } else {
        pipeline = sharp(input)
          .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
      }
    }

    return await pipeline.png({ quality: 95, compressionLevel: 9 }).toBuffer();
  } catch (err) {
    console.error(`  sharp: ${(err as Error).message}`);
    return null;
  }
}

let saved = 0, skipped = 0, failed = 0;

for (const logo of LOGOS) {
  const outPath = join(OUT_DIR, `${logo.id}.png`);

  if (!FORCE && existsSync(outPath)) {
    const stat = await Bun.file(outPath).size;
    if (stat > 500) {
      console.log(`• ${logo.name}: skip (${Math.round(stat / 1024)} KB)`);
      skipped++;
      continue;
    }
  }

  process.stdout.write(`↓ ${logo.name}...`);

  let raw: Buffer | null = null;
  let usedUrl = "";

  for (const url of logo.urls) {
    raw = await fetchWithTimeout(url);
    if (raw) { usedUrl = url; break; }
  }

  if (!raw) { console.log(` ✗ all failed`); failed++; continue; }

  const png = await processToPng(raw, usedUrl);
  if (!png) { console.log(` ✗ convert failed`); failed++; continue; }

  await Bun.write(outPath, png);
  console.log(` ✓ ${logo.id}.png (${Math.round(png.byteLength / 1024)} KB)`);
  saved++;
}

console.log(`\ndone: saved=${saved} skipped=${skipped} failed=${failed}`);
if (failed > 0) process.exit(1);
