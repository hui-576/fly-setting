import { PbfWriter } from "pbf";
import { describe, expect, it, vi } from "vitest";

import {
  decodeRoadVectorTile,
  readRoadVectorTileResponse,
  selectVisibleRoadTiles,
} from "../roadVectorTiles";
import { createRoadVectorTileAdapter } from "../roadVectorTileAdapter";

function writeRoadValue(_: null, writer: PbfWriter): void {
  writer.writeStringField(1, "Main Road");
}

interface RoadFixtureOptions {
  featureCount: number;
  coordinatesPerFeature: number;
}

function writeRoadFeature(coordinatesPerFeature: number, writer: PbfWriter): void {
  writer.writeVarintField(1, 7);
  writer.writePackedVarint(2, [0, 0]);
  writer.writeVarintField(3, 2);
  const lineToCount = coordinatesPerFeature - 1;
  writer.writePackedVarint(4, [
    9,
    0,
    0,
    (lineToCount << 3) | 2,
    ...Array.from({ length: lineToCount * 2 }, () => 1),
  ]);
}

function writeRoadLayer(options: RoadFixtureOptions, writer: PbfWriter): void {
  writer.writeStringField(1, "roads");
  for (let index = 0; index < options.featureCount; index += 1) {
    writer.writeMessage(2, writeRoadFeature, options.coordinatesPerFeature);
  }
  writer.writeStringField(3, "name");
  writer.writeMessage(4, writeRoadValue, null);
  writer.writeVarintField(5, 4096);
  writer.writeVarintField(15, 2);
}

function roadTileFixture(
  options: RoadFixtureOptions = { featureCount: 1, coordinatesPerFeature: 2 },
): Uint8Array {
  const writer = new PbfWriter();
  writer.writeMessage(3, writeRoadLayer, options);
  return writer.finish();
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

describe("道路矢量瓦片核心", () => {
  it("按当前视域和层级选择 Web Mercator 瓦片并限制单次数量", () => {
    const tiles = selectVisibleRoadTiles(
      { xmin: 108.3, ymin: 29, xmax: 116.2, ymax: 33.3 },
      30,
      { minimumLevel: 6, maximumLevel: 14, maximumTiles: 3 },
    );

    expect(tiles).toHaveLength(3);
    expect(tiles.every((tile) => tile.z === 14)).toBe(true);
    expect(new Set(tiles.map((tile) => tile.key)).size).toBe(3);
    expect(tiles.every((tile) => tile.x >= 0 && tile.y >= 0)).toBe(true);
  });

  it("拒绝无法用于瓦片计算的地图层级或视域", () => {
    const selection = { minimumLevel: 6, maximumLevel: 14, maximumTiles: 3 };
    expect(() => selectVisibleRoadTiles(
      { xmin: 108, ymin: 29, xmax: 116, ymax: Number.NaN },
      8,
      selection,
    )).toThrow("地图视域无效");
    expect(() => selectVisibleRoadTiles(
      { xmin: 108, ymin: 29, xmax: 116, ymax: 33 },
      Number.NaN,
      selection,
    )).toThrow("地图层级无效");
  });

  it("正确解码指定 layer 的 MVT 道路线要素为 GeoJSON", () => {
    const decoded = decodeRoadVectorTile(roadTileFixture(), "roads", { z: 0, x: 0, y: 0 });

    expect(decoded).toMatchObject({
      type: "FeatureCollection",
      features: [{
        id: 7,
        type: "Feature",
        properties: { name: "Main Road" },
        geometry: { type: "LineString" },
      }],
    });
    const firstPosition = decoded.features[0]?.geometry.coordinates[0] as number[];
    expect(firstPosition[0]).toBe(-180);
    expect(firstPosition[1]).toBeCloseTo(85.0511287798066, 10);
  });

  it("合法空道路图层返回空集合而不是运行时错误", () => {
    const decoded = decodeRoadVectorTile(
      new Uint8Array([0x1a, 0x0c, 0x0a, 0x05, 0x72, 0x6f, 0x61, 0x64, 0x73, 0x28, 0x80, 0x20, 0x78, 0x02]),
      "roads",
      { z: 8, x: 207, y: 105 },
    );

    expect(decoded).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("把空或损坏的 MVT 转为可诊断解码错误", () => {
    expect(() => decodeRoadVectorTile(new Uint8Array(), "roads", { z: 6, x: 51, y: 26 }))
      .toThrow("道路矢量瓦片为空");
    expect(() => decodeRoadVectorTile(new Uint8Array([0xff, 0xff]), "roads", {
      z: 6,
      x: 51,
      y: 26,
    })).toThrow("道路矢量瓦片解码失败");
  });

  it("拒绝解码后要素或坐标数量超过内存预算的 MVT", () => {
    expect(() => decodeRoadVectorTile(
      roadTileFixture({ featureCount: 5_001, coordinatesPerFeature: 2 }),
      "roads",
      { z: 8, x: 207, y: 104 },
    )).toThrow("要素数量超过上限");
    expect(() => decodeRoadVectorTile(
      roadTileFixture({ featureCount: 1, coordinatesPerFeature: 50_001 }),
      "roads",
      { z: 8, x: 207, y: 104 },
    )).toThrow("坐标数量超过上限");
  });

  it("在读取响应体前拒绝 Content-Length 声明超过 16 MiB 的 MVT", async () => {
    const arrayBuffer = vi.fn(async () => exactArrayBuffer(roadTileFixture()));
    const response = {
      headers: new Headers({ "content-length": String(16 * 1024 * 1024 + 1) }),
      arrayBuffer,
    } as unknown as Response;

    await expect(readRoadVectorTileResponse(response)).rejects.toThrow("超过 16 MiB");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("读取后按实际字节数拒绝未声明长度的超大 MVT", async () => {
    const oversized = new ArrayBuffer(16 * 1024 * 1024 + 1);
    const arrayBuffer = vi.fn(async () => oversized);
    const response = {
      headers: new Headers(),
      arrayBuffer,
    } as unknown as Response;

    await expect(readRoadVectorTileResponse(response)).rejects.toThrow("超过 16 MiB");
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });

  it("接受声明长度和实际字节数均在上限内的 MVT", async () => {
    const fixture = roadTileFixture();
    const response = new Response(exactArrayBuffer(fixture), {
      headers: { "content-length": String(fixture.byteLength) },
    });

    await expect(readRoadVectorTileResponse(response)).resolves.toEqual(fixture);
  });

  it("缓存已解码瓦片、响应相机移动并控制道路显隐和清理", async () => {
    let extent = { xmin: 112.2, ymin: 30.8, xmax: 112.4, ymax: 31 };
    const listeners = new Map<string, () => void>();
    const addLayer = vi.fn();
    const removeLayer = vi.fn();
    const map = {
      level: 6,
      getExtent: () => extent,
      addLayer,
      removeLayer,
      on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
      off: vi.fn((event: string) => listeners.delete(event)),
    };
    const fetcher = vi.fn(async (
      _input: string,
      _init: { headers: { accept: string }; signal: AbortSignal },
    ) => new Response(exactArrayBuffer(roadTileFixture())));
    const createLayer = vi.fn((data: unknown, key: string) => ({ data, key, show: true }));
    const adapter = createRoadVectorTileAdapter(map, {
      type: "mvt",
      urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
      layer: "roads",
      minimumLevel: 6,
      maximumLevel: 14,
    }, vi.fn(), {
      fetcher,
      createLayer,
      cameraMoveEndEvent: "cameraMoveEnd",
      maximumTiles: 1,
      maximumCachedTiles: 4,
    });

    await adapter.refresh();
    await adapter.refresh();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toMatch(/^\/api\/v1\/map\/roads\/6\/\d+\/\d+\.mvt$/);
    expect(addLayer).toHaveBeenCalledOnce();

    extent = { xmin: 116, ymin: 30.8, xmax: 116.1, ymax: 31 };
    listeners.get("cameraMoveEnd")?.();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(addLayer).toHaveBeenCalledTimes(2));
    expect(removeLayer).toHaveBeenCalledTimes(1);

    await adapter.setVisible(false);
    expect(removeLayer).toHaveBeenCalledTimes(2);
    await adapter.setVisible(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(addLayer).toHaveBeenCalledTimes(3);

    adapter.destroy();
    expect(map.off).toHaveBeenCalledWith("cameraMoveEnd", expect.any(Function));
    expect(removeLayer).toHaveBeenCalledTimes(3);
  });

  it("以浏览器全局对象调用 fetch，避免原生方法 Illegal invocation", async () => {
    let receiver: unknown;
    const fetcher = vi.fn(function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response(exactArrayBuffer(roadTileFixture())));
    });
    const map = {
      level: 8,
      getExtent: () => ({ xmin: 112.2, ymin: 30.8, xmax: 112.4, ymax: 31 }),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const adapter = createRoadVectorTileAdapter(map, {
      type: "mvt",
      urlTemplate: "/roads/{z}/{x}/{y}.mvt",
      layer: "roads",
      minimumLevel: 8,
      maximumLevel: 8,
    }, vi.fn(), { fetcher, createLayer: () => ({ show: true }), maximumTiles: 1 });

    await adapter.refresh();

    expect(receiver).toBe(globalThis);
    adapter.destroy();
  });

  it("限制并行瓦片加载，避免多个 16 MiB 响应同时驻留", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const resolvers: Array<() => void> = [];
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      resolvers.push(() => {
        activeRequests -= 1;
        resolve(new Response(exactArrayBuffer(roadTileFixture())));
      });
    }));
    const map = {
      level: 8,
      getExtent: () => ({ xmin: 111, ymin: 30, xmax: 114, ymax: 32 }),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const adapter = createRoadVectorTileAdapter(map, {
      type: "mvt",
      urlTemplate: "/roads/{z}/{x}/{y}.mvt",
      layer: "roads",
      minimumLevel: 8,
      maximumLevel: 8,
    }, vi.fn(), {
      fetcher,
      createLayer: () => ({ show: true }),
      maximumTiles: 4,
      maximumConcurrentRequests: 2,
    });

    const refresh = adapter.refresh();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(maximumActiveRequests).toBe(2);
    resolvers.splice(0, 2).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    expect(maximumActiveRequests).toBe(2);
    resolvers.splice(0).forEach((resolve) => resolve());
    await refresh;
    adapter.destroy();
  });

  it("缓存同时受坐标预算约束，超出后重新获取已淘汰瓦片", async () => {
    let extent = { xmin: 112.2, ymin: 30.8, xmax: 112.4, ymax: 31 };
    const fetcher = vi.fn(async () => new Response(exactArrayBuffer(roadTileFixture())));
    const map = {
      level: 8,
      getExtent: () => extent,
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const adapter = createRoadVectorTileAdapter(map, {
      type: "mvt",
      urlTemplate: "/roads/{z}/{x}/{y}.mvt",
      layer: "roads",
      minimumLevel: 8,
      maximumLevel: 8,
    }, vi.fn(), {
      fetcher,
      createLayer: () => ({ show: true }),
      maximumTiles: 1,
      maximumCachedCoordinates: 2,
    });

    await adapter.refresh();
    extent = { xmin: 115, ymin: 30.8, xmax: 115.1, ymax: 31 };
    await adapter.refresh();
    extent = { xmin: 112.2, ymin: 30.8, xmax: 112.4, ymax: 31 };
    await adapter.refresh();

    expect(fetcher).toHaveBeenCalledTimes(3);
    adapter.destroy();
  });

  it("隐藏或销毁时取消未完成请求且不把取消报告为运行时错误", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: string, init: { signal: AbortSignal }) => new Promise<Response>(
      (_resolve, reject) => {
        requestSignal = init.signal;
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      },
    ));
    const onError = vi.fn();
    const map = {
      level: 6,
      getExtent: () => ({ xmin: 112.2, ymin: 30.8, xmax: 112.4, ymax: 31 }),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const adapter = createRoadVectorTileAdapter(map, {
      type: "mvt",
      urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
      layer: "roads",
      minimumLevel: 6,
      maximumLevel: 14,
    }, onError, { fetcher, createLayer: vi.fn(), maximumTiles: 1 });

    const refresh = adapter.refresh();
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    adapter.destroy();
    await refresh;

    expect(requestSignal?.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("请求中隐藏后再次显示会重新请求而不是复用已取消任务", async () => {
    let firstSignal: AbortSignal | undefined;
    const fetcher = vi.fn((
      _input: string,
      init: { headers: { accept: string }; signal: AbortSignal },
    ) => {
      if (fetcher.mock.calls.length === 1) {
        firstSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }
      return Promise.resolve(new Response(exactArrayBuffer(roadTileFixture())));
    });
    const map = {
      level: 6,
      getExtent: () => ({ xmin: 112.2, ymin: 30.8, xmax: 112.4, ymax: 31 }),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const adapter = createRoadVectorTileAdapter(map, {
      type: "mvt",
      urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
      layer: "roads",
      minimumLevel: 6,
      maximumLevel: 14,
    }, vi.fn(), { fetcher, createLayer: () => ({ show: true }), maximumTiles: 1 });

    const firstRefresh = adapter.refresh();
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    await adapter.setVisible(false);
    await adapter.setVisible(true);
    await firstRefresh;

    expect(firstSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(map.addLayer).toHaveBeenCalledOnce();
    adapter.destroy();
  });

  it("销毁发生在异步图层创建期间时释放未挂载图层", async () => {
    const orphanLayer = { show: true, destroy: vi.fn() };
    let resolveLayer: ((layer: typeof orphanLayer) => void) | undefined;
    const createLayer = vi.fn(() => new Promise<typeof orphanLayer>((resolve) => {
      resolveLayer = resolve;
    }));
    const map = {
      level: 6,
      getExtent: () => ({ xmin: 112.2, ymin: 30.8, xmax: 112.4, ymax: 31 }),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    const adapter = createRoadVectorTileAdapter(map, {
      type: "mvt",
      urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
      layer: "roads",
      minimumLevel: 6,
      maximumLevel: 14,
    }, vi.fn(), {
      fetcher: async () => new Response(exactArrayBuffer(roadTileFixture())),
      createLayer,
      maximumTiles: 1,
    });

    const refresh = adapter.refresh();
    await vi.waitFor(() => expect(createLayer).toHaveBeenCalledOnce());
    adapter.destroy();
    resolveLayer?.(orphanLayer);
    await refresh;

    expect(map.addLayer).not.toHaveBeenCalled();
    expect(orphanLayer.destroy).toHaveBeenCalledOnce();
  });
});
