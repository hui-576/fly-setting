import { describe, expect, it } from "vitest";

import { MapConfigurationError, buildMapOptions, resolveMapProvider } from "../mapConfig";
import type { ReadyMapManifest } from "../mapManifest";

const manifest: ReadyMapManifest = {
  status: "ready",
  package: {
    id: "hubei-core",
    version: "2026.07",
    obscurationMode: "surface",
    supportedObscurationModes: ["bare-earth", "surface"],
    dtm: { available: true },
    dsm: { available: true },
  },
  layers: {
    basemap: {
      type: "xyz",
      urlTemplate: "/api/v1/map/tiles/{z}/{x}/{y}.png",
      minimumLevel: 0,
      maximumLevel: 0,
    },
    terrain: { type: "quantized-mesh", url: "/api/v1/map/terrain/" },
    roads: {
      type: "mvt",
      urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
      layer: "roads",
      minimumLevel: 6,
      maximumLevel: 14,
    },
  },
  errors: [],
};

describe("地图数据提供方配置", () => {
  it("把 ready 运行时清单映射为本地 XYZ、Quantized Mesh 和矢量道路", () => {
    const options = buildMapOptions({ mode: "offline", manifest });

    expect(options.basemaps).toEqual([{
      id: "offline-basemap",
      name: "本地 XYZ",
      type: "xyz",
      url: "/api/v1/map/tiles/{z}/{x}/{y}.png",
      minimumLevel: 0,
      maximumLevel: 0,
      show: true,
    }]);
    expect(options.terrain).toEqual({
      type: "xyz",
      url: "/api/v1/map/terrain/",
      show: true,
      requestVertexNormals: false,
      requestWaterMask: false,
      requestMetadata: false,
    });
    expect(options.roadVectorTiles).toEqual(manifest.layers.roads);
    expect(options).not.toHaveProperty("layers");
    expect(JSON.stringify(options)).not.toMatch(/https?:\/\//i);
  });

  it("离线模式只选择运行时清单，不携带构建期瓦片地址", () => {
    expect(resolveMapProvider({ VITE_MAP_PROVIDER: "offline" })).toEqual({ mode: "offline" });
    expect(resolveMapProvider({})).toEqual({ mode: "offline" });
  });

  it("开发天地图模式要求本机 Key 并可显式配置在线高程", () => {
    expect(() => resolveMapProvider({ VITE_MAP_PROVIDER: "tianditu" })).toThrow(
      "开发天地图 Key 未配置",
    );

    const provider = resolveMapProvider({
      VITE_MAP_PROVIDER: "tianditu",
      VITE_TDT_KEY: "local-development-key",
      VITE_DEV_TERRAIN_URL: "https://terrain.example.test/quantized-mesh",
      DEV: true,
    });
    if (provider.mode !== "tianditu") throw new Error("expected development provider");
    expect(buildMapOptions(provider).basemaps[0]).toMatchObject({
      type: "tdt",
      key: "local-development-key",
    });
    expect(buildMapOptions(provider)).toMatchObject({
      terrain: { url: "https://terrain.example.test/quantized-mesh", show: true },
    });
  });

  it("拒绝非 HTTP(S) 开发高程、生产天地图和未知模式", () => {
    expect(() => resolveMapProvider({
      VITE_MAP_PROVIDER: "tianditu",
      VITE_TDT_KEY: "local-development-key",
      VITE_DEV_TERRAIN_URL: "file:///C:/terrain",
      DEV: true,
    })).toThrow("必须使用 HTTP(S)");
    expect(() => resolveMapProvider({
      VITE_MAP_PROVIDER: "tianditu",
      VITE_TDT_KEY: "local-development-key",
      DEV: false,
    })).toThrow("仅允许在开发构建中使用");
    expect(() => resolveMapProvider({ VITE_MAP_PROVIDER: "arcgis" })).toThrow(MapConfigurationError);
  });
});
