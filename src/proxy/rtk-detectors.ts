// RTK Token Saver - Tool Type Detectors

export type ToolType = 
  | 'git-diff' 
  | 'git-status' 
  | 'grep' 
  | 'find' 
  | 'ls' 
  | 'tree' 
  | 'file-read';

export function detectToolType(content: string): ToolType | null {
  // Check first 1KB for patterns
  const sample = content.slice(0, 1024);
  
  // git diff
  if (sample.startsWith('diff --git') || sample.includes('\ndiff --git')) {
    return 'git-diff';
  }
  
  // git status
  if (sample.includes('On branch ') && (sample.includes('Changes not staged') || sample.includes('Changes to be committed'))) {
    return 'git-status';
  }
  
  // grep output (file:line:content)
  const lines = sample.split('\n');
  const grepLines = lines.filter(l => /^[^:]+:\d+:/.test(l));
  if (grepLines.length >= 2) return 'grep';
  
  // find output (relative paths)
  const findLines = lines.filter(l => l.startsWith('./'));
  if (findLines.length > 3) return 'find';
  
  // ls output
  if (sample.includes('total ') && /^\s*(drwx|[\-rw])/m.test(sample)) {
    return 'ls';
  }
  
  // tree output
  if (/[├└│]/.test(sample) && /[───]/.test(sample)) {
    return 'tree';
  }
  
  // File read (line numbers at start)
  if (/^\d+:\s/.test(sample)) {
    return 'file-read';
  }
  
  return null;
}
