import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getProxyPort } from "../db/index.ts";
import { getProviderPort } from "../db/ports.ts";
import { errorResponse, json } from "./api-http.ts";

export interface CLIStatus {
  id: string;
  name: string;
  command: string;
  configPath: string;
  isConfigured: boolean;
  activeProvider: string | null;
  activeModel: string | null;
  targetUrl: string | null;
}

// ── Claude Code (Official Anthropic) ──────────────────────────────────────────

function getOpenclaudePath(): string {
  const dir = process.platform === "win32" ? ".openclaude" : ".claude";
  return join(homedir(), dir, "settings.json");
}

function getClaudeCodeStatus(): CLIStatus {
  const p = getOpenclaudePath();
  let isConfigured = false;
  let activeProvider: string | null = null;
  let activeModel: string | null = null;
  let targetUrl: string | null = null;

  if (existsSync(p)) {
    try {
      const data = JSON.parse(readFileSync(p, "utf8"));
      const env = data.env || {};
      if (env.ANTHROPIC_BASE_URL) {
        isConfigured = true;
        targetUrl = env.ANTHROPIC_BASE_URL || null;
        if (env.ANTHROPIC_AUTH_TOKEN) {
          const match = env.ANTHROPIC_AUTH_TOKEN.match(/grouter-([a-z0-9_-]+)/i);
          activeProvider = match ? match[1] : "router";
        }
      }
    } catch {}
  }

  return {
    id: "claude",
    name: "Claude Code",
    command: "grouter up claude",
    configPath: p.replace(homedir(), "~"),
    isConfigured,
    activeProvider,
    activeModel,
    targetUrl,
  };
}

// ── OpenClaude ────────────────────────────────────────────────────────────────

function getOpenclaudeStatus(): CLIStatus {
  const p = getOpenclaudePath();
  let isConfigured = false;
  let activeProvider: string | null = null;
  let activeModel: string | null = null;
  let targetUrl: string | null = null;

  if (existsSync(p)) {
    try {
      const data = JSON.parse(readFileSync(p, "utf8"));
      const env = data.env || {};
      if (env.CLAUDE_CODE_USE_OPENAI === "1" || env.OPENAI_BASE_URL) {
        isConfigured = true;
        activeModel = env.OPENAI_MODEL || null;
        targetUrl = env.OPENAI_BASE_URL || null;
        if (env.OPENAI_BASE_URL) {
          const match = env.OPENAI_BASE_URL.match(/grouter-([a-z0-9_-]+)/i);
          activeProvider = match ? match[1] : "router";
        }
      }
    } catch {}
  }

  return {
    id: "openclaude",
    name: "OpenClaude",
    command: "grouter up openclaude",
    configPath: p.replace(homedir(), "~"),
    isConfigured,
    activeProvider,
    activeModel,
    targetUrl,
  };
}

// ── OpenClaw ──────────────────────────────────────────────────────────────────

function getOpenclawPath(): string {
  const override = process.env.OPENCLAW_CONFIG_PATH;
  if (override) return override;
  const home = process.env.OPENCLAW_HOME ?? join(homedir(), ".openclaw");
  return join(home, "openclaw.json");
}

function getOpenclawStatus(): CLIStatus {
  const p = getOpenclawPath();
  let isConfigured = false;
  let activeProvider: string | null = null;
  let activeModel: string | null = null;
  let targetUrl: string | null = null;

  if (existsSync(p)) {
    try {
      const data = JSON.parse(readFileSync(p, "utf8"));
      const prov = data.models?.providers?.grouter;
      if (prov) {
        isConfigured = true;
        activeModel = data.agents?.defaults?.model?.primary?.replace("grouter/", "") || (prov.models?.[0]?.id ?? null);
        targetUrl = prov.baseUrl || null;
        if (prov.apiKey) {
          const match = prov.apiKey.match(/grouter-([a-z0-9_-]+)/i);
          activeProvider = match ? match[1] : "router";
        }
      }
    } catch {}
  }

  return {
    id: "openclaw",
    name: "OpenClaw CLI",
    command: "grouter up openclaw",
    configPath: p.replace(homedir(), "~"),
    isConfigured,
    activeProvider,
    activeModel,
    targetUrl,
  };
}

// ── OpenCode ──────────────────────────────────────────────────────────────────

function getOpencodePath(): string {
  const override = process.env.OPENCODE_CONFIG;
  if (override) return override;
  return join(homedir(), ".config", "opencode", "opencode.json");
}

function getOpencodeStatus(): CLIStatus {
  const p = getOpencodePath();
  let isConfigured = false;
  let activeProvider: string | null = null;
  let activeModel: string | null = null;
  let targetUrl: string | null = null;

  if (existsSync(p)) {
    try {
      const data = JSON.parse(readFileSync(p, "utf8"));
      const prov = data.provider?.grouter;
      if (prov) {
        isConfigured = true;
        activeModel = prov.models ? Object.keys(prov.models)[0] || null : null;
        targetUrl = prov.options?.baseURL || null;
        if (prov.options?.apiKey) {
          const match = prov.options.apiKey.match(/grouter-([a-z0-9_-]+)/i);
          activeProvider = match ? match[1] : "router";
        }
      }
    } catch {}
  }

  return {
    id: "opencode",
    name: "OpenCode (sst)",
    command: "grouter up opencode",
    configPath: p.replace(homedir(), "~"),
    isConfigured,
    activeProvider,
    activeModel,
    targetUrl,
  };
}

// ── Cline ─────────────────────────────────────────────────────────────────────

function getClineStatus(): CLIStatus {
  const p = join(homedir(), ".config", "cline");
  const hasConfigDir = existsSync(p);
  const hasBinary = Boolean(Bun.which("cline"));
  return {
    id: "cline",
    name: "Cline CLI & Extension",
    command: "grouter up cline",
    configPath: "~/.config/cline",
    isConfigured: hasConfigDir || hasBinary,
    activeProvider: null,
    activeModel: null,
    targetUrl: null,
  };
}

// ── Route Handlers ───────────────────────────────────────────────────────────

export function handleGetCLIStatus(): Response {
  const statusList = [
    getClaudeCodeStatus(),
    getOpenclaudeStatus(),
    getOpenclawStatus(),
    getOpencodeStatus(),
    getClineStatus(),
  ];
  return json({ tools: statusList });
}

export async function handleSetupCLI(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { toolId?: string; providerId?: string; model?: string; port?: number };
    const toolId = body.toolId;
    const providerId = body.providerId || null;
    const model = body.model || "default";

    if (!toolId) {
      return errorResponse(400, "toolId is required");
    }

    const routerPort = getProxyPort();
    let port = body.port || routerPort;
    if (providerId && providerId !== "custom" && providerId !== "router" && !body.port) {
      const pPort = getProviderPort(providerId);
      if (pPort) port = pPort;
    }

    const targetUrl = `http://127.0.0.1:${port}/v1`;
    const apiKey = providerId && providerId !== "router" ? `grouter-${providerId}` : "grouter";

    if (toolId === "claude" || toolId === "claudecode") {
      const p = getOpenclaudePath();
      const dir = join(p, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      let data: any = {};
      if (existsSync(p)) {
        try { data = JSON.parse(readFileSync(p, "utf8")); } catch {}
      }
      data.env = {
        ...(data.env || {}),
        ANTHROPIC_BASE_URL: targetUrl,
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_API_KEY: "",
      };
      writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
    } else if (toolId === "openclaude") {
      const p = getOpenclaudePath();
      const dir = join(p, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      let data: any = {};
      if (existsSync(p)) {
        try { data = JSON.parse(readFileSync(p, "utf8")); } catch {}
      }
      data.env = {
        ...(data.env || {}),
        CLAUDE_CODE_USE_OPENAI: "1",
        OPENAI_BASE_URL: targetUrl,
        OPENAI_API_KEY: apiKey,
        OPENAI_MODEL: model,
      };
      writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
    } else if (toolId === "openclaw") {
      const p = getOpenclawPath();
      const dir = join(p, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      let data: any = {};
      if (existsSync(p)) {
        try { data = JSON.parse(readFileSync(p, "utf8")); } catch {}
      }
      if (!data.models) data.models = {};
      if (!data.models.providers) data.models.providers = {};
      data.models.providers.grouter = {
        baseUrl: targetUrl,
        apiKey: apiKey,
        auth: "api-key",
        api: "openai-completions",
        models: [{ id: model, name: model }],
      };
      if (!data.agents) data.agents = {};
      if (!data.agents.defaults) data.agents.defaults = {};
      if (!data.agents.defaults.model) data.agents.defaults.model = {};
      data.agents.defaults.model.primary = `grouter/${model}`;
      writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
    } else if (toolId === "opencode") {
      const p = getOpencodePath();
      const dir = join(p, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      let data: any = {};
      if (existsSync(p)) {
        try { data = JSON.parse(readFileSync(p, "utf8")); } catch {}
      }
      if (!data.provider) data.provider = {};
      data.provider.grouter = {
        npm: "@ai-sdk/openai-compatible",
        name: "Grouter",
        options: { baseURL: targetUrl, apiKey: apiKey },
        models: { [model]: { name: model } },
      };
      writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
    } else if (toolId === "cline") {
      let note = "";
      try {
        const res = spawnSync("cline", ["auth", "-p", "openai", "-k", apiKey, "-b", targetUrl, "-m", model], { encoding: "utf8" });
        if (res.error || res.status !== 0) {
          note = ` (CLI cline não detectada no PATH — configure no VSCode com Base URL: ${targetUrl})`;
        }
      } catch {
        note = ` (Base URL configurada para: ${targetUrl})`;
      }
      return json({ ok: true, message: `Cline configurado com sucesso!${note}` });
    }

    return json({ ok: true, message: `Ferramenta ${toolId} configurada com sucesso para ${targetUrl}` });
  } catch (err: any) {
    return errorResponse(500, err.message || "Falha na configuração da CLI");
  }
}

export async function handleRemoveCLI(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { toolId?: string };
    const toolId = body.toolId;
    if (!toolId) {
      return errorResponse(400, "toolId is required");
    }

    if (toolId === "claude" || toolId === "claudecode") {
      const p = getOpenclaudePath();
      if (existsSync(p)) {
        try {
          const data = JSON.parse(readFileSync(p, "utf8"));
          if (data.env) {
            delete data.env.ANTHROPIC_BASE_URL;
            delete data.env.ANTHROPIC_AUTH_TOKEN;
            delete data.env.ANTHROPIC_API_KEY;
            if (Object.keys(data.env).length === 0) delete data.env;
            writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
          }
        } catch {}
      }
    } else if (toolId === "openclaude") {
      const p = getOpenclaudePath();
      if (existsSync(p)) {
        try {
          const data = JSON.parse(readFileSync(p, "utf8"));
          if (data.env) {
            delete data.env.CLAUDE_CODE_USE_OPENAI;
            delete data.env.OPENAI_BASE_URL;
            delete data.env.OPENAI_API_KEY;
            delete data.env.OPENAI_MODEL;
            if (Object.keys(data.env).length === 0) delete data.env;
            writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
          }
        } catch {}
      }
    } else if (toolId === "openclaw") {
      const p = getOpenclawPath();
      if (existsSync(p)) {
        try {
          const data = JSON.parse(readFileSync(p, "utf8"));
          if (data.models?.providers?.grouter) {
            delete data.models.providers.grouter;
            writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
          }
        } catch {}
      }
    } else if (toolId === "opencode") {
      const p = getOpencodePath();
      if (existsSync(p)) {
        try {
          const data = JSON.parse(readFileSync(p, "utf8"));
          if (data.provider?.grouter) {
            delete data.provider.grouter;
            writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
          }
        } catch {}
      }
    }

    return json({ ok: true, message: `Integração removida para ${toolId}` });
  } catch (err: any) {
    return errorResponse(500, err.message || "Falha ao remover integração da CLI");
  }
}
