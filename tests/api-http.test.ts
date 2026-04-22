import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/web/api-errors.ts";
import { errorResponse, handleApiError, readJson } from "../src/web/api-http.ts";

describe("web api-http helpers", () => {
  test("readJson parses valid JSON body", async () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });

    const body = await readJson<{ ok: boolean }>(req);
    expect(body.ok).toBeTrue();
  });

  test("readJson returns fallback when body is not JSON", async () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not-json",
    });

    const body = await readJson<{ ok: boolean }>(req, { ok: false });
    expect(body.ok).toBeFalse();
  });

  test("readJson throws ApiError 400 for invalid JSON without fallback", async () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });

    await expect(readJson(req)).rejects.toMatchObject({
      status: 400,
      code: "invalid_json_body",
    });
  });

  test("handleApiError returns structured ApiError response", async () => {
    const res = handleApiError(new ApiError(422, "Invalid payload", "validation_error", { field: "name" }));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Invalid payload",
      code: "validation_error",
      field: "name",
    });
  });

  test("errorResponse keeps legacy error shape", async () => {
    const res = errorResponse(404, "Missing resource");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Missing resource" });
  });
});
