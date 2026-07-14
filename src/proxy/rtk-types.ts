// RTK Token Saver - Types and Configuration

export type RTKAggressiveness = 'balanced' | 'aggressive' | 'conservative';

export interface RTKConfig {
  enabled: boolean;
  aggressiveness: RTKAggressiveness;
}

export const RTK_CONFIG_DEFAULT: RTKConfig = {
  enabled: true,
  aggressiveness: 'balanced',
};

export interface CompressResult {
  compressed: string;
  originalTokens: number;
  savedTokens: number;
  savingsPercent: number;
  filterUsed: string;
}
