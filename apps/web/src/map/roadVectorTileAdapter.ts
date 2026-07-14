import type { ReadyMapManifest } from "./mapManifest";
import {
  decodeRoadVectorTile,
  readRoadVectorTileResponse,
  roadCoordinateCount,
  RoadVectorTileError,
  selectVisibleRoadTiles,
  type MapExtent,
  type RoadGeoJsonCollection,
  type RoadTileCoordinate,
} from "./roadVectorTiles";

type RoadManifest = ReadyMapManifest["layers"]["roads"];

export interface RoadLayerLike {
  show?: boolean;
  destroy?(): void;
}

export interface RoadVectorTileMapLike {
  level: number;
  getExtent(): MapExtent;
  addLayer(layer: RoadLayerLike): unknown;
  removeLayer(layer: RoadLayerLike, destroy?: boolean): unknown;
  on?(event: string, listener: () => void): void;
  off?(event: string, listener: () => void): void;
}

export type RoadTileFetcher = (
  input: string,
  init: { headers: { accept: string }; signal: AbortSignal },
) => Promise<Response>;

export type RoadLayerFactory = (
  data: RoadGeoJsonCollection,
  key: string,
) => RoadLayerLike | Promise<RoadLayerLike>;

export interface RoadVectorTileDependencies {
  fetcher?: RoadTileFetcher;
  createLayer?: RoadLayerFactory;
  cameraMoveEndEvent?: string;
  maximumTiles?: number;
  maximumCachedTiles?: number;
  maximumCachedBytes?: number;
  maximumCachedCoordinates?: number;
  maximumConcurrentRequests?: number;
}

export interface RoadVectorTileAdapter {
  refresh(): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  destroy(): void;
}

interface PendingTile {
  controller: AbortController;
  promise: Promise<void>;
}

interface CachedTile {
  data: RoadGeoJsonCollection;
  bytes: number;
  coordinates: number;
}

const DEFAULT_MAXIMUM_TILES = 32;
const DEFAULT_MAXIMUM_CACHED_TILES = 96;
const DEFAULT_MAXIMUM_CACHED_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAXIMUM_CACHED_COORDINATES = 250_000;
const DEFAULT_MAXIMUM_CONCURRENT_REQUESTS = 4;
const CAMERA_MOVE_END = "cameraMoveEnd";

async function createMarsRoadLayer(
  data: RoadGeoJsonCollection,
  key: string,
): Promise<RoadLayerLike> {
  const mars3d = await import("mars3d");
  return new mars3d.layer.GeoJsonLayer({
    name: `本地道路 ${key}`,
    data,
    flyTo: false,
    symbol: {
      type: "polylineP",
      styleOptions: { width: 3, color: "#ffd166", clampToGround: true },
    },
  });
}

function tileUrl(template: string, tile: RoadTileCoordinate): string {
  return template
    .replaceAll("{z}", String(tile.z))
    .replaceAll("{x}", String(tile.x))
    .replaceAll("{y}", String(tile.y));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

class RoadVectorTileRuntime {
  private readonly fetcher: RoadTileFetcher;
  private readonly createLayer: RoadLayerFactory;
  private readonly cameraMoveEndEvent: string;
  private readonly maximumTiles: number;
  private readonly maximumCachedTiles: number;
  private readonly maximumCachedBytes: number;
  private readonly maximumCachedCoordinates: number;
  private readonly maximumConcurrentRequests: number;
  private readonly cache = new Map<string, CachedTile>();
  private readonly activeLayers = new Map<string, RoadLayerLike>();
  private readonly pendingTiles = new Map<string, PendingTile>();
  private readonly permitWaiters: Array<() => void> = [];
  private desiredKeys = new Set<string>();
  private cachedBytes = 0;
  private cachedCoordinates = 0;
  private activeRequests = 0;
  private visible = true;
  private destroyed = false;

  constructor(
    private readonly map: RoadVectorTileMapLike,
    private readonly manifest: RoadManifest,
    private readonly onError: (error: RoadVectorTileError) => void,
    dependencies: RoadVectorTileDependencies,
  ) {
    this.fetcher = (dependencies.fetcher ?? globalThis.fetch).bind(globalThis);
    this.createLayer = dependencies.createLayer ?? createMarsRoadLayer;
    this.cameraMoveEndEvent = dependencies.cameraMoveEndEvent ?? CAMERA_MOVE_END;
    this.maximumTiles = Math.max(1, dependencies.maximumTiles ?? DEFAULT_MAXIMUM_TILES);
    this.maximumCachedTiles = Math.max(
      this.maximumTiles,
      dependencies.maximumCachedTiles ?? DEFAULT_MAXIMUM_CACHED_TILES,
    );
    this.maximumCachedBytes = Math.max(1, dependencies.maximumCachedBytes
      ?? DEFAULT_MAXIMUM_CACHED_BYTES);
    this.maximumCachedCoordinates = Math.max(1, dependencies.maximumCachedCoordinates
      ?? DEFAULT_MAXIMUM_CACHED_COORDINATES);
    this.maximumConcurrentRequests = Math.max(1, dependencies.maximumConcurrentRequests
      ?? DEFAULT_MAXIMUM_CONCURRENT_REQUESTS);
    this.map.on?.(this.cameraMoveEndEvent, this.cameraMoveEnd);
  }

  private readonly cameraMoveEnd = (): void => {
    void this.refresh();
  };

  private removeLayer(key: string): void {
    const layer = this.activeLayers.get(key);
    if (!layer) return;
    this.activeLayers.delete(key);
    this.map.removeLayer(layer, true);
  }

  private removeAllLayers(): void {
    for (const key of [...this.activeLayers.keys()]) this.removeLayer(key);
  }

  private abortPending(predicate: (key: string) => boolean = () => true): void {
    for (const [key, pending] of this.pendingTiles) {
      if (predicate(key)) pending.controller.abort();
    }
  }

  private dropCachedTile(key: string): void {
    const cached = this.cache.get(key);
    if (!cached) return;
    this.cache.delete(key);
    this.cachedBytes -= cached.bytes;
    this.cachedCoordinates -= cached.coordinates;
  }

  private cacheTile(key: string, data: RoadGeoJsonCollection, bytes: number): void {
    this.dropCachedTile(key);
    const cached = { data, bytes, coordinates: roadCoordinateCount(data) };
    this.cache.set(key, cached);
    this.cachedBytes += cached.bytes;
    this.cachedCoordinates += cached.coordinates;
    while (
      this.cache.size > this.maximumCachedTiles
      || this.cachedBytes > this.maximumCachedBytes
      || this.cachedCoordinates > this.maximumCachedCoordinates
    ) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.dropCachedTile(oldest);
    }
  }

  private async activateTile(key: string, data: RoadGeoJsonCollection): Promise<void> {
    if (this.destroyed || !this.visible || !this.desiredKeys.has(key)) return;
    if (data.features.length === 0 || this.activeLayers.has(key)) return;
    const layer = await this.createLayer(data, key);
    if (this.destroyed || !this.visible || !this.desiredKeys.has(key)) {
      layer.destroy?.();
      return;
    }
    layer.show = true;
    try {
      await Promise.resolve(this.map.addLayer(layer));
    } catch (error) {
      layer.destroy?.();
      throw error;
    }
    if (this.destroyed || !this.visible || !this.desiredKeys.has(key)) {
      this.map.removeLayer(layer, true);
      return;
    }
    this.activeLayers.set(key, layer);
  }

  private async acquirePermit(): Promise<void> {
    if (this.activeRequests < this.maximumConcurrentRequests) {
      this.activeRequests += 1;
      return;
    }
    await new Promise<void>((resolve) => this.permitWaiters.push(resolve));
    this.activeRequests += 1;
  }

  private releasePermit(): void {
    this.activeRequests -= 1;
    this.permitWaiters.shift()?.();
  }

  private async withRequestPermit(action: () => Promise<void>): Promise<void> {
    await this.acquirePermit();
    try {
      await action();
    } finally {
      this.releasePermit();
    }
  }

  private async loadTile(tile: RoadTileCoordinate, controller: AbortController): Promise<void> {
    if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
    const response = await this.fetcher(tileUrl(this.manifest.urlTemplate, tile), {
      headers: { accept: "application/vnd.mapbox-vector-tile, application/x-protobuf" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new RoadVectorTileError(`道路矢量瓦片请求失败（HTTP ${response.status}）`);
    }
    const bytes = await readRoadVectorTileResponse(response);
    const data = decodeRoadVectorTile(bytes, this.manifest.layer, tile);
    this.cacheTile(tile.key, data, bytes.byteLength);
    await this.activateTile(tile.key, data);
  }

  private async runTile(tile: RoadTileCoordinate, controller: AbortController): Promise<void> {
    try {
      await this.withRequestPermit(() => this.loadTile(tile, controller));
    } catch (error) {
      if (!isAbortError(error)) {
        const message = error instanceof RoadVectorTileError
          ? error.message
          : `道路矢量瓦片加载失败（${tile.key}）`;
        this.onError(new RoadVectorTileError(message, { cause: error }));
      }
    } finally {
      if (this.pendingTiles.get(tile.key)?.controller === controller) {
        this.pendingTiles.delete(tile.key);
      }
    }
  }

  private async ensureTile(tile: RoadTileCoordinate): Promise<void> {
    const cached = this.cache.get(tile.key);
    if (cached) {
      this.cacheTile(tile.key, cached.data, cached.bytes);
      await this.activateTile(tile.key, cached.data);
      return;
    }
    const pending = this.pendingTiles.get(tile.key);
    if (pending && !pending.controller.signal.aborted) return pending.promise;
    if (pending) this.pendingTiles.delete(tile.key);
    const controller = new AbortController();
    const promise = this.runTile(tile, controller);
    this.pendingTiles.set(tile.key, { controller, promise });
    await promise;
  }

  async refresh(): Promise<void> {
    if (this.destroyed || !this.visible) return;
    try {
      const tiles = selectVisibleRoadTiles(this.map.getExtent(), this.map.level, {
        minimumLevel: this.manifest.minimumLevel,
        maximumLevel: this.manifest.maximumLevel,
        maximumTiles: this.maximumTiles,
      });
      this.desiredKeys = new Set(tiles.map((tile) => tile.key));
      for (const key of [...this.activeLayers.keys()]) {
        if (!this.desiredKeys.has(key)) this.removeLayer(key);
      }
      this.abortPending((key) => !this.desiredKeys.has(key));
      await Promise.all(tiles.map((tile) => this.ensureTile(tile)));
    } catch (error) {
      const message = error instanceof RoadVectorTileError
        ? error.message
        : "道路矢量瓦片视域刷新失败";
      this.onError(new RoadVectorTileError(message, { cause: error }));
    }
  }

  async setVisible(visible: boolean): Promise<void> {
    if (this.destroyed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.desiredKeys.clear();
      this.abortPending();
      this.removeAllLayers();
      return;
    }
    await this.refresh();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.desiredKeys.clear();
    this.map.off?.(this.cameraMoveEndEvent, this.cameraMoveEnd);
    this.abortPending();
    this.removeAllLayers();
    for (const key of [...this.cache.keys()]) this.dropCachedTile(key);
  }
}

export function createRoadVectorTileAdapter(
  map: RoadVectorTileMapLike,
  manifest: RoadManifest,
  onError: (error: RoadVectorTileError) => void,
  dependencies: RoadVectorTileDependencies = {},
): RoadVectorTileAdapter {
  const runtime = new RoadVectorTileRuntime(map, manifest, onError, dependencies);
  return Object.freeze({
    refresh: () => runtime.refresh(),
    setVisible: (visible: boolean) => runtime.setVisible(visible),
    destroy: () => runtime.destroy(),
  });
}
