declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

import { resolveCesiumBaseUrl } from "./map/runtimeAssets";
import { resolveStartupSessionUrl } from "./startupHandshake";

function renderStartupFailure(error: unknown): void {
  const host = document.querySelector<HTMLElement>("#app");
  if (!host) return;
  const message = error instanceof Error ? error.message : "未知启动错误";
  host.innerHTML = `<main class="startup-failure" role="alert"><h1>应用启动失败</h1><p></p></main>`;
  const paragraph = host.querySelector("p");
  if (paragraph) paragraph.textContent = message;
}

async function completeStartupHandshake(): Promise<void> {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const startupSecret = parameters.get("startup");
  if (!startupSecret) return;
  const apiBaseUrl = parameters.get("api") ?? window.location.origin;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  const response = await fetch(resolveStartupSessionUrl(apiBaseUrl), {
    method: "POST",
    headers: { "X-Startup-Secret": startupSecret },
    credentials: "include",
  });
  if (!response.ok) throw new Error("本地服务启动握手失败");
}

void (async () => {
  try {
    window.CESIUM_BASE_URL = resolveCesiumBaseUrl(import.meta.env.VITE_CESIUM_BASE_URL);
    await completeStartupHandshake();
    await import("./bootstrap");
  } catch (error) {
    renderStartupFailure(error);
  }
})();
