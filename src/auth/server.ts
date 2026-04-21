// Ephemeral HTTP listener that captures ?code=&state= from an OAuth redirect.
// Used by authorization-code flows (Claude, Codex, GitLab, iFlow, etc.).

const DEFAULT_PATH = "/callback";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const AUTO_CLEANUP_MS = DEFAULT_TIMEOUT_MS + 60 * 1000; // Keep alive longer than wait() timeout

export interface CallbackCapture {
  code: string | null;
  state: string | null;
  error: string | null;
  url: URL;
}

export interface CallbackListener {
  /** URL the provider should redirect to (for example http://localhost:PORT/callback). */
  redirectUri: string;
  /** Port the server is listening on. */
  port: number;
  /** Resolves on first callback hit. Rejects on timeout. */
  wait(timeoutMs?: number): Promise<CallbackCapture>;
  /** Closes the server and cleans up resources. Safe to call multiple times. */
  close(): void;
}

/**
 * Starts an ephemeral HTTP server to capture OAuth callbacks.
 *
 * Features:
 * - Auto-cleanup shortly after the default wait timeout (safety net if caller forgets close)
 * - Idempotent close() - safe to call multiple times
 * - Both wait() timeout and auto-cleanup run in parallel
 *
 * @param options.port - Fixed port (e.g. 1455 for Codex), 0 for ephemeral
 * @param options.path - Callback path, default "/callback"
 */
export function startCallbackListener(options?: {
  port?: number;              // fixed port (e.g. 1455 for codex); 0 = ephemeral
  path?: string;              // default "/callback"
  redirectHost?: string;      // public callback host shown to the provider/browser
}): CallbackListener {
  const path = options?.path ?? DEFAULT_PATH;
  const redirectHost = options?.redirectHost ?? "127.0.0.1";
  // `localhost` can resolve to IPv4 or IPv6 depending on OS/browser.
  // Bind dual-stack in that case to avoid callback refusal on one family.
  const bindHost = redirectHost === "localhost" ? "::" : redirectHost;

  let resolver: ((cap: CallbackCapture) => void) | null = null;
  let closed = false;
  let autoCleanupTimer: ReturnType<typeof setTimeout> | null = null;

  const server = Bun.serve({
    port: options?.port ?? 0,
    hostname: bindHost,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== path) {
        return new Response("Not found", { status: 404 });
      }
      const capture: CallbackCapture = {
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
        error: url.searchParams.get("error"),
        url,
      };

      const html = capture.error
        ? `<html><body style="font-family:system-ui;padding:40px;background:#0d0f13;color:#eee"><h2>Authorization failed</h2><pre>${escape(capture.error)}</pre><p>You can close this tab and return to the app.</p></body></html>`
        : `<html><body style="font-family:system-ui;padding:40px;background:#0d0f13;color:#eee"><h2>Authorization complete</h2><p>This tab can be closed now.</p><script>setTimeout(() => { try { if (window.opener && !window.opener.closed) window.opener.focus(); } catch {} try { window.close(); } catch {} }, 300);</script></body></html>`;

      // Give the browser a tiny head-start to receive the response before cleanup.
      setTimeout(() => resolver?.(capture), 75);
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });

  const port = server.port ?? options?.port ?? 0;
  const redirectUri = `http://${redirectHost}:${port}${path}`;

  // Auto-cleanup timer - safety net in case caller forgets to close()
  autoCleanupTimer = setTimeout(() => {
    if (!closed) {
      closed = true;
      try { server.stop(false); } catch { /* ignore */ }
    }
  }, AUTO_CLEANUP_MS);

  return {
    redirectUri,
    port,
    wait(timeoutMs = DEFAULT_TIMEOUT_MS) {
      return new Promise<CallbackCapture>((res, rej) => {
        resolver = res;
        const t = setTimeout(() => {
          if (!closed) rej(new Error("Callback timeout"));
        }, timeoutMs);
        // clear timer on resolve
        const orig = resolver;
        resolver = (cap) => { clearTimeout(t); orig(cap); };
      });
    },
    close() {
      if (closed) return;
      closed = true;
      if (autoCleanupTimer) {
        clearTimeout(autoCleanupTimer);
        autoCleanupTimer = null;
      }
      try { server.stop(false); } catch { /* ignore */ }
    },
  };
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
