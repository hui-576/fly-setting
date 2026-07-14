import type { ReadyMapManifest } from "./mapManifest";
import {
  createRoadVectorTileAdapter,
  type RoadVectorTileAdapter,
  type RoadVectorTileMapLike,
} from "./roadVectorTileAdapter";
import { RoadVectorTileError } from "./roadVectorTiles";

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
  terrainProvider?: {
    errorEvent?: RuntimeEventLike;
  };
  getLayerById?(id: string): LayerEventLike | undefined;
  level?: number;
  hasTerrain?: boolean;
  getExtent?(): { xmin: number; ymin: number; xmax: number; ymax: number };
  addLayer?(layer: unknown): unknown;
  removeLayer?(layer: unknown, destroy?: boolean): unknown;
  zoomIn?(): void;
  zoomOut?(): void;
  setCameraView?(view: { lat: number; lng: number; alt: number }): void;
}

interface RuntimeEventLike {
  addEventListener(listener: (...args: unknown[]) => void): void;
  removeEventListener(listener: (...args: unknown[]) => void): void;
}

interface LayerEventLike {
  show?: boolean;
  on?(event: string, listener: (event: unknown) => void): void;
  off?(event: string, listener: (event: unknown) => void): void;
}

export type MarsMapFactory = (host: HTMLElement, options: unknown) => MarsMapLike;

export interface MapController {
  readonly map: MarsMapLike;
  destroy(): void;
  zoomIn(): void;
  zoomOut(): void;
  showHubei(): void;
  setLayerVisible(layer: "basemap" | "terrain" | "roads", visible: boolean): Promise<void>;
}

type RoadManifest = ReadyMapManifest["layers"]["roads"];
type RoadAdapterFactory = typeof createRoadVectorTileAdapter;

export interface MapControllerDependencies {
  createRoadAdapter?: RoadAdapterFactory;
}

function splitControllerOptions(options: unknown): {
  mapOptions: unknown;
  roads?: RoadManifest;
} {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return { mapOptions: options };
  }
  const roadVectorTiles = (options as Record<string, unknown>).roadVectorTiles;
  if (!roadVectorTiles) return { mapOptions: options };
  const { roadVectorTiles: _removed, ...mapOptions } = options as Record<string, unknown>;
  return { mapOptions, roads: roadVectorTiles as RoadManifest };
}

function supportsRoadVectorTiles(map: MarsMapLike): map is MarsMapLike & RoadVectorTileMapLike {
  return Number.isFinite(map.level)
    && typeof map.getExtent === "function"
    && typeof map.addLayer === "function"
    && typeof map.removeLayer === "function";
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

  const basemap = map.getLayerById?.("offline-basemap");
  const basemapError = (event: unknown): void => {
    onRuntimeError(new MapRuntimeError("本地 XYZ 瓦片加载失败，请检查数据包文件与瓦片层级", {
      cause: event,
    }));
  };
  basemap?.on?.("addTileError", basemapError);

  const terrainTileError = (event: unknown): void => {
    onRuntimeError(new MapRuntimeError("地图高程瓦片加载失败，请检查 Quantized Mesh 数据", {
      cause: event,
    }));
  };
  const terrainProviderError = map.terrainProvider?.errorEvent;
  terrainProviderError?.addEventListener(terrainTileError);

  const renderError = (...args: unknown[]): void => {
    onRuntimeError(new MapRuntimeError("Mars3D 渲染失败，请检查 WebGL 与本地资源", {
      cause: args.at(-1),
    }));
  };
  map.scene?.renderError?.addEventListener(renderError);

  return () => {
    canvas?.removeEventListener("webglcontextlost", contextLost);
    map.off?.("terrainLoadError", terrainError);
    basemap?.off?.("addTileError", basemapError);
    terrainProviderError?.removeEventListener(terrainTileError);
    map.scene?.renderError?.removeEventListener(renderError);
  };
}

function attachRoadAdapter(
  map: MarsMapLike,
  roads: RoadManifest | undefined,
  onRuntimeError: ((error: MapRuntimeError) => void) | undefined,
  dependencies: MapControllerDependencies,
): RoadVectorTileAdapter | undefined {
  if (!roads) return undefined;
  if (!supportsRoadVectorTiles(map)) {
    throw new MapRuntimeError("Mars3D 道路矢量瓦片接口不可用");
  }
  const reportRoadError = (error: RoadVectorTileError): void => {
    onRuntimeError?.(new MapRuntimeError(error.message, { cause: error }));
  };
  const adapter = (dependencies.createRoadAdapter ?? createRoadVectorTileAdapter)(
    map,
    roads,
    reportRoadError,
  );
  void adapter.refresh().catch((error: unknown) => {
    reportRoadError(new RoadVectorTileError("道路矢量瓦片初始化失败", { cause: error }));
  });
  return adapter;
}

async function setLayerVisible(
  map: MarsMapLike,
  roadAdapter: RoadVectorTileAdapter | undefined,
  layer: "basemap" | "terrain" | "roads",
  visible: boolean,
): Promise<void> {
  if (layer === "basemap") {
    const basemap = map.getLayerById?.("offline-basemap");
    if (basemap) basemap.show = visible;
    return;
  }
  if (layer === "terrain") {
    map.hasTerrain = visible;
    return;
  }
  await roadAdapter?.setVisible(visible);
}

function buildMapController(
  map: MarsMapLike,
  roadAdapter: RoadVectorTileAdapter | undefined,
  detachRuntimeErrorHandlers: () => void,
): MapController {
  let destroyed = false;
  return Object.freeze({
    map,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      roadAdapter?.destroy();
      detachRuntimeErrorHandlers();
      map.destroy();
    },
    zoomIn: () => map.zoomIn?.(),
    zoomOut: () => map.zoomOut?.(),
    showHubei: () => map.setCameraView?.({ lat: 30.9, lng: 112.3, alt: 900_000 }),
    setLayerVisible: (
      layer: "basemap" | "terrain" | "roads",
      visible: boolean,
    ) => setLayerVisible(map, roadAdapter, layer, visible),
  });
}

export function createMapController(
  createMap: MarsMapFactory,
  host: HTMLElement,
  options: unknown,
  onRuntimeError?: (error: MapRuntimeError) => void,
  dependencies: MapControllerDependencies = {},
): MapController {
  let map: MarsMapLike | undefined;
  let roadAdapter: RoadVectorTileAdapter | undefined;
  let detachRuntimeErrorHandlers = (): void => undefined;
  try {
    const { mapOptions, roads } = splitControllerOptions(options);
    const activeMap = createMap(host, mapOptions);
    map = activeMap;
    detachRuntimeErrorHandlers = attachRuntimeErrorHandlers(host, activeMap, onRuntimeError);
    roadAdapter = attachRoadAdapter(activeMap, roads, onRuntimeError, dependencies);
    return buildMapController(activeMap, roadAdapter, detachRuntimeErrorHandlers);
  } catch (error) {
    roadAdapter?.destroy();
    detachRuntimeErrorHandlers();
    map?.destroy();
    if (error instanceof MapRuntimeError) throw error;
    throw new MapRuntimeError("Mars3D 初始化失败，请检查 WebGL 与本地地图资源", { cause: error });
  }
}
