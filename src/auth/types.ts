export type OAuthFlow =
  | "device_code"
  | "authorization_code"
  | "authorization_code_pkce"
  | "import_token";

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export interface RawTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  resource_url?: string;
  [k: string]: unknown;
}

export interface NormalizedTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: string;
  email?: string | null;
  displayName?: string | null;
  apiKey?: string | null;
  resourceUrl?: string | null;
  providerData?: Record<string, unknown> | null;
}

export interface AuthorizeUrlResult {
  authUrl: string;
  state: string;
  redirectUri: string;
  codeVerifier?: string;
  fixedPort?: number;
  callbackPath?: string;
}

export interface PendingSessionData {
  providerId: string;
  flow: OAuthFlow;
  createdAt: number;
  expiresAt: number;
  codeVerifier?: string;
  deviceCode?: string;
  state?: string;
  redirectUri?: string;
  extra?: Record<string, unknown>;
}

export interface OAuthAdapter {
  id: string;
  flow: OAuthFlow;

  // Device-code flow
  startDevice?(opts?: { codeVerifier?: string }): Promise<{
    device: DeviceStart;
    codeVerifier?: string;
    extra?: Record<string, unknown>;
  }>;
  pollDevice?(session: PendingSessionData): Promise<
    | { status: "pending" }
    | { status: "slow_down"; interval?: number }
    | { status: "denied" }
    | { status: "expired" }
    | { status: "error"; message: string }
    | { status: "complete"; tokens: NormalizedTokens }
  >;

  // Authorization-code flow
  buildAuthUrl?(opts: {
    redirectUri: string;
    state: string;
    codeChallenge?: string;
    meta?: Record<string, unknown>;
  }): string;
  exchangeCode?(opts: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
    state?: string;
    meta?: Record<string, unknown>;
  }): Promise<NormalizedTokens>;

  // Import-token flow (Cursor, Kiro-import, etc.)
  importToken?(input: string, meta?: Record<string, unknown>): Promise<NormalizedTokens>;

  // Refresh (optional — some providers have no refresh)
  refresh?(account: {
    refreshToken: string | null;
    providerData?: Record<string, unknown> | null;
  }): Promise<NormalizedTokens | null>;

  // Fixed local callback port (e.g. codex = 1455). If unset, an ephemeral port is chosen.
  fixedPort?: number;
  callbackPath?: string;
  callbackHost?: string;
}
