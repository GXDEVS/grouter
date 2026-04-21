import { describe, test, expect } from "bun:test";
import { parseProviderData, decodeJwtPayload, mapPlatformOs } from "../src/utils.ts";

describe("parseProviderData", () => {
  test("returns null for null input", () => {
    expect(parseProviderData(null)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseProviderData("")).toBeNull();
  });

  test("parses valid JSON", () => {
    const result = parseProviderData('{"key":"value"}');
    expect(result).toEqual({ key: "value" });
  });

  test("returns null for invalid JSON", () => {
    expect(parseProviderData("not json")).toBeNull();
  });
});

describe("decodeJwtPayload", () => {
  test("decodes a valid JWT payload", () => {
    // Create a fake JWT with base64url-encoded payload
    const payload = { sub: "user123", name: "Test" };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const fakeJwt = `header.${encoded}.signature`;

    const result = decodeJwtPayload(fakeJwt);
    expect(result).toEqual(payload);
  });

  test("returns null for tokens without payload segment", () => {
    expect(decodeJwtPayload("no-dots")).toBeNull();
  });

  test("returns null for invalid base64 payload", () => {
    expect(decodeJwtPayload("h.!!!invalid!!!.s")).toBeNull();
  });
});

describe("mapPlatformOs", () => {
  test("returns a valid OS name", () => {
    const os = mapPlatformOs();
    expect(["MacOS", "Windows", "Linux"]).toContain(os);
  });
});
