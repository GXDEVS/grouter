// Caveman - Token compression via prose simplification
// Based on caveman skill by JuliusBrussee
// Removes filler, articles, hedging; preserves code/URLs/technical terms

export interface CavemanConfig {
  enabled: boolean;
  intensity: 'lite' | 'full' | 'ultra';
}

export const CAVEMAN_CONFIG_DEFAULT: CavemanConfig = {
  enabled: false,
  intensity: 'full',
};

// Words/patterns to remove by intensity
const REMOVE_FULL = [
  // Articles
  /\b(a|an|the)\b/gi,
  // Filler words
  /\b(just|really|basically|actually|simply|literally|probably|definitely|certainly|absolutely|obviously|clearly|essentially|fundamentally|importantly|notably|significantly|remarkably|particularly|especially|generally|typically|usually|normally|commonly|frequently|often|sometimes|occasionally|rarely|seldom|hardly|barely|merely|only|still|already|yet|even|also|too|very|quite|rather|somewhat|fairly|pretty|enough|almost|nearly|practically|virtually)\b/gi,
  // Pleasantries
  /\b(sure|certainly|of course|happy to|glad to|pleased to|welcome to|feel free|don't hesitate|please note|be aware|keep in mind|remember that|note that|it is worth|it should be|you may want|you might want|you could also|you should also|one thing to|another thing|something to consider|something to keep|food for thought|for what it's worth|in my opinion|I think that|I believe that|in my experience|from my experience|what I've found|what I've noticed|what I've seen|what I've learned)\b/gi,
  // Hedging
  /\b(I think|I believe|I feel|I suppose|I guess|I assume|I reckon|I suspect|I imagine|I would say|I might say|perhaps|maybe|possibly|probably|likely|unlikely|might|may|could|would|should|ought to|need to|have to|must)\b/gi,
  // Redundant phrases
  /\b(in order to|for the purpose of|with regard to|with respect to|in terms of|as far as|as long as|as well as|in addition to|along with|together with|combined with|including but not limited to|such as|for example|for instance|to name a few|and so on|and more|etc)\b/gi,
];

const REMOVE_ULTRA = [
  ...REMOVE_FULL,
  // More aggressive
  /\b(this is a|this is the|this is an|here is a|here is the|here is an|there is a|there is the|there is an)\b/gi,
  /\b(I will|I'll|we will|we'll|you will|you'll|they will|they'll|he will|he'll|she will|she'll|it will|it'll)\b/gi,
  /\b(would like to|want to|need to|have to|should|must|ought to)\b/gi,
];

// Patterns to preserve (code blocks, URLs, etc.)
const PRESERVE_PATTERNS = [
  /```[\s\S]*?```/g,           // Code blocks
  /`[^`]+`/g,                  // Inline code
  /https?:\/\/[^\s]+/g,        // URLs
  /\/[a-zA-Z0-9_\-\/]+/g,     // File paths
  /\b[A-Z][A-Z0-9_]+\b/g,     // Constants
  /\b[a-z]+\.[a-z]+\.[a-z]+\b/g, // Module paths
];

function preserveContent(text: string): { preserved: string[]; placeholder: string } {
  const preserved: string[] = [];
  let result = text;
  
  for (const pattern of PRESERVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const index = preserved.length;
      preserved.push(match);
      return `__PRESERVED_${index}__`;
    });
  }
  
  return { preserved, placeholder: result };
}

function restoreContent(text: string, preserved: string[]): string {
  let result = text;
  for (let i = 0; i < preserved.length; i++) {
    result = result.replace(`__PRESERVED_${i}__`, preserved[i]);
  }
  return result;
}

function compressText(text: string, intensity: 'lite' | 'full' | 'ultra'): string {
  // Preserve code/URLs/technical content
  const { preserved, placeholder } = preserveContent(text);
  
  let result = placeholder;
  
  // Apply removal patterns based on intensity
  const patterns = intensity === 'ultra' ? REMOVE_ULTRA : intensity === 'full' ? REMOVE_FULL : [];
  
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }
  
  // Clean up whitespace
  result = result
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
  
  // Restore preserved content
  return restoreContent(result, preserved);
}

export function compressProse(text: string, config: CavemanConfig): {
  compressed: string;
  originalTokens: number;
  savedTokens: number;
  savingsPercent: number;
} {
  if (!config.enabled) {
    return {
      compressed: text,
      originalTokens: Math.ceil(text.length / 4),
      savedTokens: 0,
      savingsPercent: 0,
    };
  }
  
  const originalTokens = Math.ceil(text.length / 4);
  const compressed = compressText(text, config.intensity);
  const savedTokens = originalTokens - Math.ceil(compressed.length / 4);
  
  return {
    compressed,
    originalTokens,
    savedTokens,
    savingsPercent: Math.round((savedTokens / originalTokens) * 100),
  };
}

export function compressMessages(messages: any[], config: CavemanConfig): {
  compressedMessages: any[];
  totalOriginal: number;
  totalSaved: number;
  totalSavingsPercent: number;
} {
  if (!config.enabled) {
    return {
      compressedMessages: messages,
      totalOriginal: 0,
      totalSaved: 0,
      totalSavingsPercent: 0,
    };
  }
  
  let totalOriginal = 0;
  let totalSaved = 0;
  
  const compressedMessages = messages.map(msg => {
    // Compress system messages
    if (msg.role === 'system' && typeof msg.content === 'string') {
      const result = compressProse(msg.content, config);
      totalOriginal += result.originalTokens;
      totalSaved += result.savedTokens;
      return { ...msg, content: result.compressed };
    }
    
    // Compress user messages
    if (msg.role === 'user' && typeof msg.content === 'string') {
      const result = compressProse(msg.content, config);
      totalOriginal += result.originalTokens;
      totalSaved += result.savedTokens;
      return { ...msg, content: result.compressed };
    }
    
    // Compress text blocks in content array (Claude format)
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const compressedContent = msg.content.map((block: any) => {
        if (block.type === 'text' && typeof block.text === 'string') {
          const result = compressProse(block.text, config);
          totalOriginal += result.originalTokens;
          totalSaved += result.savedTokens;
          return { ...block, text: result.compressed };
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
