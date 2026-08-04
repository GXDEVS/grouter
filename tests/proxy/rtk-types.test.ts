import { describe, it, expect } from 'bun:test';
import { RTK_CONFIG_DEFAULT, type RTKConfig } from '../../src/proxy/rtk-types';

describe('RTK_CONFIG_DEFAULT', () => {
  it('has correct default values', () => {
    expect(RTK_CONFIG_DEFAULT.enabled).toBe(true);
    expect(RTK_CONFIG_DEFAULT.aggressiveness).toBe('balanced');
  });

  it('is a valid RTKConfig', () => {
    const config: RTKConfig = RTK_CONFIG_DEFAULT;
    expect(config).toHaveProperty('enabled');
    expect(config).toHaveProperty('aggressiveness');
  });
});
