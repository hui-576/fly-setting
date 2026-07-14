import { app, BrowserWindow, dialog, type BrowserWindowConstructorOptions } from "electron";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { startDesktopApplication, type WindowFactory } from "./desktop-application.js";
import { resolveApiProcessCommand } from "./local-api-config.js";
import { LocalApiService } from "./local-api-service.js";
import { attachNavigationGuards, configureLocalPermissions } from "./navigation-policy.js";
import { createSecureWindowOptions, resolveRendererTarget } from "./window-configuration.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(currentDirectory, "preload.cjs");
const apiProjectPath = join(currentDirectory, "../../../services/api");
const webRoot = app.isPackaged
  ? join(process.resourcesPath, "web")
  : join(currentDirectory, "../../web/dist");
process.env.FLY_SETTING_WEB_ROOT ??= webRoot;
const windowOptions = createSecureWindowOptions(preloadPath);
let allowedRendererOrigin: string | null = null;
const getAllowedRendererOrigin = (): string | null => allowedRendererOrigin;
const windowFactory: WindowFactory = {
  create: (options) => {
    const window = new BrowserWindow(options as BrowserWindowConstructorOptions);
    attachNavigationGuards(window.webContents, getAllowedRendererOrigin);
    configureLocalPermissions(window.webContents.session, getAllowedRendererOrigin);
    return window;
  },
};
const startupSecret = randomBytes(32).toString("base64url");
const rendererUrl = process.env.FLY_SETTING_RENDERER_URL;
const developmentRendererTarget = rendererUrl
  ? resolveRendererTarget({
      devServerUrl: rendererUrl,
      productionEntry: join(webRoot, "index.html"),
    })
  : null;
const handleFatalError = (error: unknown): void => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("Desktop startup failed", error);
  if (app.isReady()) dialog.showErrorBox("应用启动失败", message);
  app.exit(1);
};
const localApi = new LocalApiService(resolveApiProcessCommand({
  apiProjectPath,
  environment: process.env,
  isPackaged: app.isPackaged,
  platform: process.platform,
  resourcesPath: process.resourcesPath,
}), undefined, {
  FLY_SETTING_STARTUP_SECRET: startupSecret,
  ...(developmentRendererTarget
    ? { FLY_SETTING_RENDERER_ORIGIN: new URL(developmentRendererTarget.value).origin }
    : {}),
}, handleFatalError);

const application = startDesktopApplication({
  app,
  windowFactory,
  windowOptions,
  loadTarget: async () => {
    const apiUrl = await localApi.start();
    const target = developmentRendererTarget
      ? developmentRendererTarget
      : {
          kind: "url" as const,
          value: `${apiUrl}#startup=${encodeURIComponent(startupSecret)}`,
        };
    allowedRendererOrigin = new URL(target.value).origin;
    if (developmentRendererTarget) {
      return {
        ...target,
        value: `${target.value}#startup=${encodeURIComponent(startupSecret)}&api=${encodeURIComponent(apiUrl)}`,
      };
    }
    return target;
  },
  platform: process.platform,
  onShutdown: () => localApi.stop(),
  onFatalError: (error) => {
    localApi.stop();
    handleFatalError(error);
  },
});

void application.ready;
