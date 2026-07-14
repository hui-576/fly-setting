import { describe, expect, it, vi } from "vitest"

import { HUBEI_VIEW, locateInitialView } from "../location"

describe("地图初始定位", () => {
  it("定位成功时使用设备坐标", async () => {
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) =>
        success({ coords: { longitude: 114.3055, latitude: 30.5928 } } as GeolocationPosition),
      ),
    } as unknown as Geolocation

    await expect(locateInitialView(geolocation)).resolves.toEqual({
      source: "device",
      longitude: 114.3055,
      latitude: 30.5928,
      altitude: 12000,
    })
  })

  it("拒绝权限或无定位能力时回落湖北范围且保持可用", async () => {
    const denied = {
      getCurrentPosition: vi.fn((_success: PositionCallback, error: PositionErrorCallback) =>
        error({ code: 1, message: "denied" } as GeolocationPositionError),
      ),
    } as unknown as Geolocation

    await expect(locateInitialView(denied)).resolves.toEqual(HUBEI_VIEW)
    await expect(locateInitialView(undefined)).resolves.toEqual(HUBEI_VIEW)
  })
})
