import { db } from "./index.ts";

// ── Write ─────────────────────────────────────────────────────────────────────

export function recordUsage(data: {
  account_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}): void {
  db().query(
    `INSERT INTO usage_logs (account_id, model, prompt_tokens, completion_tokens, total_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    data.account_id,
    data.model,
    data.prompt_tokens,
    data.completion_tokens,
    data.total_tokens,
    new Date().toISOString(),
  );
}

// ── Read ──────────────────────────────────────────────────────────────────────

export interface UsageTotals {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface UsageByModel extends UsageTotals {
  model: string;
}

export interface UsageByAccount extends UsageTotals {
  account_id: string;
}

export function getUsageTotals(): UsageTotals {
  return (
    db()
      .query<UsageTotals, []>(
        `SELECT
           COUNT(*)                       AS requests,
           COALESCE(SUM(prompt_tokens),     0) AS prompt_tokens,
           COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
           COALESCE(SUM(total_tokens),      0) AS total_tokens
         FROM usage_logs`,
      )
      .get() ?? { requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  );
}

export function getUsageByModel(): UsageByModel[] {
  return db()
    .query<UsageByModel, []>(
      `SELECT
         model,
         COUNT(*)                       AS requests,
         COALESCE(SUM(prompt_tokens),     0) AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
         COALESCE(SUM(total_tokens),      0) AS total_tokens
       FROM usage_logs
       GROUP BY model
       ORDER BY total_tokens DESC`,
    )
    .all();
}

export function getUsageByAccount(): UsageByAccount[] {
  return db()
    .query<UsageByAccount, []>(
      `SELECT
         account_id,
         COUNT(*)                       AS requests,
         COALESCE(SUM(prompt_tokens),     0) AS prompt_tokens,
         COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
         COALESCE(SUM(total_tokens),      0) AS total_tokens
       FROM usage_logs
       GROUP BY account_id
       ORDER BY total_tokens DESC`,
    )
    .all();
}
