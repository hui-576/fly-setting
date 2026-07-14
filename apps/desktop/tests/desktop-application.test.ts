import { describe, expect, it, vi } from "vitest";

import {
  startDesktopApplication,
  type DesktopApp,
  type DesktopWindow,
  type WindowFactory,
} from "../src/desktop-application.js";

type AppEvent = "activate" | "before-quit" | "second-instance" | "window-all-closed";

function createHarness(hasLock = true) {
  const handlers = new Map<AppEvent, (...args: unknown[]) => void>();
  const app: DesktopApp = {
    exit: vi.fn(),
    on: vi.fn((event, listener) => handlers.set(event, listener)),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => hasLock),
    whenReady: vi.fn(() => Promise.resolve()),
  };
  const window: DesktopWindow = {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    loadFile: vi.fn(() => Promise.resolve()),
    loadURL: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn((_event, listener) => listener()),
    restore: vi.fn(),
    show: vi.fn(),
  };
  const createWindow = vi.fn(() => window);
  const windowFactory: WindowFactory = {
    create: createWindow,
  };

  return { app, createWindow, handlers, window, windowFactory };
}

describe("startDesktopApplication", () => {
  it("quits immediately when another instance owns the lock", async () => {
    const harness = createHarness(false);

    const result = startDesktopApplication({
      app: harness.app,
      loadTarget: { kind: "url", value: "http://127.0.0.1:5173" },
      onFatalError: vi.fn(),
      platform: "win32",
      windowFactory: harness.windowFactory,
      windowOptions: {},
    });
    await result.ready;

    expect(result.started).toBe(false);
    expect(harness.app.quit).toHaveBeenCalledOnce();
    expect(harness.createWindow).not.toHaveBeenCalled();
  });

  it("creates one window and focuses it on a second launch", async () => {
    const harness = createHarness();
    harness.window.isMinimized = vi.fn(() => true);

    const result = startDesktopApplication({
      app: harness.app,
      loadTarget: { kind: "url", value: "http://127.0.0.1:5173" },
      onFatalError: vi.fn(),
      platform: "win32",
      windowFactory: harness.windowFactory,
      windowOptions: { sandbox: true },
    });
    await result.ready;
    harness.handlers.get("second-instance")?.();

    expect(harness.createWindow).toHaveBeenCalledOnce();
    expect(harness.window.loadURL).toHaveBeenCalledWith("http://127.0.0.1:5173");
    expect(harness.window.restore).toHaveBeenCalledOnce();
    expect(harness.window.show).toHaveBeenCalled();
    expect(harness.window.focus).toHaveBeenCalledOnce();
  });

  it("loads a production file and recreates a closed window on activate", async () => {
    const harness = createHarness();
    let closedListener: (() => void) | undefined;
    harness.window.on = vi.fn((event, listener) => {
      if (event === "closed") closedListener = listener;
    });

    const result = startDesktopApplication({
      app: harness.app,
      loadTarget: { kind: "file", value: "C:/app/web/index.html" },
      onFatalError: vi.fn(),
      platform: "darwin",
      windowFactory: harness.windowFactory,
      windowOptions: {},
    });
    await result.ready;
    closedListener?.();
    harness.handlers.get("activate")?.();
    await Promise.resolve();

    expect(harness.window.loadFile).toHaveBeenCalledWith("C:/app/web/index.html");
    expect(harness.createWindow).toHaveBeenCalledTimes(2);
  });

  it("quits on window-all-closed outside macOS", async () => {
    const harness = createHarness();
    const result = startDesktopApplication({
      app: harness.app,
      loadTarget: { kind: "file", value: "C:/app/web/index.html" },
      onFatalError: vi.fn(),
      platform: "win32",
      windowFactory: harness.windowFactory,
      windowOptions: {},
    });
    await result.ready;
    harness.handlers.get("window-all-closed")?.();

    expect(harness.app.quit).toHaveBeenCalledOnce();
  });

  it("reports renderer load failures and exits through the fatal handler", async () => {
    const harness = createHarness();
    const error = new Error("renderer failed");
    const onFatalError = vi.fn();
    harness.window.loadFile = vi.fn(() => Promise.reject(error));

    const result = startDesktopApplication({
      app: harness.app,
      loadTarget: { kind: "file", value: "C:/app/web/index.html" },
      onFatalError,
      platform: "win32",
      windowFactory: harness.windowFactory,
      windowOptions: {},
    });
    await result.ready;

    expect(onFatalError).toHaveBeenCalledWith(error);
  });

  it("resolves an asynchronous renderer target and stops services before quit", async () => {
    const harness = createHarness();
    const onShutdown = vi.fn();
    const resolveTarget = vi.fn(() =>
      Promise.resolve({ kind: "url", value: "http://127.0.0.1:43125/" } as const),
    );

    const result = startDesktopApplication({
      app: harness.app,
      loadTarget: resolveTarget,
      onFatalError: vi.fn(),
      onShutdown,
      platform: "win32",
      windowFactory: harness.windowFactory,
      windowOptions: {},
    });
    await result.ready;
    harness.handlers.get("before-quit")?.();

    expect(resolveTarget).toHaveBeenCalledOnce();
    expect(harness.window.loadURL).toHaveBeenCalledWith("http://127.0.0.1:43125/");
    expect(onShutdown).toHaveBeenCalledOnce();
  });
});
