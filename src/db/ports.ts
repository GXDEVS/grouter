import { db, getProxyPort } from "./index.ts";

const PROVIDER_PORT_BASE = 3100;

export interface ProviderPort {
  provider:   string;
  port:       number;
  created_at: string;
}

export function listProviderPorts(): ProviderPort[] {
  return db()
    .query<ProviderPort, []>("SELECT * FROM provider_ports ORDER BY port ASC")
    .all();
}

export function getProviderPort(provider: string): number | null {
  const row = db()
    .query<{ port: number }, [string]>("SELECT port FROM provider_ports WHERE provider = ?")
    .get(provider);
  return row?.port ?? null;
}

/**
 * Allocate the next free port for a provider. Returns existing port if already
 * allocated. Starts from PROVIDER_PORT_BASE (3100) and skips the router port
 * (typically 3099) plus any ports already bound to other providers.
 */
export function allocateProviderPort(provider: string): number {
  const existing = getProviderPort(provider);
  if (existing !== null) return existing;

  const taken = new Set<number>([getProxyPort()]);
  for (const row of db().query<{ port: number }, []>("SELECT port FROM provider_ports").all()) {
    taken.add(row.port);
  }

  let port = PROVIDER_PORT_BASE;
  while (taken.has(port)) port++;

  const now = new Date().toISOString();
  db().query<void, [string, number, string]>(
    "INSERT INTO provider_ports (provider, port, created_at) VALUES (?, ?, ?)"
  ).run(provider, port, now);

  return port;
}

export function releaseProviderPortIfEmpty(provider: string): void {
  const row = db()
    .query<{ n: number }, [string]>("SELECT COUNT(*) as n FROM accounts WHERE provider = ?")
    .get(provider);
  if (!row || row.n === 0) {
    db().query<void, [string]>("DELETE FROM provider_ports WHERE provider = ?").run(provider);
  }
}
