import { describe, it, expect } from 'bun:test';
import { estimateCost, findCheaperAlternative, COST_CONFIG_DEFAULT } from '../../src/proxy/cost-predictor';

describe('estimateCost', () => {
  it('estimates cost for messages', () => {
    const messages = [{ role: 'user', content: 'Hello world' }];
    const estimate = estimateCost(messages, 'gpt-4', 'openai');
    
    expect(estimate.provider).toBe('openai');
    expect(estimate.model).toBe('gpt-4');
    expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedOutputTokens).toBeGreaterThan(0);
    expect(estimate.estimatedCost).toBeGreaterThan(0);
  });

  it('uses default pricing for unknown model', () => {
    const messages = [{ role: 'user', content: 'Hello' }];
    const estimate = estimateCost(messages, 'unknown-model', 'unknown');
    
    // Unknown model uses DEFAULT_PRICING
    expect(estimate.estimatedCost).toBeGreaterThan(0);
  });

  it('handles array content blocks', () => {
    const messages = [{
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_result', content: 'Some result' }
      ]
    }];
    const estimate = estimateCost(messages, 'gpt-4', 'openai');
    
    expect(estimate.estimatedInputTokens).toBeGreaterThan(0);
  });
});

describe('findCheaperAlternative', () => {
  it('finds cheaper alternative', () => {
    const current = {
      provider: 'openai',
      model: 'gpt-4',
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 500,
      estimatedCost: 0.07,
    };
    
    const available = [
      { provider: 'openai', model: 'gpt-4' },
      { provider: 'openai', model: 'gpt-4-turbo' },
      { provider: 'openai', model: 'gpt-3.5-turbo' },
    ];
    
    const alternative = findCheaperAlternative(current, available);
    expect(alternative).not.toBeNull();
    expect(alternative?.estimatedCost).toBeLessThan(current.estimatedCost);
  });

  it('returns null when no cheaper option', () => {
    const current = {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 500,
      estimatedCost: 0.001,
    };
    
    const available = [
      { provider: 'openai', model: 'gpt-4' },
    ];
    
    const alternative = findCheaperAlternative(current, available);
    expect(alternative).toBeUndefined();
  });
});

describe('COST_CONFIG_DEFAULT', () => {
  it('has correct defaults', () => {
    expect(COST_CONFIG_DEFAULT.enabled).toBe(true);
    expect(COST_CONFIG_DEFAULT.threshold).toBe(0.05);
    expect(COST_CONFIG_DEFAULT.warnThreshold).toBe(0.10);
  });
});
