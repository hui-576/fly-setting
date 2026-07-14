import type { RendererTarget } from "./window-configuration.js";

type AppEvent = "activate" | "before-quit" | "second-instance" | "window-all-closed";

export interface DesktopApp {
  requestSingleInstanceLock(): boolean;
  whenReady(): Promise<unknown>;
  on(event: AppEvent, listener: (...args: unknown[]) => void): void;
  quit(): void;
  exit(code?: number): void;
}

export interface DesktopWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  loadURL(url: string): Promise<unknown>;
  loadFile(path: string): Promise<unknown>;
  once(event: "ready-to-show", listener: () => void): void;
  on(event: "closed", listener: () => void): void;
}

export interface WindowFactory {
  create(options: unknown): DesktopWindow;
}

export interface DesktopStartOptions {
  app: DesktopApp;
  windowFactory: WindowFactory;
  windowOptions: unknown;
  loadTarget: RendererTarget | (() => Promise<RendererTarget>);
  platform: NodeJS.Platform;
  onFatalError(error: unknown): void;
  onShutdown?: () => void;
}

export interface DesktopStartResult {
  started: boolean;
  ready: Promise<void>;
}

async function loadWindow(window: DesktopWindow, target: RendererTarget): Promise<void> {
  if (target.kind === "url") {
    await window.loadURL(target.value);
  } else {
    await window.loadFile(target.value);
  }
}

async function resolveLoadTarget(
  target: RendererTarget | (() => Promise<RendererTarget>),
): Promise<RendererTarget> {
  return typeof target === "function" ? target() : target;
}

export function startDesktopApplication(options: DesktopStartOptions): DesktopStartResult {
  if (!options.app.requestSingleInstanceLock()) {
    options.app.quit();
    return { started: false, ready: Promise.resolve() };
  }

  let mainWindow: DesktopWindow | null = null;
  const focusWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };
  const createWindow = async (): Promise<void> => {
    const window = options.windowFactory.create(options.windowOptions);
    mainWindow = window;
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      if (mainWindow === window) mainWindow = null;
    });
    await loadWindow(window, await resolveLoadTarget(options.loadTarget));
  };

  options.app.on("second-instance", focusWindow);
  options.app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) void createWindow().catch(options.onFatalError);
    else focusWindow();
  });
  options.app.on("window-all-closed", () => {
    if (options.platform !== "darwin") options.app.quit();
  });
  if (options.onShutdown) options.app.on("before-quit", options.onShutdown);

  const ready = options.app
    .whenReady()
    .then(createWindow)
    .catch((error: unknown) => options.onFatalError(error));
  return { started: true, ready };
}
