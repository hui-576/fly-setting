import { describe, expect, it } from "vitest";

import { resolveStartupSessionUrl } from "../../startupHandshake";

describe("startup handshake URL", () => {
  it("normalizes a dynamic loopback base URL without a double slash", () => {
    expect(resolveStartupSessionUrl("http://127.0.0.1:43125/")).toBe(
      "http://127.0.0.1:43125/api/v1/session",
    );
  });

  it.each([
    "http://localhost:43125/",
    "https://127.0.0.1:43125/",
    "http://example.com/",
    "http://user:secret@127.0.0.1:43125/",
  ])("rejects an unsafe or cross-site base URL %s", (url) => {
    expect(() => resolveStartupSessionUrl(url)).toThrow();
  });
});
