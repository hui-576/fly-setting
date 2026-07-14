import { describe, expect, it, vi } from "vitest";

import { MapManifestError, fetchMapManifest } from "../mapManifest";

function readyManifest(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    package: {
      id: "hubei-core",
      version: "2026.07",
      obscurationMode: "surface",
      supportedObscurationModes: ["bare-earth", "surface"],
      dtm: { available: true, resolutionMeters: 10, accuracyHint: "垂直精度约 3m" },
      dsm: { available: false },
    },
    layers: {
      basemap: {
        type: "xyz",
        urlTemplate: "/api/v1/map/tiles/{z}/{x}/{y}.png",
        minimumLevel: 0,
        maximumLevel: 0,
      },
      terrain: { type: "quantized-mesh", url: "/api/v1/map/terrain" },
      roads: {
        type: "mvt",
        urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
        layer: "roads",
        minimumLevel: 6,
        maximumLevel: 14,
      },
    },
    errors: [],
    ...overrides,
  };
}

describe("运行时地图清单", () => {
  it("从固定同源接口读取 ready 数据包及三类本地图层", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(readyManifest()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const manifest = await fetchMapManifest(fetcher, "http://127.0.0.1:8123/app/");

    expect(fetcher).toHaveBeenCalledWith("/api/v1/map/manifest", {
      headers: { accept: "application/json" },
      signal: expect.any(AbortSignal),
    });
    expect(manifest).toMatchObject({
      status: "ready",
      package: { id: "hubei-core", version: "2026.07" },
      layers: {
        basemap: { type: "xyz", minimumLevel: 0, maximumLevel: 0 },
        terrain: { type: "quantized-mesh", url: "/api/v1/map/terrain/" },
        roads: {
          type: "mvt",
          layer: "roads",
          minimumLevel: 6,
          maximumLevel: 14,
        },
      },
    });
  });

  it("拒绝 ready 清单中的跨域底图、地形或道路地址", async () => {
    for (const layers of [
      { basemap: { type: "xyz", urlTemplate: "https://tiles.example.com/{z}/{x}/{y}.png" } },
      { terrain: { type: "quantized-mesh", url: "//terrain.example.com/data" } },
      {
        roads: {
          type: "mvt",
          urlTemplate: "https://roads.example.com/{z}/{x}/{y}.mvt",
          layer: "roads",
          minimumLevel: 6,
          maximumLevel: 14,
        },
      },
    ]) {
      const manifest = readyManifest({
        layers: { ...readyManifest().layers, ...layers },
      });
      const fetcher = vi.fn(async () => new Response(JSON.stringify(manifest)));

      await expect(fetchMapManifest(fetcher, "http://127.0.0.1:8123/app/"))
        .rejects.toBeInstanceOf(MapManifestError);
    }
  });

  it("拒绝非法 XYZ 层级范围", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(readyManifest({
      layers: {
        ...readyManifest().layers,
        basemap: {
          type: "xyz",
          urlTemplate: "/api/v1/map/tiles/{z}/{x}/{y}.png",
          minimumLevel: 8,
          maximumLevel: 2,
        },
      },
    }))));

    await expect(fetchMapManifest(fetcher)).rejects.toThrow("XYZ 层级范围无效");
  });

  it("拒绝道路 MVT 缺少占位符、图层名或使用非法层级", async () => {
    const invalidRoads = [
      {
        type: "mvt",
        urlTemplate: "/api/v1/map/roads/all.mvt",
        layer: "roads",
        minimumLevel: 6,
        maximumLevel: 14,
      },
      {
        type: "mvt",
        urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
        layer: "",
        minimumLevel: 6,
        maximumLevel: 14,
      },
      {
        type: "mvt",
        urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
        layer: "roads",
        minimumLevel: 15,
        maximumLevel: 14,
      },
      {
        type: "mvt",
        urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.pbf",
        layer: "roads",
        minimumLevel: 6,
        maximumLevel: 14,
      },
    ];

    for (const roads of invalidRoads) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify(readyManifest({
        layers: { ...readyManifest().layers, roads },
      }))));
      await expect(fetchMapManifest(fetcher)).rejects.toBeInstanceOf(MapManifestError);
    }
  });

  it("保留 missing 空状态与 invalid 可诊断错误", async () => {
    const missingFetcher = vi.fn(async () => new Response(JSON.stringify({
      status: "missing",
      package: null,
      layers: null,
      errors: [],
    })));
    const invalidFetcher = vi.fn(async () => new Response(JSON.stringify({
      status: "invalid",
      package: { id: "hubei-core", version: "2026.07" },
      layers: null,
      errors: [
        { code: "CHECKSUM_MISMATCH", message: "道路文件 SHA-256 校验失败" },
        { code: "ELEVATION_ALIGNMENT_MISMATCH", message: "DSM 与 DTM 像元未对齐" },
      ],
    })));

    await expect(fetchMapManifest(missingFetcher)).resolves.toEqual({
      status: "missing",
      package: null,
      layers: null,
      errors: [],
    });
    await expect(fetchMapManifest(invalidFetcher)).resolves.toMatchObject({
      status: "invalid",
      package: { id: "hubei-core", version: "2026.07" },
      errors: ["道路文件 SHA-256 校验失败", "DSM 与 DTM 像元未对齐"],
    });
  });

  it("把网络失败、HTTP 错误和未知状态转换为可诊断错误", async () => {
    const networkFailure = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const httpFailure = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const unsupported = vi.fn(async () => new Response(JSON.stringify({ status: "installing" })));

    await expect(fetchMapManifest(networkFailure)).rejects.toThrow("无法读取地图清单");
    await expect(fetchMapManifest(httpFailure)).rejects.toThrow("HTTP 503");
    await expect(fetchMapManifest(unsupported)).rejects.toThrow("不支持的地图清单状态");
  });
});
