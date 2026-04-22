import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testHome = mkdtempSync(join(tmpdir(), "grouter-db-accounts-test-"));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;

const { db } = await import("../src/db/index.ts");
const { addApiKeyConnection, updateAccount, getAccountById } = await import("../src/db/accounts.ts");

beforeEach(() => {
  db().exec("DELETE FROM model_locks");
  db().exec("DELETE FROM accounts");
  db().exec("DELETE FROM provider_ports");
});

afterAll(() => {
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures on Windows lock timing.
  }
});

describe("db/accounts.updateAccount", () => {
  test("rejects invalid patch keys (column whitelist enforcement)", () => {
    const created = addApiKeyConnection({ provider: "openai", api_key: "sk-test" });
    expect(() =>
      updateAccount(created.id, { invalid_field: "x" } as unknown as Parameters<typeof updateAccount>[1]),
    ).toThrow(/Invalid account patch field/);
  });

  test("updates only allowed fields and persists values", () => {
    const created = addApiKeyConnection({ provider: "openai", api_key: "sk-abc" });

    updateAccount(created.id, {
      display_name: "Primary OpenAI",
      test_status: "unavailable",
      last_error: "Temporary upstream failure",
      error_code: 503,
      backoff_level: 2,
    });

    const updated = getAccountById(created.id);
    expect(updated).not.toBeNull();
    expect(updated?.display_name).toBe("Primary OpenAI");
    expect(updated?.test_status).toBe("unavailable");
    expect(updated?.last_error).toBe("Temporary upstream failure");
    expect(updated?.error_code).toBe(503);
    expect(updated?.backoff_level).toBe(2);
  });

  test("no-op patch with only undefined values does not mutate updated_at", () => {
    const created = addApiKeyConnection({ provider: "openai", api_key: "sk-noop" });
    const before = getAccountById(created.id);
    expect(before).not.toBeNull();

    updateAccount(created.id, { display_name: undefined });

    const after = getAccountById(created.id);
    expect(after).not.toBeNull();
    expect(after?.updated_at).toBe(before?.updated_at);
  });
});
