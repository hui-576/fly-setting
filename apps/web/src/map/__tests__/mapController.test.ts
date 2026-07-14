import { describe, expect, it, vi } from "vitest"

import { MapRuntimeError, createMapController } from "../mapController"

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
})
