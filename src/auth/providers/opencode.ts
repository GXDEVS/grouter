import type { OAuthAdapter, NormalizedTokens } from "../types.ts";

// OpenCode is a public, no-auth free endpoint. The "import" action here simply
// registers a sentinel connection so the rotator can route to it.

export const opencodeAdapter: OAuthAdapter = {
  id: "opencode",
  flow: "import_token",

  async importToken() {
    return {
      accessToken: "public",
      refreshToken: null,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      email: "public@opencode.ai",
      displayName: "OpenCode (public)",
      providerData: { authMethod: "public" },
    } satisfies NormalizedTokens;
  },
};
