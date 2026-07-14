// Usage Analytics - CLI Command

import { 
  getUsageSummary, 
  getDailyUsage, 
  getProviderBreakdown,
  getModelBreakdown,
  UsageSummary,
  DailyUsage,
  ProviderBreakdown,
  ModelBreakdown
} from '../db/stats-queries';

export interface StatsOptions {
  period?: 'day' | 'week' | 'month';
  provider?: string;
  model?: string;
  json?: boolean;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(n: number): string {
  if (n < 0.01) return '$0.00';
  return `$${n.toFixed(2)}`;
}

function formatBar(value: number, max: number, width: number = 20): string {
  const filled = Math.round((value / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function formatStatsOutput(
  summary: UsageSummary,
  providers: ProviderBreakdown[],
  daily: DailyUsage[],
  models: ModelBreakdown[]
): string {
  const lines = [
    '',
    '📊 Usage Summary',
    '─'.repeat(50),
    `  Requests:    ${formatNumber(summary.totalRequests)}`,
    `  Tokens:      ${formatTokens(summary.totalTokens)} (prompt: ${formatTokens(summary.promptTokens)}, completion: ${formatTokens(summary.completionTokens)})`,
    `  Cost:        ${formatCost(summary.totalCost)}`,
    '',
  ];

  // Provider breakdown
  if (providers.length > 0) {
    lines.push('📋 Provider Breakdown');
    lines.push('─'.repeat(50));
    const maxCost = Math.max(...providers.map(p => p.cost));
    for (const p of providers.slice(0, 5)) {
      const bar = formatBar(p.cost, maxCost, 15);
      lines.push(`  ${p.provider.padEnd(15)} ${bar} ${formatCost(p.cost)} (${p.percentage}%)`);
    }
    lines.push('');
  }

  // Daily trend
  if (daily.length > 0) {
    lines.push('📅 Daily Trend');
    lines.push('─'.repeat(50));
    const maxTokens = Math.max(...daily.map(d => d.tokens));
    for (const d of daily.slice(0, 7)) {
      const bar = formatBar(d.tokens, maxTokens, 15);
      const day = new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' });
      lines.push(`  ${day} ${bar} ${formatTokens(d.tokens)}`);
    }
    lines.push('');
  }

  // Top models
  if (models.length > 0) {
    lines.push('🏆 Top Models');
    lines.push('─'.repeat(50));
    for (const m of models.slice(0, 5)) {
      lines.push(`  ${m.model.padEnd(25)} ${formatCost(m.cost)} (${m.requests} reqs)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export async function statsCommand(options: StatsOptions): Promise<void> {
  const days = options.period === 'day' ? 1 : options.period === 'month' ? 30 : 7;
  
  const summary = getUsageSummary(days);
  const providers = getProviderBreakdown(days);
  const daily = getDailyUsage(days);
  const models = getModelBreakdown(days);
  
  if (options.json) {
    console.log(JSON.stringify({ summary, providers, daily, models }, null, 2));
  } else {
    console.log(formatStatsOutput(summary, providers, daily, models));
  }
}
