import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

export type AuthType = "oauth" | "apikey" | "free";
export type ProviderCategory = "oauth" | "free" | "apikey";

const CUSTOM_PROVIDERS_PATH = join(homedir(), ".grouter", "custom_providers.json");

export function saveCustomProvider(p: Provider) {
  const dir = dirname(CUSTOM_PROVIDERS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const arr: Provider[] = existsSync(CUSTOM_PROVIDERS_PATH)
    ? JSON.parse(readFileSync(CUSTOM_PROVIDERS_PATH, "utf-8"))
    : [];

  if (!arr.find((x: Provider) => x.id === p.id)) {
    arr.push(p);
    writeFileSync(CUSTOM_PROVIDERS_PATH, JSON.stringify(arr, null, 2));
  }

  // Register in-memory (avoid duplicates)
  PROVIDERS[p.id] = p;
  if (!APIKEY_PROVIDERS.find((x) => x.id === p.id)) {
    APIKEY_PROVIDERS.push(p);
  }
}

function loadCustomProviders(): Record<string, Provider> {
  try {
    if (existsSync(CUSTOM_PROVIDERS_PATH)) {
      const arr = JSON.parse(readFileSync(CUSTOM_PROVIDERS_PATH, "utf-8")) as Provider[];
      const map: Record<string, Provider> = {};
      for (const p of arr) map[p.id] = p;
      return map;
    }
  } catch (err) {
    console.error("Failed to load custom providers:", err);
  }
  return {};
}


export interface ProviderModel {
  id: string;
  name: string;
}

export interface Provider {
  id: string;
  name: string;
  description: string;
  category: ProviderCategory;
  authType: AuthType;
  color: string;
  baseUrl: string;
  apiKeyUrl?: string;
  models: ProviderModel[];
  deprecated?: boolean;
  deprecationReason?: string;
  logo?: string;
  requiresMeta?: { key: string; label: string; placeholder?: string; required?: boolean }[];
  freeTier?: { notice: string; url?: string };
}

export const PROVIDERS: Record<string, Provider> = {

  // ── OAuth Providers ───────────────────────────────────────────────────────────

  qwen: {
    id: "qwen",
    name: "Qwen Code",
    description: "Alibaba Qwen accounts — free via OAuth device flow",
    category: "oauth",
    authType: "oauth",
    color: "#0AB9DC",
    baseUrl: "https://portal.qwen.ai/v1",
    deprecated: true,
    deprecationReason: "Qwen Code Free has been discontinued. Existing accounts continue to work, but new OAuth sign-ups are no longer accepted.",
    logo: "/public/logos/qwen-code.png",
    freeTier: { notice: "Free OAuth device flow — no credit card." },
    models: [
      { id: "qwen3-coder-plus",  name: "Qwen3 Coder Plus"  },
      { id: "qwen3-coder-flash", name: "Qwen3 Coder Flash" },
      { id: "vision-model",      name: "Vision Model"      },
      { id: "coder-model",       name: "Coder Model"       },
    ],
  },

  github: {
    id: "github",
    name: "GitHub Copilot",
    description: "GPT-4o, Claude & Gemini via your GitHub Copilot subscription",
    category: "oauth",
    authType: "oauth",
    color: "#24292f",
    baseUrl: "https://api.githubcopilot.com",
    logo: "/public/logos/github-copilot.png",
    models: [
      { id: "gpt-5",               name: "GPT-5"                },
      { id: "gpt-5-mini",          name: "GPT-5 Mini"           },
      { id: "gpt-5-codex",         name: "GPT-5 Codex"          },
      { id: "gpt-4o",              name: "GPT-4o"               },
      { id: "gpt-4o-mini",         name: "GPT-4o Mini"          },
      { id: "gpt-4.1",             name: "GPT-4.1"              },
      { id: "claude-opus-4.5",     name: "Claude Opus 4.5"      },
      { id: "claude-sonnet-4.5",   name: "Claude Sonnet 4.5"    },
      { id: "claude-haiku-4.5",    name: "Claude Haiku 4.5"     },
      { id: "gemini-2.5-pro",      name: "Gemini 2.5 Pro"       },
      { id: "grok-code-fast-1",    name: "Grok Code Fast 1"     },
    ],
  },

  "kimi-coding": {
    id: "kimi-coding",
    name: "Kimi Coding",
    description: "Moonshot Kimi K2 coding assistant — free via OAuth",
    category: "oauth",
    authType: "oauth",
    color: "#6366f1",
    baseUrl: "https://api.kimi.com/v1",
    logo: "/public/logos/kimi-ai.png",
    freeTier: { notice: "Free OAuth — no credit card." },
    models: [
      { id: "kimi-k2.5",          name: "Kimi K2.5"          },
      { id: "kimi-k2.5-thinking", name: "Kimi K2.5 Thinking" },
      { id: "kimi-latest",        name: "Kimi Latest"        },
    ],
  },

  kilocode: {
    id: "kilocode",
    name: "KiloCode",
    description: "KiloCode cloud inference — free tier via OAuth",
    category: "oauth",
    authType: "oauth",
    color: "#10b981",
    baseUrl: "https://api.kilo.ai/v1",
    logo: "/public/logos/kilo-code.png",
    freeTier: { notice: "Free OAuth sign-up." },
    models: [
      { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "anthropic/claude-opus-4-20250514",   name: "Claude Opus 4"   },
      { id: "google/gemini-2.5-pro",              name: "Gemini 2.5 Pro"  },
      { id: "google/gemini-2.5-flash",            name: "Gemini 2.5 Flash"},
      { id: "openai/gpt-4.1",                     name: "GPT-4.1"         },
      { id: "openai/o3",                          name: "o3"              },
      { id: "deepseek/deepseek-chat",             name: "DeepSeek Chat"   },
      { id: "deepseek/deepseek-reasoner",         name: "DeepSeek Reasoner"},
    ],
  },

  claude: {
    id: "claude",
    name: "Claude (OAuth)",
    description: "Claude.ai subscription via OAuth — no API key required",
    category: "oauth",
    authType: "oauth",
    color: "#d97706",
    baseUrl: "https://api.anthropic.com/v1",
    logo: "/public/logos/claude-code-antrophic.png",
    models: [
      { id: "claude-opus-4-6",           name: "Claude Opus 4.6"   },
      { id: "claude-sonnet-4-6",         name: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-5-20251101",  name: "Claude Opus 4.5"   },
      { id: "claude-sonnet-4-5-20250929",name: "Claude Sonnet 4.5" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5"  },
    ],
  },

  codex: {
    id: "codex",
    name: "OpenAI Codex",
    description: "ChatGPT Plus/Pro subscription via Codex CLI OAuth",
    category: "oauth",
    authType: "oauth",
    color: "#22c55e",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    logo: "/public/logos/codex.png",
    models: [
      { id: "gpt-5.4",                 name: "GPT-5.4"                },
      { id: "gpt-5.3-codex",           name: "GPT-5.3 Codex"          },
      { id: "gpt-5.3-codex-high",      name: "GPT-5.3 Codex (High)"   },
      { id: "gpt-5.2-codex",           name: "GPT-5.2 Codex"          },
      { id: "gpt-5.2",                 name: "GPT-5.2"                },
      { id: "gpt-5.1-codex",           name: "GPT-5.1 Codex"          },
      { id: "gpt-5.1-codex-max",       name: "GPT-5.1 Codex Max"      },
      { id: "gpt-5.1-codex-mini",      name: "GPT-5.1 Codex Mini"     },
      { id: "gpt-5.1",                 name: "GPT-5.1"                },
      { id: "gpt-5-codex",             name: "GPT-5 Codex"            },
    ],
  },

  kiro: {
    id: "kiro",
    name: "Kiro",
    description: "AWS CodeWhisperer via Kiro IDE — AWS Builder ID OAuth",
    category: "oauth",
    authType: "oauth",
    color: "#ff9900",
    baseUrl: "https://codewhisperer.us-east-1.amazonaws.com",
    logo: "/public/logos/Kiro.png",
    freeTier: { notice: "Free AWS Builder ID — no AWS account required." },
    models: [
      { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
      { id: "claude-haiku-4.5",  name: "Claude Haiku 4.5"  },
      { id: "deepseek-3.2",      name: "DeepSeek 3.2"      },
      { id: "deepseek-3.1",      name: "DeepSeek 3.1"      },
      { id: "qwen3-coder-next",  name: "Qwen3 Coder Next"  },
    ],
  },

  iflow: {
    id: "iflow",
    name: "iFlow",
    description: "iFlow OAuth — returns a long-lived API key",
    category: "oauth",
    authType: "oauth",
    color: "#7c3aed",
    baseUrl: "https://api.iflow.cn/v1",
    logo: "/public/logos/iflow.png",
    freeTier: { notice: "Free OAuth sign-up." },
    models: [
      { id: "qwen3-coder-plus",          name: "Qwen3 Coder Plus"         },
      { id: "qwen3-max",                 name: "Qwen3 Max"                },
      { id: "qwen3-vl-plus",             name: "Qwen3 VL Plus"            },
      { id: "qwen3-235b",                name: "Qwen3 235B A22B"          },
      { id: "qwen3-235b-a22b-thinking-2507", name: "Qwen3 235B A22B Thinking" },
      { id: "kimi-k2",                   name: "Kimi K2"                  },
      { id: "deepseek-v3.2",             name: "DeepSeek V3.2 Exp"        },
      { id: "deepseek-v3.1",             name: "DeepSeek V3.1 Terminus"   },
      { id: "deepseek-r1",               name: "DeepSeek R1"              },
      { id: "glm-4.7",                   name: "GLM 4.7"                  },
    ],
  },

  qoder: {
    id: "qoder",
    name: "Qoder",
    description: "Qoder device-token OAuth — returns a long-lived API key",
    category: "oauth",
    authType: "oauth",
    color: "#ec4899",
    baseUrl: "https://api2.qoder.sh/v1",
    logo: "/public/logos/qoder.png",
    models: [
      { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    ],
  },

  cline: {
    id: "cline",
    name: "Cline",
    description: "Cline extension OAuth — browser redirect flow",
    category: "oauth",
    authType: "oauth",
    color: "#0ea5e9",
    baseUrl: "https://api.cline.bot/v1",
    logo: "/public/logos/Cline.png",
    models: [
      { id: "anthropic/claude-sonnet-4.6",            name: "Claude Sonnet 4.6"       },
      { id: "anthropic/claude-opus-4.6",              name: "Claude Opus 4.6"         },
      { id: "openai/gpt-5.3-codex",                   name: "GPT-5.3 Codex"           },
      { id: "openai/gpt-5.4",                         name: "GPT-5.4"                 },
      { id: "google/gemini-3.1-pro-preview",          name: "Gemini 3.1 Pro Preview"  },
      { id: "google/gemini-3.1-flash-lite-preview",   name: "Gemini 3.1 Flash Lite"   },
      { id: "kwaipilot/kat-coder-pro",                name: "KAT Coder Pro"           },
    ],
  },

  cursor: {
    id: "cursor",
    name: "Cursor",
    description: "Paste your Cursor access token (Settings → General → Access Token)",
    category: "oauth",
    authType: "oauth",
    color: "#000000",
    baseUrl: "https://api2.cursor.sh",
    logo: "/public/logos/cursor.png",
    models: [
      { id: "default",                          name: "Auto (Server Picks)"         },
      { id: "claude-4.6-opus-max",              name: "Claude 4.6 Opus Max"         },
      { id: "claude-4.6-sonnet-medium-thinking",name: "Claude 4.6 Sonnet Thinking"  },
      { id: "claude-4.5-opus-high-thinking",    name: "Claude 4.5 Opus Thinking"    },
      { id: "claude-4.5-sonnet",                name: "Claude 4.5 Sonnet"           },
      { id: "claude-4.5-haiku",                 name: "Claude 4.5 Haiku"            },
      { id: "gpt-5.3-codex",                    name: "GPT 5.3 Codex"               },
      { id: "gpt-5.2-codex",                    name: "GPT 5.2 Codex"               },
      { id: "gpt-5.2",                          name: "GPT 5.2"                     },
      { id: "gemini-3-flash-preview",           name: "Gemini 3 Flash Preview"      },
      { id: "kimi-k2.5",                        name: "Kimi K2.5"                   },
    ],
  },

  opencode: {
    id: "opencode",
    name: "OpenCode",
    description: "Public, no-auth free inference endpoint",
    category: "free",
    authType: "oauth",
    color: "#14b8a6",
    baseUrl: "https://opencode.ai/zen/v1",
    logo: "/public/logos/opencode.png",
    models: [
      { id: "default",              name: "OpenCode Default"   },
      { id: "nemotron-3-super-free",name: "Nemotron 3 Super"   },
      { id: "qwen3.6-plus-free",    name: "Qwen 3.6 Plus"      },
      { id: "minimax-m2.5-free",    name: "MiniMax M2.5"       },
      { id: "big-pickle",           name: "Big Pickle"         },
    ],
    freeTier: { notice: "No sign-up required — routes to a shared free pool." },
  },

  "gemini-cli": {
    id: "gemini-cli",
    name: "Gemini CLI (OAuth)",
    description: "Google Gemini subscription via Gemini CLI OAuth — no API key required",
    category: "oauth",
    authType: "oauth",
    color: "#4285f4",
    baseUrl: "https://cloudcode-pa.googleapis.com/v1internal",
    logo: "/public/logos/Gemini-CLI.png",
    models: [
      { id: "gemini-2.5-pro",                name: "Gemini 2.5 Pro"         },
      { id: "gemini-2.5-flash",              name: "Gemini 2.5 Flash"       },
      { id: "gemini-3.1-pro-preview",        name: "Gemini 3.1 Pro Preview" },
      { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite"  },
      { id: "gemini-3-flash-preview",        name: "Gemini 3 Flash Preview" },
      { id: "gemini-2.0-flash",              name: "Gemini 2.0 Flash"       },
    ],
  },

  gitlab: {
    id: "gitlab",
    name: "GitLab Duo",
    description: "GitLab Duo OAuth — bring your own GitLab OAuth app",
    category: "oauth",
    authType: "oauth",
    color: "#fc6d26",
    baseUrl: "https://gitlab.com/api/v4",
    logo: "/public/logos/Gitlab.png",
    models: [
      { id: "duo-chat", name: "Duo Chat" },
    ],
    requiresMeta: [
      { key: "baseUrl",      label: "GitLab URL",      placeholder: "https://gitlab.com",           required: true },
      { key: "clientId",     label: "Client ID",       placeholder: "Application ID",               required: true },
      { key: "clientSecret", label: "Client Secret",   placeholder: "(optional for public clients)", required: false },
    ],
  },

  // ── API Key Providers ─────────────────────────────────────────────────────────

  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    description: "Access 300+ models from a single API key",
    category: "apikey",
    authType: "apikey",
    color: "#6366f1",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyUrl: "https://openrouter.ai/keys",
    logo: "/public/logos/openrouter.png",
    freeTier: { notice: "27+ free models, ~200 req/day on the free tier.", url: "https://openrouter.ai/models?q=free" },
    models: [
      { id: "anthropic/claude-opus-4-5",          name: "Claude Opus 4.5"     },
      { id: "anthropic/claude-sonnet-4-5",         name: "Claude Sonnet 4.5"   },
      { id: "openai/gpt-4o",                       name: "GPT-4o"              },
      { id: "google/gemini-2.5-pro",               name: "Gemini 2.5 Pro"      },
      { id: "deepseek/deepseek-r1",                name: "DeepSeek R1"         },
      { id: "meta-llama/llama-3.3-70b-instruct",   name: "Llama 3.3 70B"       },
    ],
  },

  groq: {
    id: "groq",
    name: "Groq",
    description: "Ultra-fast inference with LPU technology",
    category: "apikey",
    authType: "apikey",
    color: "#f97316",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyUrl: "https://console.groq.com/keys",
    logo: "/public/logos/groq.png",
    models: [
      { id: "llama-3.3-70b-versatile",                       name: "Llama 3.3 70B"   },
      { id: "meta-llama/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick"},
      { id: "qwen/qwen3-32b",                                name: "Qwen3 32B"       },
      { id: "openai/gpt-oss-120b",                           name: "GPT-OSS 120B"    },
    ],
  },

  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    description: "High-performance reasoning and coding models",
    category: "apikey",
    authType: "apikey",
    color: "#3b82f6",
    baseUrl: "https://api.deepseek.com",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    logo: "/public/logos/Deepseek.png",
    models: [
      { id: "deepseek-chat",     name: "DeepSeek V3.2 Chat"     },
      { id: "deepseek-reasoner", name: "DeepSeek V3.2 Reasoner" },
    ],
  },

  openai: {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o, o3, o4-mini and the latest OpenAI models",
    category: "apikey",
    authType: "apikey",
    color: "#22c55e",
    baseUrl: "https://api.openai.com/v1",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    logo: "/public/logos/chatgpt.png",
    models: [
      { id: "gpt-5.4",      name: "GPT-5.4"      },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
      { id: "gpt-5.2",      name: "GPT-5.2"      },
      { id: "gpt-5",        name: "GPT-5"        },
      { id: "gpt-5-mini",   name: "GPT-5 Mini"   },
      { id: "gpt-4o",       name: "GPT-4o"       },
      { id: "gpt-4o-mini",  name: "GPT-4o Mini"  },
      { id: "gpt-4.1",      name: "GPT-4.1"      },
      { id: "o3",           name: "o3"           },
      { id: "o4-mini",      name: "o4-mini"      },
    ],
  },

  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Opus 4.5, Sonnet 4.5 and Haiku 4.5",
    category: "apikey",
    authType: "apikey",
    color: "#d97706",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    logo: "/public/logos/claude-code-antrophic.png",
    models: [
      { id: "claude-opus-4-6",            name: "Claude Opus 4.6"   },
      { id: "claude-sonnet-4-6",          name: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-5-20251101",   name: "Claude Opus 4.5"   },
      { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5" },
      { id: "claude-haiku-4-5-20251001",  name: "Claude Haiku 4.5"  },
    ],
  },

  gemini: {
    id: "gemini",
    name: "Google Gemini",
    description: "Gemini 2.5 Pro, Flash and the latest Google models",
    category: "apikey",
    authType: "apikey",
    color: "#4285f4",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    logo: "/public/logos/Gemini-CLI.png",
    freeTier: { notice: "Free tier via AI Studio key — Gemini 2.5 Pro/Flash rate-limited but usable.", url: "https://aistudio.google.com/app/apikey" },
    models: [
      { id: "gemini-3.1-pro-preview",         name: "Gemini 3.1 Pro Preview" },
      { id: "gemini-3.1-flash-lite-preview",  name: "Gemini 3.1 Flash Lite"  },
      { id: "gemini-3-flash-preview",         name: "Gemini 3 Flash Preview" },
      { id: "gemini-2.5-pro",                 name: "Gemini 2.5 Pro"         },
      { id: "gemini-2.5-flash",               name: "Gemini 2.5 Flash"       },
      { id: "gemini-2.0-flash",               name: "Gemini 2.0 Flash"       },
    ],
  },

  nvidia: {
    id: "nvidia",
    name: "NVIDIA NIM",
    description: "GPU-accelerated AI microservices from NVIDIA",
    category: "apikey",
    authType: "apikey",
    color: "#76b900",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyUrl: "https://build.nvidia.com/",
    logo: "/public/logos/nvidia-nim.png",
    freeTier: { notice: "Free for NVIDIA Developer Program members.", url: "https://build.nvidia.com/" },
    models: [
      { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5" },
      { id: "z-ai/glm4.7",          name: "GLM 4.7"   },
    ],
  },

  ollama: {
    id: "ollama",
    name: "Ollama Cloud",
    description: "Ollama-hosted cloud inference — free tier via API key",
    category: "apikey",
    authType: "apikey",
    color: "#ffffff",
    baseUrl: "https://ollama.com/v1",
    apiKeyUrl: "https://ollama.com/settings/keys",
    logo: "/public/logos/ollama-cloud.png",
    freeTier: { notice: "Free tier: light usage, 1 cloud model at a time (limits reset every 5h & 7d).", url: "https://ollama.com/settings/keys" },
    models: [
      { id: "cogito-2.1:671b",           name: "Cogito 2.1 671B"              },
      { id: "deepseek-v3.1:671b",        name: "DeepSeek V3.1 671B"           },
      { id: "deepseek-v3.2",             name: "DeepSeek V3.2"                },
      { id: "devstral-2:123b",           name: "Devstral 2 123B"              },
      { id: "devstral-small-2:24b",      name: "Devstral Small 2 24B"         },
      { id: "gemini-3-flash-preview",    name: "Gemini 3 Flash Preview"       },
      { id: "gemma3:12b",                name: "Gemma 3 12B"                  },
      { id: "gemma3:27b",                name: "Gemma 3 27B"                  },
      { id: "gemma3:4b",                 name: "Gemma 3 4B"                   },
      { id: "gemma4:31b",                name: "Gemma 4 31B"                  },
      { id: "glm-4.6",                   name: "GLM 4.6"                      },
      { id: "glm-5",                     name: "GLM 5"                        },
      { id: "gpt-oss:120b",              name: "GPT-OSS 120B"                 },
      { id: "gpt-oss:20b",               name: "GPT-OSS 20B"                  },
      { id: "kimi-k2-thinking",          name: "Kimi K2 Thinking"             },
      { id: "kimi-k2.5",                 name: "Kimi K2.5"                    },
      { id: "kimi-k2:1t",                name: "Kimi K2 1T"                   },
      { id: "minimax-m2",                name: "MiniMax M2"                   },
      { id: "minimax-m2.1",              name: "MiniMax M2.1"                 },
      { id: "minimax-m2.5",              name: "MiniMax M2.5"                 },
      { id: "minimax-m2.7",              name: "MiniMax M2.7"                 },
      { id: "ministral-3:14b",           name: "Ministral 3 14B"              },
      { id: "ministral-3:3b",            name: "Ministral 3 3B"               },
      { id: "ministral-3:8b",            name: "Ministral 3 8B"               },
      { id: "mistral-large-3:675b",      name: "Mistral Large 3 675B"         },
      { id: "nemotron-3-nano:30b",       name: "Nemotron 3 Nano 30B"          },
      { id: "nemotron-3-super",          name: "Nemotron 3 Super"             },
      { id: "qwen3-coder-next",          name: "Qwen3 Coder Next"             },

      { id: "qwen3-coder:480b",          name: "Qwen3 Coder 480B"             },
      { id: "qwen3-next:80b",            name: "Qwen3 Next 80B"               },
      { id: "qwen3-vl:235b",             name: "Qwen3 VL 235B"                },
      { id: "qwen3-vl:235b-instruct",    name: "Qwen3 VL 235B Instruct"       },
      { id: "qwen3.5:397b",              name: "Qwen3.5 397B"                 },
      { id: "rnj-1:8b",                  name: "RNJ 1 8B"                     },
    ],
  },

  modal: {
    id: "modal",
    name: "Modal",
    logo: "data:image/svg+xml,%3csvg%20width='368'%20height='192'%20viewBox='0%200%20368%20192'%20fill='none'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M148.873%204L183.513%2064L111.922%20188C110.492%20190.47%20107.853%20192%20104.993%20192H40.3325C38.9025%20192%2037.5325%20191.62%2036.3325%20190.93C35.1325%20190.24%2034.1226%20189.24%2033.4026%20188L1.0725%20132C-0.3575%20129.53%20-0.3575%20126.48%201.0725%20124L70.3625%204C71.0725%202.76%2072.0925%201.76001%2073.2925%201.07001C74.4925%200.380007%2075.8625%200%2077.2925%200H141.952C144.812%200%20147.453%201.53%20148.883%204H148.873ZM365.963%20124L296.672%204C295.962%202.76%20294.943%201.76001%20293.743%201.07001C292.543%200.380007%20291.173%200%20289.743%200H225.083C222.223%200%20219.583%201.53%20218.153%204L183.513%2064L255.103%20188C256.533%20190.47%20259.173%20192%20262.033%20192H326.693C328.122%20192%20329.492%20191.62%20330.693%20190.93C331.893%20190.24%20332.902%20189.24%20333.622%20188L365.953%20132C367.383%20129.53%20367.383%20126.48%20365.953%20124H365.963Z'%20fill='%2362DE61'/%3e%3cpath%20d='M109.623%2064H183.523L148.883%204C147.453%201.53%20144.813%200%20141.953%200H77.2925C75.8625%200%2074.4925%200.380007%2073.2925%201.07001L109.623%2064Z'%20fill='url(%23paint0_linear_342_139)'/%3e%3cpath%20d='M109.623%2064L73.2925%201.07001C72.0925%201.76001%2071.0825%202.76%2070.3625%204L1.0725%20124C-0.3575%20126.48%20-0.3575%20129.52%201.0725%20132L33.4026%20188C34.1126%20189.24%2035.1325%20190.24%2036.3325%20190.93L109.613%2064H109.623Z'%20fill='url(%23paint1_linear_342_139)'/%3e%3cpath%20d='M183.513%2064H109.613L36.3325%20190.93C37.5325%20191.62%2038.9025%20192%2040.3325%20192H104.993C107.853%20192%20110.492%20190.47%20111.922%20188L183.513%2064Z'%20fill='%2309AF58'/%3e%3cpath%20d='M365.963%20132C366.673%20130.76%20367.033%20129.38%20367.033%20128H294.372L258.042%20190.93C259.242%20191.62%20260.612%20192%20262.042%20192H326.703C329.563%20192%20332.202%20190.47%20333.632%20188L365.963%20132Z'%20fill='%2309AF58'/%3e%3cpath%20d='M225.083%200C223.653%200%20222.283%200.380007%20221.083%201.07001L294.362%20128H367.023C367.023%20126.62%20366.663%20125.24%20365.953%20124L296.672%204C295.242%201.53%20292.603%200%20289.743%200H225.073H225.083Z'%20fill='url(%23paint2_linear_342_139)'/%3e%3cpath%20d='M258.033%20190.93L294.362%20128L221.083%201.07001C219.883%201.76001%20218.873%202.76%20218.153%204L183.513%2064L255.103%20188C255.813%20189.24%20256.833%20190.24%20258.033%20190.93Z'%20fill='url(%23paint3_linear_342_139)'/%3e%3cdefs%3e%3clinearGradient%20id='paint0_linear_342_139'%20x1='155.803'%20y1='80'%20x2='101.003'%20y2='-14.93'%20gradientUnits='userSpaceOnUse'%3e%3cstop%20stop-color='%23BFF9B4'/%3e%3cstop%20offset='1'%20stop-color='%2380EE64'/%3e%3c/linearGradient%3e%3clinearGradient%20id='paint1_linear_342_139'%20x1='8.62251'%20y1='174.93'%20x2='100.072'%20y2='16.54'%20gradientUnits='userSpaceOnUse'%3e%3cstop%20stop-color='%2380EE64'/%3e%3cstop%20offset='0.18'%20stop-color='%237BEB63'/%3e%3cstop%20offset='0.36'%20stop-color='%236FE562'/%3e%3cstop%20offset='0.55'%20stop-color='%235ADA60'/%3e%3cstop%20offset='0.74'%20stop-color='%233DCA5D'/%3e%3cstop%20offset='0.93'%20stop-color='%2318B759'/%3e%3cstop%20offset='1'%20stop-color='%2309AF58'/%3e%3c/linearGradient%3e%3clinearGradient%20id='paint2_linear_342_139'%20x1='340.243'%20y1='143.46'%20x2='248.793'%20y2='-14.93'%20gradientUnits='userSpaceOnUse'%3e%3cstop%20stop-color='%23BFF9B4'/%3e%3cstop%20offset='1'%20stop-color='%2380EE64'/%3e%3c/linearGradient%3e%3clinearGradient%20id='paint3_linear_342_139'%20x1='284.822'%20y1='175.47'%20x2='193.372'%20y2='17.0701'%20gradientUnits='userSpaceOnUse'%3e%3cstop%20stop-color='%2380EE64'/%3e%3cstop%20offset='0.18'%20stop-color='%237BEB63'/%3e%3cstop%20offset='0.36'%20stop-color='%236FE562'/%3e%3cstop%20offset='0.55'%20stop-color='%235ADA60'/%3e%3cstop%20offset='0.74'%20stop-color='%233DCA5D'/%3e%3cstop%20offset='0.93'%20stop-color='%2318B759'/%3e%3cstop%20offset='1'%20stop-color='%2309AF58'/%3e%3c/linearGradient%3e%3c/defs%3e%3c/svg%3e",
    description: "Modal serverless GPU inference — OpenAI-compatible API",
    category: "free",
    authType: "apikey",
    color: "#06b6d4",
    baseUrl: "https://api.us-west-2.modal.direct/v1",
    apiKeyUrl: "",
    freeTier: { notice: "Free tier available — GPU-accelerated serverless inference." },
    models: [
      { id: "glm-5", name: "GLM-5" }
    ],
  },

  custom: {
    id: "custom",
    name: "Custom / Build Your Own",
    description: "Add a generic OpenAI-compatible API",
    category: "apikey",
    authType: "apikey",
    color: "#94a3b8",
    baseUrl: "",
    apiKeyUrl: "",
    models: [
      { id: "default", name: "Default" }
    ]
  }
};

Object.assign(PROVIDERS, loadCustomProviders());

export const OAUTH_PROVIDERS  = Object.values(PROVIDERS).filter(p => p.category === "oauth");
export const FREE_PROVIDERS   = Object.values(PROVIDERS).filter(p => p.category === "free");
export const APIKEY_PROVIDERS = Object.values(PROVIDERS).filter(p => p.category === "apikey");

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS[id];
}
