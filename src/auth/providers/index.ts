import type { OAuthAdapter } from "../types.ts";
import { qwenAdapter } from "./qwen.ts";
import { githubAdapter } from "./github.ts";
import { kimiAdapter } from "./kimi.ts";
import { kilocodeAdapter } from "./kilocode.ts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { gitlabAdapter } from "./gitlab.ts";
import { kiroAdapter } from "./kiro.ts";
import { iflowAdapter } from "./iflow.ts";
import { qoderAdapter } from "./qoder.ts";
import { clineAdapter } from "./cline.ts";
import { cursorAdapter } from "./cursor.ts";
import { opencodeAdapter } from "./opencode.ts";
import { geminiCliAdapter } from "./gemini-cli.ts";

const ADAPTERS: Record<string, OAuthAdapter> = {
  [qwenAdapter.id]: qwenAdapter,
  [githubAdapter.id]: githubAdapter,
  [kimiAdapter.id]: kimiAdapter,
  [kilocodeAdapter.id]: kilocodeAdapter,
  [claudeAdapter.id]: claudeAdapter,
  [codexAdapter.id]: codexAdapter,
  [gitlabAdapter.id]: gitlabAdapter,
  [kiroAdapter.id]: kiroAdapter,
  [iflowAdapter.id]: iflowAdapter,
  [qoderAdapter.id]: qoderAdapter,
  [clineAdapter.id]: clineAdapter,
  [cursorAdapter.id]: cursorAdapter,
  [opencodeAdapter.id]: opencodeAdapter,
  [geminiCliAdapter.id]: geminiCliAdapter,
};

export function getAdapter(providerId: string): OAuthAdapter | null {
  return ADAPTERS[providerId] ?? null;
}

export function registerAdapter(a: OAuthAdapter): void {
  ADAPTERS[a.id] = a;
}

export function listAdapters(): OAuthAdapter[] {
  return Object.values(ADAPTERS);
}
