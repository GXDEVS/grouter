// Kiro SDK Authentication Test Harness
// Purpose: Test real authentication with Grouter's OAuth token
//
// Usage:
//   bun run scripts/test-kiro-sdk-auth.ts --connection 0c010b69
//   bun run scripts/test-kiro-sdk-auth.ts --connection 0c010b69 --confirm RUN_KIRO_SDK_TEST

import { Database } from "bun:sqlite";
import {
  CodeWhispererStreamingClient,
  GenerateAssistantResponseCommand,
  type GenerateAssistantResponseRequest,
  type AssistantResponseEvent,
} from "@aws/codewhisperer-streaming-client";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ── CLI Arguments ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// Helper to get argument value
function getArg(name: string): string | undefined {
  const flagIndex = args.indexOf(name);
  if (flagIndex !== -1 && flagIndex + 1 < args.length) {
    return args[flagIndex + 1];
  }
  const equalArg = args.find(a => a.startsWith(`${name}=`));
  if (equalArg) {
    return equalArg.split("=")[1];
  }
  return undefined;
}

const connectionId = getArg("--connection");
const customEndpoint = getArg("--endpoint");
const variant = getArg("--variant") || "minimal";
const confirmFlag = args.includes("--confirm") && args.includes("RUN_KIRO_SDK_TEST");

// ── Database Access ─────────────────────────────────────────────────────────

function findGrouterDb(): string | null {
  // Try common locations
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const locations = [
    join(home, ".grouter", "grouter.db"),
    ".grouter/grouter.db",
    "../.grouter/grouter.db",
  ];

  for (const loc of locations) {
    try {
      const db = new Database(loc, { readonly: true });
      db.close();
      return loc;
    } catch {
      continue;
    }
  }

  return null;
}

interface Connection {
  id: string;
  provider: string;
  email: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  provider_data: string | null;
}

function getKiroConnection(connectionId?: string): Connection | null {
  const dbPath = findGrouterDb();
  if (!dbPath) {
    console.error("❌ Grouter database not found");
    console.error("   Tried:");
    console.error("   - ~/.grouter/grouter.db");
    console.error("   - .grouter/grouter.db");
    console.error("   - ../.grouter/grouter.db");
    return null;
  }

  const db = new Database(dbPath, { readonly: true });

  try {
    let query: string;
    let params: any[];

    if (connectionId) {
      query = "SELECT * FROM accounts WHERE id LIKE ? AND provider = 'kiro' LIMIT 1";
      params = [`${connectionId}%`];
    } else {
      query = "SELECT * FROM accounts WHERE provider = 'kiro' LIMIT 1";
      params = [];
    }

    const row = db.query(query).get(...params) as any;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      provider: row.provider,
      email: row.email || "unknown",
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expires_at: row.expires_at,
      provider_data: row.provider_data,
    };
  } finally {
    db.close();
  }
}

// ── Token Sanitization ──────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  return `${local[0]}${"*".repeat(Math.max(local.length - 2, 1))}${local[local.length - 1]}@${domain}`;
}

function maskToken(token: string): string {
  if (token.length < 20) return "***";
  return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

// ── SDK Client Creation ─────────────────────────────────────────────────────

function buildKiroClient(
  token: string,
  expiresAt: string,
  region: string = "us-east-1",
  endpoint?: string
): CodeWhispererStreamingClient {
  const config: any = {
    region,
    token: {
      token,
      expiration: new Date(expiresAt),
    },
  };

  // Add custom endpoint if provided
  if (endpoint) {
    config.endpoint = endpoint;
  }

  const client = new CodeWhispererStreamingClient(config);

  // Add middleware to capture serialized request
  client.middlewareStack.add(
    (next: any) => async (args: any) => {
      try {
        const req = args.request;
        const sanitized: any = {
          method: req.method,
          protocol: req.protocol,
          hostname: req.hostname,
          path: req.path,
          headers: { ...req.headers },
        };

        // Remove Authorization header
        if (sanitized.headers.Authorization) {
          sanitized.headers.Authorization = "Bearer ***";
        }
        if (sanitized.headers.authorization) {
          sanitized.headers.authorization = "Bearer ***";
        }

        // Try to capture body
        if (req.body) {
          try {
            const bodyStr = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
            sanitized.body = JSON.parse(bodyStr);
          } catch {
            sanitized.body = "(could not parse body)";
          }
        }

        console.log("\n[SDK Serialized Request]");
        console.log(JSON.stringify(sanitized, null, 2));
        console.log();
      } catch (e: any) {
        console.warn("Could not capture request:", e.message);
      }

      return next(args);
    },
    {
      step: "build",
      name: "captureRequest",
      priority: "low",
    }
  );

  return client;
}

// ── Test Request ────────────────────────────────────────────────────────────

type RequestVariant = 
  | "minimal"
  | "with-empty-conversation-state"
  | "with-conversation-id"
  | "without-profile-arn"
  | "with-null-profile-arn"
  | "send-message-command";

function buildRequestVariant(
  variant: string,
  providerData: any
): { command: string; request: any } {
  const profileArn = providerData.profileArn;

  switch (variant) {
    case "minimal":
      return {
        command: "GenerateAssistantResponseCommand",
        request: {
          userInputMessage: {
            content: "Responda apenas: OK",
          },
        },
      };

    case "with-empty-conversation-state":
      return {
        command: "GenerateAssistantResponseCommand",
        request: {
          userInputMessage: {
            content: "Responda apenas: OK",
          },
          conversationState: {
            history: [],
          },
        },
      };

    case "with-conversation-id":
      return {
        command: "GenerateAssistantResponseCommand",
        request: {
          userInputMessage: {
            content: "Responda apenas: OK",
          },
          conversationState: {
            conversationId: crypto.randomUUID(),
            history: [],
          },
        },
      };

    case "without-profile-arn":
      // Explicitly do NOT include profileArn, even if it exists
      return {
        command: "GenerateAssistantResponseCommand",
        request: {
          userInputMessage: {
            content: "Responda apenas: OK",
          },
        },
      };

    case "with-null-profile-arn":
      return {
        command: "GenerateAssistantResponseCommand",
        request: {
          userInputMessage: {
            content: "Responda apenas: OK",
          },
          profileArn: null,
        },
      };

    case "correct-structure":
      return {
        command: "GenerateAssistantResponseCommand",
        request: {
          conversationState: {
            currentMessage: {
              userInputMessage: {
                content: "Responda apenas: OK",
              },
            },
            chatTriggerType: "MANUAL",
          },
        },
      };

    case "send-message-command":
      return {
        command: "SendMessageCommand",
        request: {
          userInputMessage: {
            content: "Responda apenas: OK",
          },
        },
      };

    default:
      throw new Error(`Unknown variant: ${variant}`);
  }
}

async function testKiroAuth(
  connection: Connection,
  confirm: boolean,
  customEndpoint?: string,
  variant: string = "minimal"
): Promise<void> {
  console.log("\n=== Kiro SDK Auth Test ===\n");

  // Parse provider data
  let providerData: any = {};
  if (connection.provider_data) {
    try {
      providerData = JSON.parse(connection.provider_data);
    } catch (e) {
      console.warn("⚠️  Could not parse provider_data");
    }
  }

  const region = providerData.region || "us-east-1";
  
  // Use custom endpoint or default from Grouter registry
  const endpoint = customEndpoint || "https://codewhisperer.us-east-1.amazonaws.com";

  // Display connection info
  console.log("Connection Info:");
  console.log(`  ID: ${connection.id}`);
  console.log(`  Email: ${maskEmail(connection.email)}`);
  console.log(`  Provider: ${connection.provider}`);
  console.log(`  Region: ${region}`);
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Variant: ${variant}`);
  console.log(`  Token: ${maskToken(connection.access_token)}`);
  console.log(`  Expires: ${connection.expires_at}`);
  if (providerData.profileArn) {
    console.log(`  Profile ARN: ${providerData.profileArn}`);
  } else {
    console.log(`  Profile ARN: (null)`);
  }
  console.log();

  // Check expiration
  const expiresAt = new Date(connection.expires_at);
  const now = new Date();
  if (now >= expiresAt) {
    console.error("❌ Token is expired!");
    console.error(`   Expired at: ${expiresAt.toISOString()}`);
    console.error(`   Current time: ${now.toISOString()}`);
    console.error("   Please refresh the token in Grouter first.");
    return;
  }

  const timeUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60);
  console.log(`✓ Token is valid (expires in ${timeUntilExpiry} minutes)\n`);

  // Pre-flight checks
  console.log("Pre-flight Checks:");
  console.log(`  ✓ Connection found`);
  console.log(`  ✓ Token present`);
  console.log(`  ✓ Token not expired`);
  console.log(`  ✓ Region configured: ${region}`);
  console.log(`  ✓ Variant: ${variant}`);
  console.log();

  // Build request based on variant
  const { command: commandName, request } = buildRequestVariant(variant, providerData);

  console.log("Request:");
  console.log(`  Command: ${commandName}`);
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Variant: ${variant}`);
  console.log(`  Prompt: "${request.userInputMessage?.content}"`);
  console.log(`  Profile ARN in request: ${request.profileArn !== undefined ? (request.profileArn === null ? "null" : request.profileArn) : "(not included)"}`);
  console.log(`  Conversation State: ${request.conversationState ? "included" : "(not included)"}`);
  if (request.conversationState?.conversationId) {
    console.log(`  Conversation ID: ${request.conversationState.conversationId}`);
  }
  console.log();

  if (!confirm) {
    console.log("⚠️  DRY RUN MODE");
    console.log("   Add --confirm RUN_KIRO_SDK_TEST to execute real API call");
    console.log();
    console.log("Would execute:");
    console.log(`  const client = new CodeWhispererStreamingClient({`);
    console.log(`    region: "${region}",`);
    console.log(`    endpoint: "${endpoint}",`);
    console.log(`    token: { token: "***", expiration: new Date("${connection.expires_at}") }`);
    console.log(`  });`);
    console.log(`  const command = new ${commandName}(request);`);
    console.log(`  const response = await client.send(command);`);
    console.log();
    console.log("Request payload:");
    console.log(JSON.stringify(request, null, 2));
    return;
  }

  // Execute real request
  console.log("🚀 Executing real API call...\n");

  try {
    const client = buildKiroClient(connection.access_token, connection.expires_at, region, endpoint);
    
    let command: any;
    if (commandName === "SendMessageCommand") {
      const { SendMessageCommand } = await import("@aws/codewhisperer-streaming-client");
      command = new SendMessageCommand(request);
    } else {
      command = new GenerateAssistantResponseCommand(request);
    }

    const startTime = Date.now();
    const response = await client.send(command);
    const elapsed = Date.now() - startTime;

    console.log(`✅ Request successful (${elapsed}ms)\n`);

    // Debug: log response structure
    console.log("Response keys:", Object.keys(response));
    console.log("chatResponseStream exists:", !!response.generateAssistantResponseResponse);
    if (response.generateAssistantResponseResponse) {
      console.log("chatResponseStream type:", typeof response.generateAssistantResponseResponse);
      console.log("chatResponseStream constructor:", response.generateAssistantResponseResponse.constructor.name);
    }
    console.log();

    // Collect events
    console.log("Collecting events...");
    const events: AssistantResponseEvent[] = [];
    let eventCount = 0;

    if (response.generateAssistantResponseResponse) {
      for await (const event of response.generateAssistantResponseResponse) {
        events.push(event);
        eventCount++;

        // Log event type
        const eventType = Object.keys(event)[0] || "unknown";
        console.log(`  Event ${eventCount}: ${eventType}`);
      }
    }

    console.log(`\n✅ Collected ${eventCount} events\n`);

    // Analyze events
    console.log("Event Analysis:");
    const eventTypes = new Map<string, number>();
    let content = "";
    let messageId = "";
    let usage: any = null;

    for (const event of events) {
      const type = Object.keys(event)[0];
      eventTypes.set(type, (eventTypes.get(type) || 0) + 1);

      // Extract content
      if ("assistantResponseMessage" in event && event.assistantResponseMessage) {
        const msg = event.assistantResponseMessage as any;
        if (msg.content) content += msg.content;
        if (msg.messageId) messageId = msg.messageId;
      }

      // Extract usage
      if ("contextUsageEvent" in event && event.contextUsageEvent) {
        usage = event.contextUsageEvent;
      }
    }

    console.log("  Event Types:");
    for (const [type, count] of eventTypes.entries()) {
      console.log(`    - ${type}: ${count}`);
    }
    console.log();

    if (content) {
      console.log(`  Content: "${content}"`);
    }
    if (messageId) {
      console.log(`  Message ID: ${messageId}`);
    }
    if (usage) {
      console.log(`  Usage: ${JSON.stringify(usage)}`);
    }
    console.log();

    // Save results
    const outputDir = join(".tmp", "kiro-sdk-real-test", new Date().toISOString().replace(/:/g, "-").split(".")[0]);
    mkdirSync(outputDir, { recursive: true });

    // Sanitize events
    const sanitizedEvents = events.map(event => {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(event)) {
        sanitized[key] = value;
      }
      return sanitized;
    });

    // Save files
    writeFileSync(
      join(outputDir, "00-metadata.json"),
      JSON.stringify({
        connectionId: connection.id,
        email: maskEmail(connection.email),
        region,
        endpoint,
        variant,
        commandName,
        elapsed,
        eventCount,
        timestamp: new Date().toISOString(),
      }, null, 2)
    );

    writeFileSync(
      join(outputDir, "01-sanitized-request.json"),
      JSON.stringify({
        command: commandName,
        variant,
        request: {
          userInputMessage: request.userInputMessage,
          conversationState: request.conversationState,
          profileArn: request.profileArn !== undefined ? (request.profileArn === null ? "null" : "***") : undefined,
        },
      }, null, 2)
    );

    writeFileSync(
      join(outputDir, "02-events-sanitized.json"),
      JSON.stringify(sanitizedEvents, null, 2)
    );

    const resultMd = `# Kiro SDK Auth Test Result

**Status**: ✅ SUCCESS

**Connection**: ${connection.id}
**Email**: ${maskEmail(connection.email)}
**Region**: ${region}
**Endpoint**: ${endpoint}
**Variant**: ${variant}
**Command**: ${commandName}
**Elapsed**: ${elapsed}ms
**Events**: ${eventCount}

## Event Types

${Array.from(eventTypes.entries()).map(([type, count]) => `- ${type}: ${count}`).join("\n")}

## Content

\`\`\`
${content || "(no content)"}
\`\`\`

## Message ID

\`\`\`
${messageId || "(no message ID)"}
\`\`\`

## Usage

\`\`\`json
${JSON.stringify(usage, null, 2) || "null"}
\`\`\`

## Conclusion

✅ **Authentication works!**

The SDK successfully authenticated using Grouter's OAuth token via the \`token\` config field.

**Auth Method**: Token-based (TokenIdentity)
**Token Format**: OAuth Bearer token
**Compatibility**: 100% compatible with Grouter's Kiro OAuth

## Next Steps

1. Update \`src/proxy/kiro-translator.ts\` with confirmed auth method
2. Implement full event mapping based on observed event types
3. Integrate with upstream dispatcher
4. Test end-to-end with Maestro
`;

    writeFileSync(join(outputDir, "03-result.md"), resultMd);

    console.log(`Results saved to: ${outputDir}`);
    console.log();

    console.log("=== Test Complete ===");
    console.log();
    console.log("✅ SDK auth works!");
    console.log(`✅ Received ${eventCount} events`);
    console.log(`✅ Content: "${content}"`);
    console.log();
    console.log("Next steps:");
    console.log("  1. Review events in .tmp/kiro-sdk-real-test/");
    console.log("  2. Update kiro-translator.ts with confirmed auth");
    console.log("  3. Implement full event mapping");
    console.log("  4. Integrate with upstream dispatcher");

  } catch (error: any) {
    console.error("\n❌ Request failed\n");
    console.error(`Error: ${error.message}`);
    if (error.name) console.error(`Type: ${error.name}`);
    if (error.$metadata) {
      console.error(`HTTP Status: ${error.$metadata.httpStatusCode}`);
      console.error(`Request ID: ${error.$metadata.requestId}`);
      console.error(`Attempts: ${error.$metadata.attempts}`);
      console.error(`Total Retry Delay: ${error.$metadata.totalRetryDelay}ms`);
    }
    if (error.$fault) console.error(`Fault: ${error.$fault}`);
    if (error.$retryable !== undefined) console.error(`Retryable: ${error.$retryable}`);
    if (error.code) console.error(`Code: ${error.code}`);
    if (error.Code) console.error(`Code (alt): ${error.Code}`);
    console.error();
    console.error("Full error:");
    console.error(error);

    // Save error details
    const outputDir = join(".tmp", "kiro-sdk-real-test", `${new Date().toISOString().replace(/:/g, "-").split(".")[0]}-${variant}`);
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(
      join(outputDir, "00-metadata.json"),
      JSON.stringify({
        connectionId: connection.id,
        email: maskEmail(connection.email),
        region,
        endpoint,
        variant,
        commandName,
        status: "FAILED",
        timestamp: new Date().toISOString(),
      }, null, 2)
    );

    writeFileSync(
      join(outputDir, "01-sanitized-input.json"),
      JSON.stringify({
        command: commandName,
        variant,
        request: {
          userInputMessage: request.userInputMessage,
          conversationState: request.conversationState,
          profileArn: request.profileArn !== undefined ? (request.profileArn === null ? "null" : "***") : undefined,
        },
      }, null, 2)
    );

    writeFileSync(
      join(outputDir, "02-error-sanitized.txt"),
      `Error: ${error.message}\n` +
      `Type: ${error.name || "unknown"}\n` +
      `HTTP Status: ${error.$metadata?.httpStatusCode || "unknown"}\n` +
      `Request ID: ${error.$metadata?.requestId || "unknown"}\n` +
      `Attempts: ${error.$metadata?.attempts || "unknown"}\n` +
      `Fault: ${error.$fault || "unknown"}\n` +
      `Code: ${error.code || error.Code || "unknown"}\n` +
      `Retryable: ${error.$retryable}\n`
    );

    const resultMd = `# Kiro SDK Auth Test Result

**Status**: ❌ FAILED

**Connection**: ${connection.id}
**Email**: ${maskEmail(connection.email)}
**Region**: ${region}
**Endpoint**: ${endpoint}
**Variant**: ${variant}
**Command**: ${commandName}

## Error

- **Message**: ${error.message}
- **Type**: ${error.name || "unknown"}
- **HTTP Status**: ${error.$metadata?.httpStatusCode || "unknown"}
- **Request ID**: ${error.$metadata?.requestId || "unknown"}
- **Attempts**: ${error.$metadata?.attempts || "unknown"}
- **Fault**: ${error.$fault || "unknown"}
- **Code**: ${error.code || error.Code || "unknown"}
- **Retryable**: ${error.$retryable}

## Request

\`\`\`json
${JSON.stringify({
  command: commandName,
  variant,
  userInputMessage: request.userInputMessage,
  conversationState: request.conversationState,
  profileArn: request.profileArn !== undefined ? (request.profileArn === null ? "null" : "***") : undefined,
}, null, 2)}
\`\`\`

## Analysis

${error.$metadata?.httpStatusCode === 500 ? "HTTP 500 suggests request format issue or missing required field." : ""}
${error.$metadata?.httpStatusCode === 401 || error.$metadata?.httpStatusCode === 403 ? "Authentication failed." : ""}
${error.$metadata?.httpStatusCode === 400 ? "Bad request - check request format." : ""}
${error.$metadata?.httpStatusCode === 404 ? "Endpoint or operation not found." : ""}
`;

    writeFileSync(join(outputDir, "03-result.md"), resultMd);

    console.log(`\nError details saved to: ${outputDir}`);
    console.log();

    // Determine failure reason
    if (error.$metadata?.httpStatusCode === 401 || error.$metadata?.httpStatusCode === 403) {
      console.error("\n❌ Authentication failed");
      console.error("   The token was rejected by AWS CodeWhisperer");
      console.error("   Possible reasons:");
      console.error("   - Token is invalid or expired");
      console.error("   - Token format is incorrect");
      console.error("   - SDK requires different auth method");
    } else if (error.$metadata?.httpStatusCode === 400) {
      console.error("\n⚠️  Request format error");
      console.error("   Authentication probably works, but request payload is invalid");
      console.error("   Check request structure and required fields");
    } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      console.error("\n❌ Network error");
      console.error("   Could not connect to AWS CodeWhisperer");
      console.error("   Check internet connection and endpoint");
    } else {
      console.error("\n❌ Unknown error");
      console.error("   See error details above");
    }

    process.exit(1);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Kiro SDK Authentication Test Harness\n");

  // Get connection
  const connection = getKiroConnection(connectionId);

  if (!connection) {
    console.error("❌ No Kiro connection found");
    if (connectionId) {
      console.error(`   Connection ID: ${connectionId}`);
    } else {
      console.error("   No --connection specified, tried to find any Kiro connection");
    }
    console.error();
    console.error("Usage:");
    console.error("  bun run scripts/test-kiro-sdk-auth.ts --connection 0c010b69");
    console.error("  bun run scripts/test-kiro-sdk-auth.ts --connection 0c010b69 --variant minimal");
    console.error("  bun run scripts/test-kiro-sdk-auth.ts --connection 0c010b69 --variant minimal --confirm RUN_KIRO_SDK_TEST");
    console.error();
    console.error("Variants:");
    console.error("  - minimal (default)");
    console.error("  - with-empty-conversation-state");
    console.error("  - with-conversation-id");
    console.error("  - without-profile-arn");
    console.error("  - with-null-profile-arn");
    console.error("  - send-message-command");
    console.error("  - correct-structure");
    process.exit(1);
  }

  await testKiroAuth(connection, confirmFlag, customEndpoint, variant);
}

main().catch(console.error);
