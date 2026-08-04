import { describe, it, expect } from 'bun:test';
import { detectToolType } from '../../src/proxy/rtk-detectors';

describe('detectToolType', () => {
  it('detects git diff output', () => {
    const content = 'diff --git a/src/foo.ts b/src/foo.ts\nindex abc..def 100644\n--- a/src/foo.ts\n+++ b/src/foo.ts';
    expect(detectToolType(content)).toBe('git-diff');
  });

  it('detects git status output', () => {
    const content = 'On branch main\nChanges not staged for commit:\n  modified:   src/foo.ts';
    expect(detectToolType(content)).toBe('git-status');
  });

  it('detects grep output', () => {
    const content = 'src/foo.ts:42:  const result = grep(pattern);\nsrc/foo.ts:55:  return result;';
    expect(detectToolType(content)).toBe('grep');
  });

  it('detects find output', () => {
    const content = './src\n./src/foo.ts\n./src/bar.ts\n./src/baz.ts';
    expect(detectToolType(content)).toBe('find');
  });

  it('detects ls output', () => {
    const content = 'total 48\ndrwxr-xr-x  6 user staff  192 Jul 14 08:00 .\ndrwxr-xr-x 12 user staff  384 Jul 14 08:00 ..';
    expect(detectToolType(content)).toBe('ls');
  });

  it('detects tree output', () => {
    const content = '.\n├── src\n│   ├── foo.ts\n│   └── bar.ts\n└── package.json';
    expect(detectToolType(content)).toBe('tree');
  });

  it('detects file read output', () => {
    const content = '1: import { foo } from "./foo";\n2: \n3: export const bar = () => {';
    expect(detectToolType(content)).toBe('file-read');
  });

  it('returns null for unknown content', () => {
    const content = 'Hello world, this is normal text without any special patterns.';
    expect(detectToolType(content)).toBeNull();
  });
});
