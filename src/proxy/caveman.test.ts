import { describe, it, expect } from 'bun:test';
import { compressProse, compressMessages, CAVEMAN_CONFIG_DEFAULT } from '../proxy/caveman';

describe('Caveman Module', () => {
  describe('compressProse', () => {
    it('should return original when disabled', () => {
      const text = 'This is a test message.';
      const result = compressProse(text, { ...CAVEMAN_CONFIG_DEFAULT, enabled: false });
      expect(result.compressed).toBe(text);
      expect(result.savedTokens).toBe(0);
    });

    it('should compress with full intensity', () => {
      const text = 'I strongly prefer TypeScript with strict mode enabled for all new code. Please don\'t use `any` type unless there\'s genuinely no way around it, and if you do, leave a comment explaining the reasoning. I find that taking the time to properly type things catches a lot of bugs before they ever make it to runtime.';
      const result = compressProse(text, { ...CAVEMAN_CONFIG_DEFAULT, enabled: true, intensity: 'full' });
      expect(result.compressed.length).toBeLessThan(text.length);
      expect(result.savedTokens).toBeGreaterThan(0);
      expect(result.savingsPercent).toBeGreaterThan(0);
    });

    it('should compress with ultra intensity', () => {
      const text = 'You should always make sure to run the test suite before pushing any changes to the main branch. This is important because it helps catch bugs early and prevents broken builds from being deployed to production.';
      const result = compressProse(text, { ...CAVEMAN_CONFIG_DEFAULT, enabled: true, intensity: 'ultra' });
      expect(result.compressed.length).toBeLessThan(text.length);
      expect(result.savedTokens).toBeGreaterThan(0);
    });

    it('should preserve code blocks', () => {
      const text = 'This is a test with `inline code` and ```code blocks``` that should be preserved.';
      const result = compressProse(text, { ...CAVEMAN_CONFIG_DEFAULT, enabled: true, intensity: 'full' });
      expect(result.compressed).toContain('`inline code`');
      expect(result.compressed).toContain('```code blocks```');
    });

    it('should preserve URLs', () => {
      const text = 'Check out https://example.com for more information about this.';
      const result = compressProse(text, { ...CAVEMAN_CONFIG_DEFAULT, enabled: true, intensity: 'full' });
      expect(result.compressed).toContain('https://example.com');
    });

    it('should preserve file paths', () => {
      const text = 'Edit the file at src/index.ts to add the new function.';
      const result = compressProse(text, { ...CAVEMAN_CONFIG_DEFAULT, enabled: true, intensity: 'full' });
      expect(result.compressed).toContain('src/index.ts');
    });
  });

  describe('compressMessages', () => {
    it('should compress system messages', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant that should always be polite and professional.' },
        { role: 'user', content: 'Hello!' }
      ];
      const result = compressMessages(messages, { ...CAVEMAN_CONFIG_DEFAULT, enabled: true, intensity: 'full' });
      expect(result.compressedMessages[0].content.length).toBeLessThan(messages[0].content.length);
      expect(result.totalSaved).toBeGreaterThan(0);
    });

    it('should compress user messages', () => {
      const messages = [
        { role: 'user', content: 'I would like you to please help me with this task.' }
      ];
      const result = compressMessages(messages, { ...CAVEMAN_CONFIG_DEFAULT, enabled: true, intensity: 'full' });
      expect(result.compressedMessages[0].content.length).toBeLessThan(messages[0].content.length);
    });

    it('should not modify assistant messages', () => {
      const messages = [
        { role: 'assistant', content: 'I will help you with that task.' }
      ];
      const result = compressMessages(messages, { ...CAVEMAN_CONFIG_DEFAULT, enabled: true, intensity: 'full' });
      expect(result.compressedMessages[0].content).toBe(messages[0].content);
    });

    it('should return original when disabled', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' }
      ];
      const result = compressMessages(messages, { ...CAVEMAN_CONFIG_DEFAULT, enabled: false });
      expect(result.compressedMessages).toEqual(messages);
      expect(result.totalSaved).toBe(0);
    });

    it('should handle empty messages', () => {
      const messages: any[] = [];
      const result = compressMessages(messages, { ...CAVEMAN_CONFIG_DEFAULT, enabled: true });
      expect(result.compressedMessages).toEqual([]);
      expect(result.totalOriginal).toBe(0);
      expect(result.totalSaved).toBe(0);
    });
  });
});
