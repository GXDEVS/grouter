// RTK Token Saver - Main Module

import { RTKConfig, CompressResult, RTK_CONFIG_DEFAULT } from './rtk-types';
import { detectToolType } from './rtk-detectors';
import {
  compressGitDiff,
  compressGitStatus,
  compressGrep,
  compressFind,
  compressLs,
  compressTree,
  compressFileRead,
} from './rtk-compressors';

export type { RTKConfig, CompressResult };
export { RTK_CONFIG_DEFAULT };

export function compressToolResult(content: string, config: RTKConfig): CompressResult {
  if (!config.enabled) {
    return {
      compressed: content,
      originalTokens: Math.ceil(content.length / 4),
      savedTokens: 0,
      savingsPercent: 0,
      filterUsed: 'disabled',
    };
  }

  const toolType = detectToolType(content);
  
  if (!toolType) {
    return {
      compressed: content,
      originalTokens: Math.ceil(content.length / 4),
      savedTokens: 0,
      savingsPercent: 0,
      filterUsed: 'none',
    };
  }

  switch (toolType) {
    case 'git-diff':
      return compressGitDiff(content);
    case 'git-status':
      return compressGitStatus(content);
    case 'grep':
      return compressGrep(content);
    case 'find':
      return compressFind(content);
    case 'ls':
      return compressLs(content);
    case 'tree':
      return compressTree(content);
    case 'file-read':
      return compressFileRead(content, config.aggressiveness);
    default:
      return {
        compressed: content,
        originalTokens: Math.ceil(content.length / 4),
        savedTokens: 0,
        savingsPercent: 0,
        filterUsed: 'unknown',
      };
  }
}

export interface CompressMessagesResult {
  compressedMessages: any[];
  totalOriginal: number;
  totalSaved: number;
  totalSavingsPercent: number;
}

export function compressMessages(messages: any[], config: RTKConfig): CompressMessagesResult {
  let totalOriginal = 0;
  let totalSaved = 0;
  
  const compressedMessages = messages.map(msg => {
    // Only compress tool results (OpenAI format)
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      const result = compressToolResult(msg.content, config);
      totalOriginal += result.originalTokens;
      totalSaved += result.savedTokens;
      return { ...msg, content: result.compressed };
    }
    
    // Also compress tool_result in content array (Claude format)
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const compressedContent = msg.content.map((block: any) => {
        if (block.type === 'tool_result' && typeof block.content === 'string') {
          const result = compressToolResult(block.content, config);
          totalOriginal += result.originalTokens;
          totalSaved += result.savedTokens;
          return { ...block, content: result.compressed };
        }
        return block;
      });
      return { ...msg, content: compressedContent };
    }
    
    return msg;
  });

  return {
    compressedMessages,
    totalOriginal,
    totalSaved,
    totalSavingsPercent: totalOriginal > 0 ? Math.round((totalSaved / totalOriginal) * 100) : 0,
  };
}
