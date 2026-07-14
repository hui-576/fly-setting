import { describe, expect, it, vi } from "vitest";

import {
  attachNavigationGuards,
  configureLocalPermissions,
  isAllowedLocalNavigation,
  isAllowedPermission,
  type GuardedWebContents,
  type LocalPermissionSession,
} from "../src/navigation-policy.js";

describe("isAllowedLocalNavigation", () => {
  it.each(["/", "/app", "/results?task=1"])("allows same-origin path %s", (path) => {
    expect(isAllowedLocalNavigation(`http://127.0.0.1:43125${path}`, "http://127.0.0.1:43125"))
      .toBe(true);
  });

  it.each([
    "https://example.com/",
    "javascript:alert(1)",
    "data:text/html,test",
    "http://127.0.0.1.example.com/",
    "file:///C:/app/index.html",
  ])("rejects non-local target %s", (url) => {
    expect(isAllowedLocalNavigation(url, "http://127.0.0.1:43125")).toBe(false);
  });

  it("rejects a different loopback port", () => {
    expect(isAllowedLocalNavigation(
      "http://127.0.0.1:43126/",
      "http://127.0.0.1:43125",
    )).toBe(false);
  });
});

describe("local permission policy", () => {
  it("allows geolocation only for a loopback page", () => {
    const origin = "http://127.0.0.1:43125";
    expect(isAllowedPermission("geolocation", `${origin}/`, origin)).toBe(true);
    expect(isAllowedPermission("camera", `${origin}/`, origin)).toBe(false);
    expect(isAllowedPermission("geolocation", "https://example.com/", origin)).toBe(false);
  });

  it("applies request and check handlers with the same boundary", () => {
    const setPermissionRequestHandler = vi.fn();
    const setPermissionCheckHandler = vi.fn();
    configureLocalPermissions({
      setPermissionCheckHandler,
      setPermissionRequestHandler,
    } as unknown as LocalPermissionSession, () => "http://127.0.0.1:43125");

    const requestHandler = setPermissionRequestHandler.mock.calls[0]?.[0] as (
      contents: { getURL(): string },
      permission: string,
      callback: (allowed: boolean) => void,
    ) => void;
    const callback = vi.fn();
    requestHandler({ getURL: () => "http://127.0.0.1:43125/" }, "geolocation", callback);
    expect(callback).toHaveBeenCalledWith(true);
    requestHandler({ getURL: () => "http://127.0.0.1:43125/" }, "notifications", callback);
    expect(callback).toHaveBeenLastCalledWith(false);

    const checkHandler = setPermissionCheckHandler.mock.calls[0]?.[0] as (
      contents: unknown,
      permission: string,
      origin: string,
    ) => boolean;
    expect(checkHandler(null, "geolocation", "http://127.0.0.1:43125/")).toBe(true);
    expect(checkHandler(null, "clipboard-read", "http://127.0.0.1:43125/")).toBe(false);
  });
});

describe("attachNavigationGuards", () => {
  it("denies new windows and prevents external navigation", () => {
    let navigate: ((event: { preventDefault(): void }, url: string) => void) | undefined;
    const contents: GuardedWebContents = {
      on: vi.fn((_event, listener) => {
        navigate = listener;
      }),
      setWindowOpenHandler: vi.fn(),
    };
    attachNavigationGuards(contents, () => "http://127.0.0.1:43125");

    const openHandler = vi.mocked(contents.setWindowOpenHandler).mock.calls[0]?.[0];
    expect(openHandler?.({ url: "http://127.0.0.1:43125/help" })).toEqual({ action: "deny" });
    const preventDefault = vi.fn();
    navigate?.({ preventDefault }, "https://example.com/");
    expect(preventDefault).toHaveBeenCalledOnce();
    navigate?.({ preventDefault }, "http://127.0.0.1:43125/results");
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
