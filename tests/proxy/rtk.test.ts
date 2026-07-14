import { describe, it, expect } from 'bun:test';
import { compressToolResult, compressMessages, RTK_CONFIG_DEFAULT } from '../../src/proxy/rtk';

describe('compressToolResult', () => {
  it('returns original for non-tool content', () => {
    const content = 'Hello world';
    const result = compressToolResult(content, RTK_CONFIG_DEFAULT);
    expect(result.compressed).toBe(content);
    expect(result.savedTokens).toBe(0);
    expect(result.filterUsed).toBe('none');
  });

  it('returns original when disabled', () => {
    const content = 'diff --git a/foo.ts\nindex abc..def';
    const config = { ...RTK_CONFIG_DEFAULT, enabled: false };
    const result = compressToolResult(content, config);
    expect(result.compressed).toBe(content);
    expect(result.savedTokens).toBe(0);
    expect(result.filterUsed).toBe('disabled');
  });

  it('compresses git diff content', () => {
    const content = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,6 +10,7 @@ const old = 1;
+const added = 2;`;
    
    const result = compressToolResult(content, RTK_CONFIG_DEFAULT);
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.filterUsed).toBe('git-diff');
    expect(result.compressed).not.toContain('diff --git');
  });

  it('compresses grep output', () => {
    const content = `src/foo.ts:10:  const a = 1;
src/foo.ts:20:  const b = 2;`;
    
    const result = compressToolResult(content, RTK_CONFIG_DEFAULT);
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.filterUsed).toBe('grep');
  });
});

describe('compressMessages', () => {
  it('compresses tool_result in OpenAI format', () => {
    const messages = [
      { role: 'user', content: 'Show me the diff' },
      { role: 'assistant', content: 'Here is the diff:' },
      { 
        role: 'tool', 
        content: `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,6 +10,7 @@
+const added = 2;`,
        tool_call_id: '123'
      }
    ];
    
    const result = compressMessages(messages, RTK_CONFIG_DEFAULT);
    expect(result.totalSaved).toBeGreaterThan(0);
    expect(result.compressedMessages[2].content).not.toContain('diff --git');
  });

  it('returns same messages when no tool_result', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ];
    
    const result = compressMessages(messages, RTK_CONFIG_DEFAULT);
    expect(result.totalSaved).toBe(0);
    expect(result.compressedMessages).toEqual(messages);
  });
});
