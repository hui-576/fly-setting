export class MapManifestError extends Error {
  override readonly name = "MapManifestError";
}

export interface ElevationCapability {
  available: boolean;
  resolutionMeters?: number;
  accuracyHint?: string;
}

export interface MapPackageInfo {
  id: string;
  version: string;
  obscurationMode: "bare-earth" | "surface";
  supportedObscurationModes: ("bare-earth" | "surface")[];
  dtm: ElevationCapability;
  dsm: ElevationCapability;
}

export interface ReadyMapManifest {
  status: "ready";
  package: MapPackageInfo;
  layers: {
    basemap: {
      type: "xyz";
      urlTemplate: string;
      minimumLevel?: number;
      maximumLevel?: number;
    };
    terrain: { type: "quantized-mesh"; url: string };
    roads: {
      type: "mvt";
      urlTemplate: string;
      layer: string;
      minimumLevel: number;
      maximumLevel: number;
    };
  };
  errors: string[];
}

export interface UnavailableMapManifest {
  status: "missing" | "invalid";
  package: Pick<MapPackageInfo, "id" | "version"> | null;
  layers: null;
  errors: string[];
}

export type MapManifest = ReadyMapManifest | UnavailableMapManifest;

export type MapManifestFetcher = (
  input: string,
  init: { headers: { accept: string }; signal: AbortSignal },
) => Promise<Response>;

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MapManifestError(`地图清单字段 ${field} 格式无效`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MapManifestError(`地图清单缺少有效字段 ${field}`);
  }
  return value;
}

function elevationCapability(value: unknown, field: string): ElevationCapability {
  const capability = objectValue(value, field);
  if (typeof capability.available !== "boolean") {
    throw new MapManifestError(`地图清单字段 ${field}.available 格式无效`);
  }
  return {
    available: capability.available,
    ...(typeof capability.resolutionMeters === "number"
      ? { resolutionMeters: capability.resolutionMeters }
      : {}),
    ...(typeof capability.accuracyHint === "string"
      ? { accuracyHint: capability.accuracyHint }
      : {}),
  };
}

function obscurationMode(value: unknown): "bare-earth" | "surface" {
  if (value !== "bare-earth" && value !== "surface") {
    throw new MapManifestError("地图清单缺少有效字段 package.obscurationMode");
  }
  return value;
}

function obscurationModes(value: unknown): ("bare-earth" | "surface")[] {
  if (!Array.isArray(value)) {
    throw new MapManifestError("地图清单字段 package.supportedObscurationModes 格式无效");
  }
  const modes = value.filter(
    (mode): mode is "bare-earth" | "surface" => mode === "bare-earth" || mode === "surface",
  );
  if (!modes.length || modes.length !== value.length) {
    throw new MapManifestError("地图清单字段 package.supportedObscurationModes 格式无效");
  }
  return modes;
}

function sameOriginUrl(value: unknown, field: string, baseHref: string): string {
  const url = stringValue(value, field);
  try {
    const base = new URL(baseHref);
    const parsed = new URL(url, base);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== base.origin) {
      throw new Error("cross-origin");
    }
    return url;
  } catch {
    throw new MapManifestError(`地图清单字段 ${field} 必须是当前应用的同源 HTTP(S) 地址`);
  }
}

function terrainDirectoryUrl(value: unknown, baseHref: string): string {
  const url = sameOriginUrl(value, "layers.terrain.url", baseHref);
  return url.endsWith("/") ? url : `${url}/`;
}

function xyzLevel(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 30) {
    throw new MapManifestError(`地图清单 ${field} 的 XYZ 层级范围无效`);
  }
  return value as number;
}

function requiredXyzLevel(value: unknown, field: string): number {
  const level = xyzLevel(value, field);
  if (level === undefined) {
    throw new MapManifestError(`地图清单缺少有效字段 ${field}`);
  }
  return level;
}

function mvtTemplate(value: unknown, baseHref: string): string {
  const template = sameOriginUrl(value, "layers.roads.urlTemplate", baseHref);
  if (!["{z}", "{x}", "{y}"].every((token) => template.includes(token))) {
    throw new MapManifestError("道路 MVT 地址必须包含 {z}/{x}/{y} 占位符");
  }
  const path = template.split("?", 1)[0]?.toLowerCase();
  if (!path?.endsWith(".mvt")) {
    throw new MapManifestError("道路 MVT 地址必须使用 .mvt 扩展名");
  }
  return template;
}

function parseReadyManifest(root: Record<string, unknown>, baseHref: string): ReadyMapManifest {
  const packageValue = objectValue(root.package, "package");
  const layers = objectValue(root.layers, "layers");
  const basemap = objectValue(layers.basemap, "layers.basemap");
  const terrain = objectValue(layers.terrain, "layers.terrain");
  const roads = objectValue(layers.roads, "layers.roads");
  if (basemap.type !== "xyz" || terrain.type !== "quantized-mesh" || roads.type !== "mvt") {
    throw new MapManifestError("地图清单包含不支持的图层模式");
  }
  const minimumLevel = xyzLevel(basemap.minimumLevel, "layers.basemap.minimumLevel");
  const maximumLevel = xyzLevel(basemap.maximumLevel, "layers.basemap.maximumLevel");
  if (minimumLevel !== undefined && maximumLevel !== undefined && maximumLevel < minimumLevel) {
    throw new MapManifestError("地图清单 XYZ 层级范围无效：maximumLevel 小于 minimumLevel");
  }
  const roadsMinimumLevel = requiredXyzLevel(
    roads.minimumLevel,
    "layers.roads.minimumLevel",
  );
  const roadsMaximumLevel = requiredXyzLevel(
    roads.maximumLevel,
    "layers.roads.maximumLevel",
  );
  if (roadsMaximumLevel < roadsMinimumLevel) {
    throw new MapManifestError("地图清单道路 MVT 层级范围无效");
  }
  return {
    status: "ready",
    package: {
      id: stringValue(packageValue.id, "package.id"),
      version: stringValue(packageValue.version, "package.version"),
      obscurationMode: obscurationMode(packageValue.obscurationMode),
      supportedObscurationModes: obscurationModes(packageValue.supportedObscurationModes),
      dtm: elevationCapability(packageValue.dtm, "package.dtm"),
      dsm: elevationCapability(packageValue.dsm, "package.dsm"),
    },
    layers: {
      basemap: {
        type: "xyz",
        urlTemplate: sameOriginUrl(basemap.urlTemplate, "layers.basemap.urlTemplate", baseHref),
        ...(minimumLevel === undefined ? {} : { minimumLevel }),
        ...(maximumLevel === undefined ? {} : { maximumLevel }),
      },
      terrain: {
        type: "quantized-mesh",
        url: terrainDirectoryUrl(terrain.url, baseHref),
      },
      roads: {
        type: "mvt",
        urlTemplate: mvtTemplate(roads.urlTemplate, baseHref),
        layer: stringValue(roads.layer, "layers.roads.layer"),
        minimumLevel: roadsMinimumLevel,
        maximumLevel: roadsMaximumLevel,
      },
    },
    errors: Array.isArray(root.errors) ? root.errors.filter((item): item is string => typeof item === "string") : [],
  };
}

function stringErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const message = (item as Record<string, unknown>).message;
      return typeof message === "string" ? [message] : [];
    }
    return [];
  });
}

function parseUnavailableManifest(
  root: Record<string, unknown>,
  status: UnavailableMapManifest["status"],
): UnavailableMapManifest {
  let packageValue: UnavailableMapManifest["package"] = null;
  if (root.package && typeof root.package === "object" && !Array.isArray(root.package)) {
    const candidate = root.package as Record<string, unknown>;
    if (typeof candidate.id === "string" && typeof candidate.version === "string") {
      packageValue = { id: candidate.id, version: candidate.version };
    }
  }
  return {
    status,
    package: packageValue,
    layers: null,
    errors: stringErrors(root.errors),
  };
}

export async function fetchMapManifest(
  fetcher: MapManifestFetcher = globalThis.fetch,
  baseHref = globalThis.location?.href ?? "http://127.0.0.1/",
): Promise<MapManifest> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher("/api/v1/map/manifest", {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new MapManifestError(`地图清单请求失败（HTTP ${response.status}）`);
    const root = objectValue(await response.json(), "root");
    if (root.status === "ready") return parseReadyManifest(root, baseHref);
    if (root.status === "missing" || root.status === "invalid") {
      return parseUnavailableManifest(root, root.status);
    }
    throw new MapManifestError(`不支持的地图清单状态：${String(root.status)}`);
  } catch (error) {
    if (error instanceof MapManifestError) throw error;
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "读取地图清单超时，请检查本地服务"
      : "无法读取地图清单，请检查本地地图服务";
    throw new MapManifestError(message, { cause: error });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
