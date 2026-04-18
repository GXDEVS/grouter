// Ephemeral HTTP listener that captures ?code=&state= from an OAuth redirect.
// Used by authorization-code flows (Claude, Codex, GitLab, iFlow, etc.).

const DEFAULT_PATH = "/callback";

export interface CallbackCapture {
  code: string | null;
  state: string | null;
  error: string | null;
  url: URL;
}

export interface CallbackListener {
  /** URL the provider should redirect to (http://127.0.0.1:PORT/callback). */
  redirectUri: string;
  /** Resolves on first callback hit. Rejects on timeout. */
  wait(timeoutMs?: number): Promise<CallbackCapture>;
  close(): void;
}

export function startCallbackListener(options?: {
  port?: number;              // fixed port (e.g. 1455 for codex); 0 = ephemeral
  path?: string;              // default "/callback"
}): CallbackListener {
  const path = options?.path ?? DEFAULT_PATH;
  let resolver: ((cap: CallbackCapture) => void) | null = null;
  let rejecter: ((err: Error) => void) | null = null;
  let closed = false;

  const server = Bun.serve({
    port: options?.port ?? 0,
    hostname: "127.0.0.1",
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
      // respond to the browser first, then resolve
      const html = capture.error
        ? `<html><body style="font-family:system-ui;padding:40px;background:#0d0f13;color:#eee"><h2>Authorization failed</h2><pre>${escape(capture.error)}</pre></body></html>`
        : `<html><body style="font-family:system-ui;padding:40px;background:#0d0f13;color:#eee"><h2>✓ Authorization complete</h2><p>You can close this tab and return to the terminal.</p></body></html>`;
      queueMicrotask(() => resolver?.(capture));
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });

  const port = server.port;
  const redirectUri = `http://127.0.0.1:${port}${path}`;

  return {
    redirectUri,
    wait(timeoutMs = 5 * 60 * 1000) {
      return new Promise<CallbackCapture>((res, rej) => {
        resolver = res;
        rejecter = rej;
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
      try { server.stop(true); } catch { /* ignore */ }
    },
  };
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
