import { describe, expect, it } from "vitest";

import {
  createSecureWindowOptions,
  resolveRendererTarget,
} from "../src/window-configuration.js";

describe("createSecureWindowOptions", () => {
  it("enforces an isolated sandboxed renderer without Node.js", () => {
    const options = createSecureWindowOptions("C:/app/preload.cjs");

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: "C:/app/preload.cjs",
      sandbox: true,
    });
  });
});

describe("resolveRendererTarget", () => {
  it("uses a loopback development server when explicitly configured", () => {
    expect(
      resolveRendererTarget({
        devServerUrl: "http://127.0.0.1:5173",
        productionEntry: "C:/app/web/index.html",
      }),
    ).toEqual({ kind: "url", value: "http://127.0.0.1:5173/" });
  });

  it("rejects non-loopback development URLs", () => {
    expect(() =>
      resolveRendererTarget({
        devServerUrl: "http://example.com/app",
        productionEntry: "C:/app/web/index.html",
      }),
    ).toThrow(/127\.0\.0\.1/i);
  });

  it("rejects localhost to keep the development session same-site", () => {
    expect(() => resolveRendererTarget({
      devServerUrl: "http://localhost:5173",
      productionEntry: "C:/app/web/index.html",
    })).toThrow(/127\.0\.0\.1/i);
  });

  it.each([
    "https://127.0.0.1:5173",
    "http://user:secret@127.0.0.1:5173",
    "http://127.0.0.1:5173/#existing",
  ])("rejects an incompatible development URL %s", (url) => {
    expect(() => resolveRendererTarget({
      devServerUrl: url,
      productionEntry: "C:/app/web/index.html",
    })).toThrow();
  });

  it("uses the packaged renderer file when no dev URL is supplied", () => {
    expect(
      resolveRendererTarget({ productionEntry: "C:/app/web/index.html" }),
    ).toEqual({ kind: "file", value: "C:/app/web/index.html" });
  });
});
