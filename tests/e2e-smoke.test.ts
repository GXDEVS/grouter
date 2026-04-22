import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
const testHome = mkdtempSync(join(tmpdir(), "grouter-e2e-smoke-"));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;

const { startServer } = await import("../src/proxy/server.ts");

let server: Bun.Server<unknown> | null = null;
let baseUrl = "";

beforeAll(() => {
  server = startServer(0);
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
  server = null;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures on Windows lock timing.
  }
});

describe("e2e smoke", () => {
  test("health endpoint responds with ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ok" });
  });

  test("status endpoint responds without runtime crash", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      proxy: expect.any(Object),
      accounts: expect.any(Object),
    });
  });

  test("CORS preflight responds for API endpoint", async () => {
    const res = await fetch(`${baseUrl}/api/status`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("OPTIONS");
  });
});
