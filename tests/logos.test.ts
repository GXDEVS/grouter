import { describe, expect, test } from "bun:test";
import { serveLogo } from "../src/web/logos.ts";

describe("logos endpoint payload", () => {
  test("serves PNG bytes for an existing logo", async () => {
    const res = serveLogo("codex.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    // PNG signature.
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test("returns 304 when ETag matches", async () => {
    const first = serveLogo("codex.png");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const req = new Request("http://localhost/public/logos/codex.png", {
      headers: { "if-none-match": etag! },
    });
    const second = serveLogo("codex.png", req);
    expect(second.status).toBe(304);
  });
});
