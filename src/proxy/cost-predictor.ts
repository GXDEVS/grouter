// Cost Predictor - Estimate request cost before sending

import { estimateCostUSD } from '../constants.ts';

export interface CostEstimate {
  provider: string;
  model: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCost: number;
  cheaperAlternative?: {
    provider: string;
    model: string;
    estimatedCost: number;
    savings: number;
  };
}

export interface CostConfig {
  enabled: boolean;
  threshold: number;        // dollars - suggest alternative if > threshold
  warnThreshold: number;    // dollars - warn user
}

export const COST_CONFIG_DEFAULT: CostConfig = {
  enabled: true,
  threshold: 0.05,
  warnThreshold: 0.10,
};

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export function estimateCost(
  messages: Array<{ role: string; content: string | any[] }>,
  model: string,
  provider: string
): CostEstimate {
  let inputTokens = 0;
  
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      inputTokens += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block.text === 'string') {
          inputTokens += estimateTokens(block.text);
        }
        if (typeof block.content === 'string') {
          inputTokens += estimateTokens(block.content);
        }
      }
    }
  }
  
  // Estimate output as 20% of input (heuristic)
  const outputTokens = Math.ceil(inputTokens * 0.2);
  
  const estimatedCost = estimateCostUSD(model, inputTokens, outputTokens);
  
  return {
    provider,
    model,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCost,
  };
}

export function findCheaperAlternative(
  current: CostEstimate,
  availableModels: Array<{ provider: string; model: string }>
): CostEstimate['cheaperAlternative'] {
  const alternatives = availableModels
    .filter(m => m.model !== current.model || m.provider !== current.provider)
    .map(m => ({
      provider: m.provider,
      model: m.model,
      cost: estimateCostUSD(m.model, current.estimatedInputTokens, current.estimatedOutputTokens),
    }))
    .filter(m => m.cost > 0 && m.cost < current.estimatedCost)
    .sort((a, b) => a.cost - b.cost);
  
  const best = alternatives[0];
  if (!best) return undefined;
  return {
    provider: best.provider,
    model: best.model,
    estimatedCost: best.cost,
    savings: current.estimatedCost - best.cost,
  };
}
