import { describe, expect, it, vi } from "vitest"

import { MapRuntimeError, createMapController } from "../mapController"
import { RoadVectorTileError } from "../roadVectorTiles"

const options = { scene: { center: { lat: 30.9, lng: 112.3, alt: 900000 } }, basemaps: [] }

describe("Mars3D 运行控制器", () => {
  it("通过注入的真实构造器初始化并销毁地图", () => {
    const destroy = vi.fn()
    const zoomIn = vi.fn()
    const zoomOut = vi.fn()
    const setCameraView = vi.fn()
    const MapConstructor = vi.fn(() => ({ destroy, zoomIn, zoomOut, setCameraView }))
    const host = document.createElement("div")
    const controller = createMapController(MapConstructor, host, options)

    expect(MapConstructor).toHaveBeenCalledOnce()
    expect(MapConstructor).toHaveBeenCalledWith(host, options)
    controller.zoomIn()
    controller.zoomOut()
    controller.showHubei()
    controller.destroy()
    controller.destroy()
    expect(destroy).toHaveBeenCalledOnce()
    expect(zoomIn).toHaveBeenCalledOnce()
    expect(zoomOut).toHaveBeenCalledOnce()
    expect(setCameraView).toHaveBeenCalledWith({ lat: 30.9, lng: 112.3, alt: 900000 })
  })

  it("构造失败时抛出可诊断错误而不是留下空白地图", () => {
    const MapConstructor = vi.fn(() => {
      throw new Error("WebGL unavailable")
    })

    expect(() => createMapController(MapConstructor, document.createElement("div"), options)).toThrow(
      MapRuntimeError,
    )
  })

  it("把本地底图瓦片和深层地形加载失败转为可操作错误", () => {
    const listeners = new Map<string, (event: unknown) => void>()
    const layer = (prefix: string) => ({
      on: vi.fn((event: string, listener: (value: unknown) => void) => listeners.set(`${prefix}:${event}`, listener)),
      off: vi.fn(),
    })
    const basemap = layer("basemap")
    const terrainError = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const MapConstructor = vi.fn(() => ({
      destroy: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      getLayerById: () => basemap,
      terrainProvider: { errorEvent: terrainError },
    }))
    const onRuntimeError = vi.fn()

    createMapController(MapConstructor, document.createElement("div"), options, onRuntimeError)
    listeners.get("basemap:addTileError")?.({ url: "/tiles/0/0/0.png" })
    const terrainListener = terrainError.addEventListener.mock.calls[0]?.[0]
    terrainListener?.({ message: "tile unavailable" })

    expect(onRuntimeError.mock.calls.map(([error]) => error.message)).toEqual([
      "本地 XYZ 瓦片加载失败，请检查数据包文件与瓦片层级",
      "地图高程瓦片加载失败，请检查 Quantized Mesh 数据",
    ])
  })

  it("接入道路 MVT 适配器并统一控制底图、地形和道路显隐及销毁", async () => {
    const basemap = { show: true, on: vi.fn(), off: vi.fn() }
    const map = {
      level: 8,
      hasTerrain: true,
      destroy: vi.fn(),
      getExtent: vi.fn(() => ({ xmin: 108, ymin: 29, xmax: 116, ymax: 33 })),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
      getLayerById: vi.fn(() => basemap),
    }
    const MapConstructor = vi.fn((_host: HTMLElement, _options: unknown) => map)
    const roadAdapter = {
      refresh: vi.fn(async () => undefined),
      setVisible: vi.fn(async () => undefined),
      destroy: vi.fn(),
    }
    let reportRoadError: ((error: RoadVectorTileError) => void) | undefined
    const createRoadAdapter = vi.fn((_map, _manifest, onError) => {
      reportRoadError = onError
      return roadAdapter
    })
    const onRuntimeError = vi.fn()
    const roadManifest = {
      type: "mvt" as const,
      urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
      layer: "roads",
      minimumLevel: 6,
      maximumLevel: 14,
    }

    const host = document.createElement("div")
    const controller = createMapController(
      MapConstructor,
      host,
      { ...options, roadVectorTiles: roadManifest },
      onRuntimeError,
      { createRoadAdapter },
    )
    await controller.setLayerVisible("basemap", false)
    await controller.setLayerVisible("terrain", false)
    await controller.setLayerVisible("roads", false)
    reportRoadError?.(new RoadVectorTileError("道路矢量瓦片解码失败"))

    expect(MapConstructor).toHaveBeenCalledWith(host, expect.anything())
    expect(MapConstructor.mock.calls[0]?.[1]).not.toHaveProperty("roadVectorTiles")
    expect(basemap.show).toBe(false)
    expect(map.hasTerrain).toBe(false)
    expect(roadAdapter.setVisible).toHaveBeenCalledWith(false)
    expect(onRuntimeError.mock.calls[0]?.[0]).toBeInstanceOf(MapRuntimeError)

    controller.destroy()
    expect(roadAdapter.destroy).toHaveBeenCalledOnce()
    expect(map.destroy).toHaveBeenCalledOnce()
  })

  it("道路适配器初始化失败时清理已创建的 Mars3D 地图", () => {
    const destroy = vi.fn()
    const MapConstructor = vi.fn(() => ({
      level: 8,
      destroy,
      getExtent: () => ({ xmin: 108, ymin: 29, xmax: 116, ymax: 33 }),
      addLayer: vi.fn(),
      removeLayer: vi.fn(),
    }))
    const roadVectorTiles = {
      type: "mvt" as const,
      urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
      layer: "roads",
      minimumLevel: 6,
      maximumLevel: 14,
    }

    expect(() => createMapController(
      MapConstructor,
      document.createElement("div"),
      { ...options, roadVectorTiles },
      undefined,
      { createRoadAdapter: () => { throw new Error("adapter unavailable") } },
    )).toThrow(MapRuntimeError)
    expect(destroy).toHaveBeenCalledOnce()
  })
})
