// Usage Analytics - Database Queries

import { db } from './index';

export interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
}

export interface DailyUsage {
  date: string;
  requests: number;
  tokens: number;
  cost: number;
}

export interface ProviderBreakdown {
  provider: string;
  requests: number;
  tokens: number;
  cost: number;
  percentage: number;
}

export interface ModelBreakdown {
  model: string;
  provider: string;
  requests: number;
  tokens: number;
  cost: number;
}

export function getUsageSummary(days: number): UsageSummary {
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  const result = db.query(`
    SELECT 
      COUNT(*) as totalRequests,
      COALESCE(SUM(prompt_tokens + completion_tokens), 0) as totalTokens,
      COALESCE(SUM(cost), 0) as totalCost,
      COALESCE(SUM(prompt_tokens), 0) as promptTokens,
      COALESCE(SUM(completion_tokens), 0) as completionTokens
    FROM usage_logs
    WHERE created_at >= ?
  `).get(since.toISOString()) as any;
  
  return {
    totalRequests: result?.totalRequests || 0,
    totalTokens: result?.totalTokens || 0,
    totalCost: result?.totalCost || 0,
    promptTokens: result?.promptTokens || 0,
    completionTokens: result?.completionTokens || 0,
  };
}

export function getDailyUsage(days: number): DailyUsage[] {
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  const results = db.query(`
    SELECT 
      DATE(created_at) as date,
      COUNT(*) as requests,
      COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens,
      COALESCE(SUM(cost), 0) as cost
    FROM usage_logs
    WHERE created_at >= ?
    GROUP BY DATE(created_at)
    ORDER BY date DESC
  `).all(since.toISOString()) as any[];
  
  return results.map(r => ({
    date: r.date,
    requests: r.requests,
    tokens: r.tokens,
    cost: r.cost,
  }));
}

export function getProviderBreakdown(days: number): ProviderBreakdown[] {
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  const totalResult = db.query(`
    SELECT COALESCE(SUM(cost), 0) as total
    FROM usage_logs
    WHERE created_at >= ?
  `).get(since.toISOString()) as any;
  
  const totalCost = totalResult?.total || 0;
  
  const results = db.query(`
    SELECT 
      provider,
      COUNT(*) as requests,
      COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens,
      COALESCE(SUM(cost), 0) as cost
    FROM usage_logs
    WHERE created_at >= ?
    GROUP BY provider
    ORDER BY cost DESC
  `).all(since.toISOString()) as any[];
  
  return results.map(r => ({
    provider: r.provider,
    requests: r.requests,
    tokens: r.tokens,
    cost: r.cost,
    percentage: totalCost > 0 ? Math.round((r.cost / totalCost) * 100) : 0,
  }));
}

export function getModelBreakdown(days: number): ModelBreakdown[] {
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  const results = db.query(`
    SELECT 
      model,
      provider,
      COUNT(*) as requests,
      COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens,
      COALESCE(SUM(cost), 0) as cost
    FROM usage_logs
    WHERE created_at >= ?
    GROUP BY model, provider
    ORDER BY cost DESC
    LIMIT 10
  `).all(since.toISOString()) as any[];
  
  return results.map(r => ({
    model: r.model,
    provider: r.provider,
    requests: r.requests,
    tokens: r.tokens,
    cost: r.cost,
  }));
}
