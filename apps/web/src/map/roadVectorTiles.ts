import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

export interface MapExtent {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface RoadTileCoordinate {
  z: number;
  x: number;
  y: number;
  key: string;
}

export interface RoadTileSelection {
  minimumLevel: number;
  maximumLevel: number;
  maximumTiles: number;
}

export interface RoadGeoJsonFeature {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown>;
  geometry: {
    type: "LineString" | "MultiLineString";
    coordinates: number[][] | number[][][];
  };
}

export interface RoadGeoJsonCollection {
  type: "FeatureCollection";
  features: RoadGeoJsonFeature[];
}

export class RoadVectorTileError extends Error {
  override readonly name = "RoadVectorTileError";
}

const MAX_MERCATOR_LATITUDE = 85.0511287798066;
const MAX_ROAD_VECTOR_TILE_BYTES = 16 * 1024 * 1024;
const MAX_ROAD_FEATURES_PER_TILE = 5_000;
const MAX_ROAD_COORDINATES_PER_TILE = 50_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function longitudeToTileX(longitude: number, level: number): number {
  const count = 2 ** level;
  return clamp(Math.floor(((clamp(longitude, -180, 180) + 180) / 360) * count), 0, count - 1);
}

function latitudeToTileY(latitude: number, level: number): number {
  const count = 2 ** level;
  const radians = clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE) * Math.PI / 180;
  const normalized = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
  return clamp(Math.floor(normalized * count), 0, count - 1);
}

function longitudeRanges(extent: MapExtent): Array<[number, number]> {
  const west = clamp(extent.xmin, -180, 180);
  const east = clamp(extent.xmax, -180, 180);
  return west <= east ? [[west, east]] : [[west, 180], [-180, east]];
}

export function selectVisibleRoadTiles(
  extent: MapExtent,
  mapLevel: number,
  selection: RoadTileSelection,
): RoadTileCoordinate[] {
  if (!Number.isFinite(mapLevel)) {
    throw new RoadVectorTileError("道路矢量瓦片地图层级无效");
  }
  if (![extent.xmin, extent.ymin, extent.xmax, extent.ymax].every(Number.isFinite)) {
    throw new RoadVectorTileError("道路矢量瓦片地图视域无效");
  }
  if (selection.maximumTiles <= 0) return [];
  const level = clamp(Math.floor(mapLevel), selection.minimumLevel, selection.maximumLevel);
  const north = clamp(Math.max(extent.ymin, extent.ymax), -90, 90);
  const south = clamp(Math.min(extent.ymin, extent.ymax), -90, 90);
  const firstY = latitudeToTileY(north, level);
  const lastY = latitudeToTileY(south, level);
  const tiles: RoadTileCoordinate[] = [];

  for (const [west, east] of longitudeRanges(extent)) {
    const firstX = longitudeToTileX(west, level);
    const lastX = longitudeToTileX(east, level);
    for (let y = firstY; y <= lastY; y += 1) {
      for (let x = firstX; x <= lastX; x += 1) {
        tiles.push({ z: level, x, y, key: `${level}/${x}/${y}` });
        if (tiles.length >= selection.maximumTiles) return tiles;
      }
    }
  }
  return tiles;
}

function lineFeature(value: unknown): RoadGeoJsonFeature {
  const feature = value as RoadGeoJsonFeature;
  if (
    feature?.type !== "Feature"
    || !feature.geometry
    || !["LineString", "MultiLineString"].includes(feature.geometry.type)
  ) {
    throw new RoadVectorTileError("道路矢量瓦片包含非线要素");
  }
  return feature;
}

function featureCoordinateCount(feature: RoadGeoJsonFeature): number {
  if (feature.geometry.type === "LineString") {
    return (feature.geometry.coordinates as number[][]).length;
  }
  return (feature.geometry.coordinates as number[][][]).reduce(
    (total, line) => total + line.length,
    0,
  );
}

export function roadCoordinateCount(data: RoadGeoJsonCollection): number {
  return data.features.reduce(
    (total, feature) => total + featureCoordinateCount(feature),
    0,
  );
}

export function decodeRoadVectorTile(
  bytes: Uint8Array,
  layerName: string,
  coordinate: Pick<RoadTileCoordinate, "z" | "x" | "y">,
): RoadGeoJsonCollection {
  if (bytes.byteLength === 0) {
    throw new RoadVectorTileError("道路矢量瓦片为空");
  }
  try {
    const tile = new VectorTile(new PbfReader(bytes));
    const layer = tile.layers[layerName];
    if (!layer) return { type: "FeatureCollection", features: [] };
    if (layer.length > MAX_ROAD_FEATURES_PER_TILE) {
      throw new RoadVectorTileError("道路矢量瓦片要素数量超过上限");
    }
    const features: RoadGeoJsonFeature[] = [];
    let coordinateCount = 0;
    for (let index = 0; index < layer.length; index += 1) {
      const feature = lineFeature(layer.feature(index).toGeoJSON(
        coordinate.x,
        coordinate.y,
        coordinate.z,
      ));
      coordinateCount += featureCoordinateCount(feature);
      if (coordinateCount > MAX_ROAD_COORDINATES_PER_TILE) {
        throw new RoadVectorTileError("道路矢量瓦片坐标数量超过上限");
      }
      features.push(feature);
    }
    return { type: "FeatureCollection", features };
  } catch (error) {
    if (error instanceof RoadVectorTileError) throw error;
    throw new RoadVectorTileError("道路矢量瓦片解码失败", { cause: error });
  }
}

export async function readRoadVectorTileResponse(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new RoadVectorTileError("道路矢量瓦片 Content-Length 无效");
    }
    const declaredBytes = Number(declaredLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      throw new RoadVectorTileError("道路矢量瓦片 Content-Length 无效");
    }
    if (declaredBytes > MAX_ROAD_VECTOR_TILE_BYTES) {
      throw new RoadVectorTileError("道路矢量瓦片超过 16 MiB 上限");
    }
  }
  const payload = await response.arrayBuffer();
  if (payload.byteLength > MAX_ROAD_VECTOR_TILE_BYTES) {
    throw new RoadVectorTileError("道路矢量瓦片超过 16 MiB 上限");
  }
  return new Uint8Array(payload);
}
