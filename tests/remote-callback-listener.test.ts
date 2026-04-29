import { describe, test, expect } from "bun:test";
import { createRemoteCallbackListener } from "../src/auth/server.ts";

describe("createRemoteCallbackListener", () => {
  test("exposes the redirect URI and a port of 0 (no socket)", () => {
    const listener = createRemoteCallbackListener("https://example.com/oauth/callback");
    expect(listener.redirectUri).toBe("https://example.com/oauth/callback");
    expect(listener.port).toBe(0);
    listener.close();
  });

  test("wait() resolves with the capture handed to resolveRemote()", async () => {
    const listener = createRemoteCallbackListener("https://example.com/oauth/callback");
    const fakeUrl = new URL("https://example.com/oauth/callback?code=abc&state=xyz");
    setTimeout(() => listener.resolveRemote({ code: "abc", state: "xyz", error: null, url: fakeUrl }), 0);
    const cap = await listener.wait();
    expect(cap.code).toBe("abc");
    expect(cap.state).toBe("xyz");
    expect(cap.error).toBeNull();
    expect(cap.url.searchParams.get("code")).toBe("abc");
  });

  test("wait() rejects with 'Callback timeout' after the timeout window", async () => {
    const listener = createRemoteCallbackListener("https://example.com/cb", 50);
    let rejected: Error | null = null;
    try {
      await listener.wait();
    } catch (err) {
      rejected = err as Error;
    }
    expect(rejected).not.toBeNull();
    expect(rejected!.message).toContain("Callback timeout");
  });

  test("close() rejects an in-flight wait() so callers can fail-fast", async () => {
    const listener = createRemoteCallbackListener("https://example.com/cb", 60_000);
    const waitPromise = listener.wait();
    listener.close();
    let rejected: Error | null = null;
    try {
      await waitPromise;
    } catch (err) {
      rejected = err as Error;
    }
    expect(rejected).not.toBeNull();
    expect(rejected!.message).toContain("closed");
  });

  test("resolveRemote() after close() is a no-op (no thrown errors, no late resolution)", async () => {
    const listener = createRemoteCallbackListener("https://example.com/cb", 30);
    let rejected: Error | null = null;
    try {
      await listener.wait();
    } catch (err) {
      rejected = err as Error;
    }
    expect(rejected!.message).toContain("Callback timeout");
    // resolveRemote after timeout should silently no-op (already closed)
    expect(() => listener.resolveRemote({ code: "x", state: "y", error: null, url: new URL("https://x.com") })).not.toThrow();
  });

  test("close() is idempotent — repeated calls after first don't throw", () => {
    const listener = createRemoteCallbackListener("https://example.com/cb");
    listener.close();
    expect(() => listener.close()).not.toThrow();
    expect(() => listener.close()).not.toThrow();
  });
});
