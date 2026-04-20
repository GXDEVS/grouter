import { db } from "../db/index.ts";

const ALL_MODELS = "__all";

export function isModelLockActive(accountId: string, model: string | null): boolean {
  const now = new Date().toISOString();
  const key = model ?? ALL_MODELS;
  const lock = db()
    .query<{ id: number }, [string, string, string, string]>(
      `SELECT id FROM model_locks WHERE account_id = ? AND (model = ? OR model = ?) AND locked_until > ? LIMIT 1`
    )
    .get(accountId, key, ALL_MODELS, now);
  return !!lock;
}

export function setModelLock(accountId: string, model: string | null, cooldownMs: number): void {
  const key = model ?? ALL_MODELS;
  const until = new Date(Date.now() + cooldownMs).toISOString();

  const existing = db()
    .query<{ id: number }, [string, string]>(
      "SELECT id FROM model_locks WHERE account_id = ? AND model = ?"
    )
    .get(accountId, key);

  if (existing) {
    db().query<void, [string, number]>(
      "UPDATE model_locks SET locked_until = ? WHERE id = ?"
    ).run(until, existing.id);
  } else {
    db().query<void, [string, string, string]>(
      "INSERT INTO model_locks (account_id, model, locked_until) VALUES (?, ?, ?)"
    ).run(accountId, key, until);
  }
}

export function clearModelLocks(accountId?: string): void {
  if (accountId) {
    db().query<void, [string]>("DELETE FROM model_locks WHERE account_id = ?").run(accountId);
  } else {
    db().exec("DELETE FROM model_locks");
  }
}

export function clearModelLock(accountId: string, model: string | null): void {
  const key = model ?? ALL_MODELS;
  db().query<void, [string, string]>(
    "DELETE FROM model_locks WHERE account_id = ? AND model = ?"
  ).run(accountId, key);
}

export function getActiveModelLocks(accountId: string): Array<{ model: string; until: string }> {
  const now = new Date().toISOString();
  return db()
    .query<{ model: string; until: string }, [string, string]>(
      "SELECT model, locked_until as until FROM model_locks WHERE account_id = ? AND locked_until > ?"
    )
    .all(accountId, now);
}

export function getEarliestLockUntil(model: string | null): string | null {
  const now = new Date().toISOString();
  const key = model ?? ALL_MODELS;
  const row = db()
    .query<{ until: string | null }, [string, string, string]>(
      `SELECT MIN(locked_until) as until FROM model_locks WHERE (model = ? OR model = ?) AND locked_until > ?`
    )
    .get(key, ALL_MODELS, now);
  return row?.until ?? null;
}

export function getEarliestLockUntilForAccounts(accountIds: string[], model: string | null): string | null {
  if (!accountIds.length) return null;
  const now = new Date().toISOString();
  const key = model ?? ALL_MODELS;
  const placeholders = accountIds.map(() => "?").join(", ");
  const sql =
    `SELECT MIN(locked_until) as until
     FROM model_locks
     WHERE account_id IN (${placeholders})
       AND (model = ? OR model = ?)
       AND locked_until > ?`;
  const row = db()
    .query<{ until: string | null }, string[]>(sql)
    .get(...accountIds, key, ALL_MODELS, now);
  return row?.until ?? null;
}
