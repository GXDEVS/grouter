// Kiro SDK Inspection Script
// Purpose: Discover exports, types, and capabilities of @aws/codewhisperer-streaming-client

import * as SDK from "@aws/codewhisperer-streaming-client";

console.log("=== AWS CodeWhisperer Streaming Client SDK Inspection ===\n");

// 1. List all exports
console.log("1. EXPORTS:");
const exports = Object.keys(SDK);
exports.forEach(exp => console.log(`   - ${exp}`));
console.log(`   Total: ${exports.length} exports\n`);

// 2. Check for Client class
console.log("2. CLIENT CLASS:");
if ("CodeWhispererStreamingClient" in SDK) {
  console.log("   ✓ CodeWhispererStreamingClient found");
  const ClientClass = (SDK as any).CodeWhispererStreamingClient;
  console.log(`   Type: ${typeof ClientClass}`);
  
  // Try to inspect prototype
  if (ClientClass.prototype) {
    const methods = Object.getOwnPropertyNames(ClientClass.prototype);
    console.log(`   Methods (${methods.length}):`);
    methods.slice(0, 20).forEach(m => console.log(`      - ${m}`));
    if (methods.length > 20) console.log(`      ... and ${methods.length - 20} more`);
  }
} else {
  console.log("   ✗ CodeWhispererStreamingClient not found");
}
console.log();

// 3. Check for Command classes
console.log("3. COMMAND CLASSES:");
const commandPatterns = [
  "GenerateAssistantResponseCommand",
  "SendMessageCommand",
  "ChatCommand",
  "ConversationCommand",
  "CompletionCommand",
  "GenerateCompletionsCommand",
  "CreateConversationCommand",
];

commandPatterns.forEach(pattern => {
  if (pattern in SDK) {
    console.log(`   ✓ ${pattern} found`);
  }
});

// List all *Command exports
const commands = exports.filter(e => e.includes("Command"));
if (commands.length > 0) {
  console.log(`   Found ${commands.length} command(s):`);
  commands.forEach(cmd => console.log(`      - ${cmd}`));
} else {
  console.log("   No *Command exports found");
}
console.log();

// 4. Check for Input/Output types
console.log("4. INPUT/OUTPUT TYPES:");
const typePatterns = [
  "GenerateAssistantResponseRequest",
  "GenerateAssistantResponseResponse",
  "SendMessageRequest",
  "SendMessageResponse",
  "ChatRequest",
  "ChatResponse",
  "ConversationRequest",
  "ConversationResponse",
];

typePatterns.forEach(pattern => {
  if (pattern in SDK) {
    console.log(`   ✓ ${pattern} found`);
  }
});

// List all *Request and *Response exports
const inputOutputTypes = exports.filter(e => e.includes("Request") || e.includes("Response") || e.includes("Input") || e.includes("Output"));
if (inputOutputTypes.length > 0) {
  console.log(`   Found ${inputOutputTypes.length} input/output type(s):`);
  inputOutputTypes.forEach(type => console.log(`      - ${type}`));
}
console.log();

// 5. Check for Config types
console.log("5. CONFIG TYPES:");
const configTypes = exports.filter(e => e.includes("Config") || e.includes("Client") && e !== "CodeWhispererStreamingClient");
if (configTypes.length > 0) {
  configTypes.forEach(type => console.log(`   - ${type}`));
} else {
  console.log("   No config types found");
}
console.log();

// 6. Check for EventStream types
console.log("6. EVENTSTREAM TYPES:");
const eventStreamTypes = exports.filter(e => 
  e.includes("Event") || 
  e.includes("Stream") || 
  e.includes("Chunk") ||
  e.includes("Delta")
);
if (eventStreamTypes.length > 0) {
  eventStreamTypes.forEach(type => console.log(`   - ${type}`));
} else {
  console.log("   No event stream types found");
}
console.log();

// 7. Summary
console.log("7. SUMMARY:");
console.log(`   Total exports: ${exports.length}`);
console.log(`   Commands: ${commands.length}`);
console.log(`   Input/Output types: ${inputOutputTypes.length}`);
console.log(`   EventStream types: ${eventStreamTypes.length}`);
console.log();

console.log("=== Inspection Complete ===");
