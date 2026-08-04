// RTK Token Saver - Content Compressors

import type { CompressResult } from './rtk-types.ts';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function compressGitDiff(content: string): CompressResult {
  const originalTokens = estimateTokens(content);
  
  // Remove metadata lines, keep hunks
  const compressed = content
    .split('\n')
    .filter(line => !line.startsWith('diff --git'))
    .filter(line => !line.startsWith('index '))
    .filter(line => !line.startsWith('--- '))
    .filter(line => !line.startsWith('+++ '))
    .join('\n');
  
  const savedTokens = originalTokens - estimateTokens(compressed);
  return {
    compressed,
    originalTokens,
    savedTokens,
    savingsPercent: Math.round((savedTokens / originalTokens) * 100),
    filterUsed: 'git-diff',
  };
}

export function compressGitStatus(content: string): CompressResult {
  const originalTokens = estimateTokens(content);
  
  // Extract branch and count changes
  const branchMatch = content.match(/On branch (\S+)/);
  const branch = branchMatch ? branchMatch[1] : 'unknown';
  
  const modified = (content.match(/modified:\s+/g) || []).length;
  const added = (content.match(/new file:\s+/g) || []).length;
  const deleted = (content.match(/deleted:\s+/g) || []).length;
  
  const compressed = `Branch: ${branch}\nChanges: ${modified} modified, ${added} added, ${deleted} deleted`;
  
  const savedTokens = originalTokens - estimateTokens(compressed);
  return {
    compressed,
    originalTokens,
    savedTokens,
    savingsPercent: Math.round((savedTokens / originalTokens) * 100),
    filterUsed: 'git-status',
  };
}

export function compressGrep(content: string): CompressResult {
  const originalTokens = estimateTokens(content);
  
  const lines = content.split('\n').filter(l => l.trim());
  const fileCounts: Record<string, number> = {};
  
  for (const line of lines) {
    const match = line.match(/^([^:]+):/);
    if (match && match[1]) {
      const file = match[1];
      fileCounts[file] = (fileCounts[file] || 0) + 1;
    }
  }
  
  const compressed = Object.entries(fileCounts)
    .map(([file, count]) => `${count} matches in ${file}`)
    .join('\n');
  
  const savedTokens = originalTokens - estimateTokens(compressed);
  return {
    compressed,
    originalTokens,
    savedTokens,
    savingsPercent: Math.round((savedTokens / originalTokens) * 100),
    filterUsed: 'grep',
  };
}

export function compressFind(content: string): CompressResult {
  const originalTokens = estimateTokens(content);
  
  const files = content.split('\n').filter(f => f.startsWith('./'));
  const dirs = new Set(files.map(f => f.split('/').slice(0, -1).join('/')));
  
  const compressed = `${files.length} files in ${dirs.size} directories`;
  
  const savedTokens = originalTokens - estimateTokens(compressed);
  return {
    compressed,
    originalTokens,
    savedTokens,
    savingsPercent: Math.round((savedTokens / originalTokens) * 100),
    filterUsed: 'find',
  };
}

export function compressLs(content: string): CompressResult {
  const originalTokens = estimateTokens(content);
  
  const files = content.split('\n')
    .filter(l => l.trim() && !l.startsWith('total'))
    .map(l => l.split(/\s+/).pop() || '')
    .filter(f => f && f !== '.' && f !== '..');
  
  const compressed = files.join('\n');
  
  const savedTokens = originalTokens - estimateTokens(compressed);
  return {
    compressed,
    originalTokens,
    savedTokens,
    savingsPercent: Math.round((savedTokens / originalTokens) * 100),
    filterUsed: 'ls',
  };
}

export function compressTree(content: string): CompressResult {
  const originalTokens = estimateTokens(content);
  
  // Keep structure but collapse deeply indented unchanged files
  const lines = content.split('\n');
  const compressed = lines
    .filter(l => !l.match(/[│]\s{4,}/)) // Remove deeply indented unchanged files
    .join('\n');
  
  const savedTokens = originalTokens - estimateTokens(compressed);
  return {
    compressed,
    originalTokens,
    savedTokens,
    savingsPercent: Math.round((savedTokens / originalTokens) * 100),
    filterUsed: 'tree',
  };
}

export function compressFileRead(content: string, aggressiveness: 'balanced' | 'aggressive' | 'conservative'): CompressResult {
  const originalTokens = estimateTokens(content);
  const lines = content.split('\n');
  
  if (lines.length <= 50) {
    // Small file, keep as-is
    return {
      compressed: content,
      originalTokens,
      savedTokens: 0,
      savingsPercent: 0,
      filterUsed: 'file-read-none',
    };
  }
  
  // Smart truncation based on aggressiveness
  let keepPercent = 0.2; // balanced default
  if (aggressiveness === 'aggressive') keepPercent = 0.1;
  if (aggressiveness === 'conservative') keepPercent = 0.3;
  
  const keepStart = Math.ceil(lines.length * keepPercent);
  const keepEnd = Math.ceil(lines.length * keepPercent);
  
  const startLines = lines.slice(0, keepStart);
  const endLines = lines.slice(-keepEnd);
  const omitted = lines.length - keepStart - keepEnd;
  
  const compressed = [
    ...startLines,
    `\n... [${omitted} lines omitted] ...\n`,
    ...endLines,
  ].join('\n');
  
  const savedTokens = originalTokens - estimateTokens(compressed);
  return {
    compressed,
    originalTokens,
    savedTokens,
    savingsPercent: Math.round((savedTokens / originalTokens) * 100),
    filterUsed: 'file-read',
  };
}
