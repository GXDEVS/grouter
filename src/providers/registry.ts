export type AuthType = "oauth" | "apikey" | "free";
export type ProviderCategory = "oauth" | "free" | "apikey";

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
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
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

  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT (OAuth)",
    description: "ChatGPT Plus/Pro subscription via native OpenAI OAuth — no API key required",
    category: "oauth",
    authType: "oauth",
    color: "#22c55e",
    baseUrl: "https://api.openai.com/v1",
    logo: "/public/logos/chatgpt.png",
    models: [
      { id: "gpt-5.4",      name: "GPT-5.4"      },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
      { id: "gpt-5.2",      name: "GPT-5.2"      },
      { id: "gpt-5",        name: "GPT-5"        },
      { id: "gpt-4o",       name: "GPT-4o"       },
      { id: "gpt-4.1",      name: "GPT-4.1"      },
      { id: "o3",           name: "o3"           },
      { id: "o4-mini",      name: "o4-mini"      },
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
};

export const OAUTH_PROVIDERS  = Object.values(PROVIDERS).filter(p => p.category === "oauth");
export const FREE_PROVIDERS   = Object.values(PROVIDERS).filter(p => p.category === "free");
export const APIKEY_PROVIDERS = Object.values(PROVIDERS).filter(p => p.category === "apikey");

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS[id];
}
