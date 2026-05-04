// Kiro SDK Type Inspection Script
// Purpose: Discover detailed type structures for request/response

import type {
  GenerateAssistantResponseRequest,
  GenerateAssistantResponseResponse,
  UserInputMessage,
  UserInputMessageContext,
  ConversationState,
  AssistantResponseEvent,
  ChatMessage,
  ChatResponseStream,
  AssistantResponseMessage,
  CodeEvent,
  ContextUsageEvent,
  MessageMetadataEvent,
  ToolSpecification,
  ToolUse,
  ToolResult,
} from "@aws/codewhisperer-streaming-client";

console.log("=== AWS CodeWhisperer Type Inspection ===\n");

// Helper to inspect type structure
function inspectType(name: string, example: any) {
  console.log(`## ${name}`);
  console.log("```typescript");
  console.log(JSON.stringify(example, null, 2));
  console.log("```\n");
}

// Create example structures based on TypeScript types
console.log("### Request Types\n");

const exampleUserInputMessage: Partial<UserInputMessage> = {
  content: "string",
  // Other fields will show as undefined if not in type
};
inspectType("UserInputMessage", exampleUserInputMessage);

const exampleConversationState: Partial<ConversationState> = {
  // Fields will show based on type definition
  conversationId: "string?",
  history: "ChatMessage[]?",
  currentMessage: "ChatMessage?",
};
inspectType("ConversationState", exampleConversationState);

const exampleGenerateRequest: Partial<GenerateAssistantResponseRequest> = {
  conversationState: exampleConversationState,
  userInputMessage: exampleUserInputMessage,
  profileArn: "string?",
};
inspectType("GenerateAssistantResponseRequest", exampleGenerateRequest);

console.log("\n### Response Types\n");

const exampleAssistantMessage: Partial<AssistantResponseMessage> = {
  content: "string?",
  messageId: "string?",
};
inspectType("AssistantResponseMessage", exampleAssistantMessage);

console.log("\n### Event Types\n");

console.log("AssistantResponseEvent is a union type with these possible events:");
console.log("- AssistantResponseMessage");
console.log("- CodeEvent");
console.log("- CitationEvent");
console.log("- CodeReferenceEvent");
console.log("- ContextUsageEvent");
console.log("- DocumentCitationEvent");
console.log("- FollowupPromptEvent");
console.log("- IntentsEvent");
console.log("- InteractionComponentsEvent");
console.log("- InvalidStateEvent");
console.log("- MessageMetadataEvent");
console.log("- MetadataEvent");
console.log("- MeteringEvent");
console.log("- ReasoningContentEvent");
console.log("- SupplementaryWebLinksEvent");
console.log("- ToolResultEvent");
console.log("- ToolUseEvent");
console.log();

console.log("\n### Tool Types\n");

const exampleToolSpec: Partial<ToolSpecification> = {
  name: "string",
  description: "string?",
  inputSchema: "object?",
};
inspectType("ToolSpecification", exampleToolSpec);

const exampleToolUse: Partial<ToolUse> = {
  toolUseId: "string?",
  name: "string?",
  input: "object?",
};
inspectType("ToolUse", exampleToolUse);

const exampleToolResult: Partial<ToolResult> = {
  toolUseId: "string?",
  content: "string?",
  status: "string?",
};
inspectType("ToolResult", exampleToolResult);

console.log("=== Type Inspection Complete ===");
console.log("\nNote: Actual type definitions may have more fields.");
console.log("Check node_modules/@aws/codewhisperer-streaming-client/dist-types/ for full definitions.");
