function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function buildCorsHeaders(allowedHeaders = "Content-Type, Authorization"): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": allowedHeaders,
  };

  const allowAll = isTruthyEnv(process.env.GROUTER_CORS_ALLOW_ALL);
  const allowOrigin = (process.env.GROUTER_CORS_ALLOW_ORIGIN ?? "").trim();

  // Secure by default: do not emit an allow-origin header unless explicitly configured.
  if (allowAll) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
    headers.Vary = "Origin";
  }

  return headers;
}
