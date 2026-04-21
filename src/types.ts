export interface Connection {
  id: string;
  provider: string;        // "qwen" | "openrouter" | "groq" | etc.
  auth_type: string;       // "oauth" | "apikey" | "free"
  email: string | null;
  display_name: string | null;
  // OAuth fields (Qwen and future OAuth providers)
  access_token: string;
  refresh_token: string;
  expires_at: string;
  resource_url: string | null;
  // API Key field
  api_key: string | null;
  // Optional proxy pool assignment
  proxy_pool_id: string | null;
  // Per-provider metadata (JSON): Copilot token, Kiro client creds, GitLab baseUrl, projectId, etc.
  provider_data: string | null;
  priority: number;
  is_active: number;       // SQLite boolean (0/1)
  test_status: string;     // "active" | "unavailable" | "unknown"
  last_error: string | null;
  error_code: number | null;
  last_error_at: string | null;
  backoff_level: number;
  consecutive_use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// Backward-compat alias — existing code that imports QwenAccount keeps working
export type QwenAccount = Connection;

export interface ModelLock {
  id: number;
  account_id: string;
  model: string; // model name or "__all"
  locked_until: string; // ISO timestamp
}

export interface Setting {
  key: string;
  value: string;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  resource_url?: string;
  id_token?: string;
}

export interface RefreshedCredentials {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  resourceUrl?: string;
}

export interface RateLimitedResult {
  allRateLimited: true;
  retryAfter: string;
  retryAfterHuman: string;
}

export function isRateLimitedResult(v: unknown): v is RateLimitedResult {
  return typeof v === "object" && v !== null && "allRateLimited" in v;
}

export interface TemporarilyUnavailableResult {
  allTemporarilyUnavailable: true;
  retryAfter: string;
  retryAfterHuman: string;
}

export function isTemporarilyUnavailableResult(v: unknown): v is TemporarilyUnavailableResult {
  return typeof v === "object" && v !== null && "allTemporarilyUnavailable" in v;
}

export interface FallbackDecision {
  shouldFallback: boolean;
  cooldownMs: number;
  newBackoffLevel?: number;
}
