import type { ReadyMapManifest } from "./mapManifest";

export class MapConfigurationError extends Error {
  override readonly name = "MapConfigurationError";
}

export type OfflineMapProvider = Readonly<{ mode: "offline"; manifest: ReadyMapManifest }>;
export type DevelopmentMapProvider = Readonly<{ mode: "tianditu"; key: string; terrainUrl?: string }>;
export type MapProvider = OfflineMapProvider | DevelopmentMapProvider;
export type MapProviderSelection = Readonly<{ mode: "offline" }> | DevelopmentMapProvider;

export interface MapEnvironment {
  VITE_MAP_PROVIDER?: string;
  VITE_TDT_KEY?: string;
  VITE_DEV_TERRAIN_URL?: string;
  DEV?: boolean;
}

export const HUBEI_CENTER = Object.freeze({ lat: 30.9, lng: 112.3, alt: 900_000 });

export function resolveMapProvider(
  environment: MapEnvironment,
): MapProviderSelection {
  const mode = environment.VITE_MAP_PROVIDER?.trim().toLowerCase() || "offline";
  if (mode === "offline") {
    return Object.freeze({ mode });
  }
  if (mode === "tianditu") {
    if (environment.DEV === false) {
      throw new MapConfigurationError("天地图仅允许在开发构建中使用");
    }
    const key = environment.VITE_TDT_KEY?.trim();
    if (!key) throw new MapConfigurationError("开发天地图 Key 未配置");
    const terrainUrl = environment.VITE_DEV_TERRAIN_URL?.trim();
    if (terrainUrl && !/^https?:\/\//i.test(terrainUrl)) {
      throw new MapConfigurationError("开发在线高程地址必须使用 HTTP(S)");
    }
    return Object.freeze({ mode, key, ...(terrainUrl ? { terrainUrl } : {}) });
  }
  throw new MapConfigurationError(`不支持的地图数据提供方：${mode}`);
}

export function buildMapOptions(provider: MapProvider) {
  const basemap =
    provider.mode === "offline"
      ? {
          id: "offline-basemap",
          name: "本地 XYZ",
          type: "xyz",
          url: provider.manifest.layers.basemap.urlTemplate,
          ...(provider.manifest.layers.basemap.minimumLevel === undefined
            ? {}
            : { minimumLevel: provider.manifest.layers.basemap.minimumLevel }),
          ...(provider.manifest.layers.basemap.maximumLevel === undefined
            ? {}
            : { maximumLevel: provider.manifest.layers.basemap.maximumLevel }),
          show: true,
        }
      : { name: "天地图影像", type: "tdt", layer: "img_d", key: provider.key, show: true };
  return {
    scene: {
      center: HUBEI_CENTER,
      requestRenderMode: true,
      fxaa: true,
      globe: { baseColor: "#223548" },
    },
    control: {
      baseLayerPicker: false,
      homeButton: false,
      sceneModePicker: false,
    },
    basemaps: [basemap],
    ...(provider.mode === "offline"
      ? {
          terrain: {
            type: "xyz",
            url: provider.manifest.layers.terrain.url,
            show: true,
            requestVertexNormals: false,
            requestWaterMask: false,
            requestMetadata: false,
          },
          roadVectorTiles: provider.manifest.layers.roads,
        }
      : {}),
    ...(provider.mode === "tianditu" && provider.terrainUrl
      ? { terrain: { url: provider.terrainUrl, show: true } }
      : {}),
  };
}
