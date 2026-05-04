import { CURRENT_VERSION, isNewer } from "../update/checker.ts";
import { getSetting, setSetting } from "../db/index.ts";
import { json } from "./api-http.ts";
// @ts-ignore - text import bundles the file into the binary
import EMBEDDED_CHANGELOG from "../../CHANGELOG.md" with { type: "text" };

const CHANGELOG_RAW_URL =
  "https://raw.githubusercontent.com/GXDEVS/grouter/main/CHANGELOG.md";
const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;
const EMBEDDED = (EMBEDDED_CHANGELOG as unknown as string) || "";

interface ChangelogEntry {
  version: string;
  date: string | null;
  body: string;
  isNewer: boolean;
}

interface ChangelogPayload {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  source: string;
  fetchedAt: number | null;
  stale: boolean;
  entries: ChangelogEntry[];
  raw: string;
}

async function fetchRawChangelog(): Promise<string | null> {
  try {
    const res = await fetch(CHANGELOG_RAW_URL, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Section heading: "## [5.5.0] - 2026-04-29" or "## [5.5.0]" (date optional).
const VERSION_HEADING_RE = /^##\s+\[([^\]]+)\](?:\s*[-–]\s*([0-9]{4}-[0-9]{2}-[0-9]{2}))?\s*$/m;

function parseEntries(markdown: string, current: string): ChangelogEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];
  let currentEntry: { version: string; date: string | null; lines: string[] } | null = null;

  for (const line of lines) {
    const match = VERSION_HEADING_RE.exec(line);
    if (match) {
      if (currentEntry) {
        entries.push({
          version: currentEntry.version,
          date: currentEntry.date,
          body: currentEntry.lines.join("\n").trim(),
          isNewer: isNewer(currentEntry.version, current),
        });
      }
      currentEntry = {
        version: match[1] ?? "",
        date: match[2] ?? null,
        lines: [],
      };
      continue;
    }
    if (currentEntry) {
      // Stop if we hit reference-link footer like "[5.5.0]: https://..."
      if (/^\[[^\]]+\]:\s+\S+/.test(line)) break;
      currentEntry.lines.push(line);
    }
  }

  if (currentEntry) {
    entries.push({
      version: currentEntry.version,
      date: currentEntry.date,
      body: currentEntry.lines.join("\n").trim(),
      isNewer: isNewer(currentEntry.version, current),
    });
  }

  return entries;
}

export async function handleChangelog(): Promise<Response> {
  const cached = getSetting("changelog_cache");
  const cachedAtRaw = getSetting("changelog_cache_at");
  const cachedAt = cachedAtRaw ? parseInt(cachedAtRaw, 10) : 0;
  const isFresh = cached && Date.now() - cachedAt < CACHE_TTL_MS;

  let raw: string | null = isFresh ? cached : null;
  let stale = false;
  let fetchedAt: number | null = isFresh ? cachedAt : null;

  if (!raw) {
    raw = await fetchRawChangelog();
    if (raw) {
      setSetting("changelog_cache", raw);
      setSetting("changelog_cache_at", String(Date.now()));
      fetchedAt = Date.now();
    } else if (cached) {
      raw = cached;
      stale = true;
      fetchedAt = cachedAt || null;
    } else if (EMBEDDED) {
      raw = EMBEDDED;
      stale = true;
      fetchedAt = null;
    }
  }

  if (!raw) {
    const empty: ChangelogPayload = {
      current: CURRENT_VERSION,
      latest: null,
      hasUpdate: false,
      source: CHANGELOG_RAW_URL,
      fetchedAt: null,
      stale: false,
      entries: [],
      raw: "",
    };
    return json(empty);
  }

  const entries = parseEntries(raw, CURRENT_VERSION);
  // Pick the most recent *released* version for update comparison — skip
  // "Unreleased" or any non-semver heading so it doesn't break isNewer().
  const latest = entries.find(e => /^\d/.test(e.version))?.version ?? null;

  const payload: ChangelogPayload = {
    current: CURRENT_VERSION,
    latest,
    hasUpdate: latest ? isNewer(latest, CURRENT_VERSION) : false,
    source: CHANGELOG_RAW_URL,
    fetchedAt,
    stale,
    entries,
    raw,
  };
  return json(payload);
}
