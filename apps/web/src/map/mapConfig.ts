export class MapConfigurationError extends Error {
  override readonly name = "MapConfigurationError";
}

export type MapProvider =
  | Readonly<{ mode: "offline"; xyzUrl: string; enabled: boolean }>
  | Readonly<{ mode: "tianditu"; key: string; terrainUrl?: string }>;

export interface MapEnvironment {
  VITE_MAP_PROVIDER?: string;
  VITE_OFFLINE_XYZ_URL?: string;
  VITE_TDT_KEY?: string;
  VITE_DEV_TERRAIN_URL?: string;
  DEV?: boolean;
}

export const HUBEI_CENTER = Object.freeze({ lat: 30.9, lng: 112.3, alt: 900_000 });

function isLocalResource(url: string, baseHref: string): boolean {
  if (!url.trim() || url.startsWith("//")) return false;
  try {
    const base = new URL(baseHref);
    const parsed = new URL(url, base);
    if (base.protocol === "file:") {
      const baseDirectory = new URL("./", base);
      return !url.startsWith("/") && parsed.protocol === "file:" && parsed.href.startsWith(baseDirectory.href);
    }
    return ["http:", "https:"].includes(base.protocol) && parsed.origin === base.origin;
  } catch {
    return false;
  }
}

export function resolveMapProvider(
  environment: MapEnvironment,
  baseHref = globalThis.location?.href ?? "http://127.0.0.1/",
): MapProvider {
  const mode = environment.VITE_MAP_PROVIDER?.trim().toLowerCase() || "offline";
  if (mode === "offline") {
    const configuredUrl = environment.VITE_OFFLINE_XYZ_URL?.trim();
    const xyzUrl = configuredUrl || "./map/xyz/{z}/{x}/{y}.png";
    if (!isLocalResource(xyzUrl, baseHref)) {
      throw new MapConfigurationError("离线 XYZ 地址必须是当前应用内的本地资源");
    }
    return Object.freeze({ mode, xyzUrl, enabled: Boolean(configuredUrl) });
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
      ? { name: "本地 XYZ", type: "xyz", url: provider.xyzUrl, show: provider.enabled }
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
    ...(provider.mode === "tianditu" && provider.terrainUrl
      ? { terrain: { url: provider.terrainUrl, show: true } }
      : {}),
  };
}
