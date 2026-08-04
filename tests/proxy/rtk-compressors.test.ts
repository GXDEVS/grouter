import { describe, it, expect } from 'bun:test';
import { 
  compressGitDiff, 
  compressGitStatus, 
  compressGrep,
  compressFind,
  compressLs,
  compressTree,
  compressFileRead
} from '../../src/proxy/rtk-compressors';

describe('compressGitDiff', () => {
  it('removes diff headers but keeps hunks', () => {
    const input = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,6 +10,7 @@ const old = 1;
+const added = 2;
 const unchanged = 3;`;
    
    const result = compressGitDiff(input);
    expect(result.compressed).toContain('@@ -10,6 +10,7 @@');
    expect(result.compressed).toContain('+const added = 2;');
    expect(result.compressed).not.toContain('diff --git');
    expect(result.compressed).not.toContain('index abc..def');
    expect(result.savedTokens).toBeGreaterThan(0);
  });
});

describe('compressGitStatus', () => {
  it('condenses file list', () => {
    const input = `On branch main
Changes not staged for commit:
  modified:   src/foo.ts
  modified:   src/bar.ts
  modified:   src/baz.ts`;
    
    const result = compressGitStatus(input);
    expect(result.compressed).toContain('3 modified');
    expect(result.compressed).toContain('Branch: main');
    expect(result.savedTokens).toBeGreaterThan(0);
  });
});

describe('compressGrep', () => {
  it('removes repeated paths', () => {
    const input = `src/foo.ts:10:  const a = 1;
src/foo.ts:20:  const b = 2;
src/foo.ts:30:  const c = 3;`;
    
    const result = compressGrep(input);
    expect(result.compressed).toContain('3 matches');
    expect(result.compressed).toContain('src/foo.ts');
    expect(result.savedTokens).toBeGreaterThan(0);
  });
});

describe('compressFind', () => {
  it('counts files and directories', () => {
    const input = './src/foo.ts\n./src/bar.ts\n./lib/utils.ts';
    
    const result = compressFind(input);
    expect(result.compressed).toContain('3 files');
    expect(result.savedTokens).toBeGreaterThan(0);
  });
});

describe('compressLs', () => {
  it('keeps only filenames', () => {
    const input = `total 48
drwxr-xr-x  6 user staff  192 Jul 14 08:00 .
drwxr-xr-x 12 user staff  384 Jul 14 08:00 ..
-rw-r--r--  1 user staff  123 Jul 14 08:00 foo.ts
-rw-r--r--  1 user staff  456 Jul 14 08:00 bar.ts`;
    
    const result = compressLs(input);
    expect(result.compressed).toContain('foo.ts');
    expect(result.compressed).toContain('bar.ts');
    expect(result.compressed).not.toContain('drwx');
    expect(result.savedTokens).toBeGreaterThan(0);
  });
});

describe('compressTree', () => {
  it('collapses deeply indented files', () => {
    const input = `.
├── src
│   ├── foo.ts
│   └── bar.ts
└── package.json`;
    
    const result = compressTree(input);
    expect(result.compressed).toContain('├── src');
    expect(result.savedTokens).toBeGreaterThanOrEqual(0);
  });
});

describe('compressFileRead', () => {
  it('truncates large files', () => {
    // Create a file with 100 lines
    const lines = Array.from({ length: 100 }, (_, i) => `${i + 1}: line ${i + 1}`);
    const input = lines.join('\n');
    
    const result = compressFileRead(input, 'balanced');
    expect(result.compressed).toContain('... [60 lines omitted] ...');
    expect(result.savedTokens).toBeGreaterThan(0);
  });

  it('keeps small files unchanged', () => {
    const input = '1: short file\n2: end';
    
    const result = compressFileRead(input, 'balanced');
    expect(result.compressed).toBe(input);
    expect(result.savedTokens).toBe(0);
  });
});
