export class MapRuntimeError extends Error {
  override readonly name = "MapRuntimeError";
}

interface MarsMapLike {
  destroy(): void;
  on?(event: string, listener: (event: unknown) => void): void;
  off?(event: string, listener: (event: unknown) => void): void;
  scene?: {
    renderError?: {
      addEventListener(listener: (...args: unknown[]) => void): void;
      removeEventListener(listener: (...args: unknown[]) => void): void;
    };
  };
  zoomIn?(): void;
  zoomOut?(): void;
  setCameraView?(view: { lat: number; lng: number; alt: number }): void;
}

export type MarsMapFactory = (host: HTMLElement, options: unknown) => MarsMapLike;

export interface MapController {
  readonly map: MarsMapLike;
  destroy(): void;
  zoomIn(): void;
  zoomOut(): void;
  showHubei(): void;
}

function attachRuntimeErrorHandlers(
  host: HTMLElement,
  map: MarsMapLike,
  onRuntimeError?: (error: MapRuntimeError) => void,
): () => void {
  if (!onRuntimeError) return () => undefined;
  const canvas = host.querySelector("canvas");
  const contextLost = (event: Event): void => {
    event.preventDefault();
    onRuntimeError(new MapRuntimeError("WebGL 上下文已丢失，请检查显卡驱动或重启应用"));
  };
  canvas?.addEventListener("webglcontextlost", contextLost);

  const terrainError = (event: unknown): void => {
    onRuntimeError(new MapRuntimeError("地图高程资源加载失败", { cause: event }));
  };
  map.on?.("terrainLoadError", terrainError);

  const renderError = (...args: unknown[]): void => {
    onRuntimeError(new MapRuntimeError("Mars3D 渲染失败，请检查 WebGL 与本地资源", {
      cause: args.at(-1),
    }));
  };
  map.scene?.renderError?.addEventListener(renderError);

  return () => {
    canvas?.removeEventListener("webglcontextlost", contextLost);
    map.off?.("terrainLoadError", terrainError);
    map.scene?.renderError?.removeEventListener(renderError);
  };
}

export function createMapController(
  createMap: MarsMapFactory,
  host: HTMLElement,
  options: unknown,
  onRuntimeError?: (error: MapRuntimeError) => void,
): MapController {
  try {
    const map = createMap(host, options);
    const detachRuntimeErrorHandlers = attachRuntimeErrorHandlers(host, map, onRuntimeError);
    let destroyed = false;
    return Object.freeze({
      map,
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        detachRuntimeErrorHandlers();
        map.destroy();
      },
      zoomIn: () => map.zoomIn?.(),
      zoomOut: () => map.zoomOut?.(),
      showHubei: () => map.setCameraView?.({ lat: 30.9, lng: 112.3, alt: 900_000 }),
    });
  } catch (error) {
    throw new MapRuntimeError("Mars3D 初始化失败，请检查 WebGL 与本地地图资源", { cause: error });
  }
}
