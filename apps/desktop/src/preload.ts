import { contextBridge } from "electron";

import { createDesktopApi } from "./preload-api.js";

contextBridge.exposeInMainWorld(
  "desktopApi",
  createDesktopApi({
    chrome: process.versions.chrome ?? "unknown",
    electron: process.versions.electron ?? "unknown",
    node: process.versions.node,
    platform: process.platform,
  }),
);
