import type { BrowserWindowConstructorOptions } from "electron";
import { isAbsolute } from "node:path";

export type RendererTarget =
  | Readonly<{ kind: "url"; value: string }>
  | Readonly<{ kind: "file"; value: string }>;

export interface RendererTargetInput {
  devServerUrl?: string;
  productionEntry: string;
}

export function createSecureWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  if (!isAbsolute(preloadPath)) {
    throw new Error("preload path must be absolute");
  }
  return {
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 720,
    show: false,
    backgroundColor: "#0b1522",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  };
}

export function resolveRendererTarget(input: RendererTargetInput): RendererTarget {
  if (!input.devServerUrl) {
    if (!isAbsolute(input.productionEntry)) {
      throw new Error("production renderer entry must be absolute");
    }
    return Object.freeze({ kind: "file", value: input.productionEntry });
  }

  const url = new URL(input.devServerUrl);
  if (url.protocol !== "http:") {
    throw new Error("development renderer URL must use HTTP for the local session");
  }
  if (url.hostname !== "127.0.0.1") {
    throw new Error("development renderer URL must use 127.0.0.1 for the local session");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("development renderer URL must not include credentials or a fragment");
  }
  return Object.freeze({ kind: "url", value: url.toString() });
}
