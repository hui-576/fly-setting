import { describe, expect, it } from "vitest"

import { MapConfigurationError, buildMapOptions, resolveMapProvider } from "../mapConfig"

describe("地图数据提供方配置", () => {
  it("离线模式只使用本地 XYZ，不设置公网回退", () => {
    const provider = resolveMapProvider(
      {
        VITE_MAP_PROVIDER: "offline",
        VITE_OFFLINE_XYZ_URL: "./map/xyz/{z}/{x}/{y}.png",
      },
      "file:///C:/app/web/index.html",
    )
    const options = buildMapOptions(provider)

    expect(provider).toEqual({
      mode: "offline",
      xyzUrl: "./map/xyz/{z}/{x}/{y}.png",
      enabled: true,
    })
    expect(options.basemaps).toHaveLength(1)
    expect(options.basemaps[0]).toMatchObject({ show: true })
    expect(JSON.stringify(options)).not.toMatch(/tianditu|https?:\/\//i)
  })

  it("拒绝离线模式中的公网瓦片地址", () => {
    expect(() =>
      resolveMapProvider({
        VITE_MAP_PROVIDER: "offline",
        VITE_OFFLINE_XYZ_URL: "https://tiles.example.com/{z}/{x}/{y}.png",
      }),
    ).toThrow(MapConfigurationError)
  })

  it("没有安装数据包时保留本地适配器但不请求缺失瓦片", () => {
    const provider = resolveMapProvider({ VITE_MAP_PROVIDER: "offline" })

    if (provider.mode !== "offline") throw new Error("expected offline provider")
    expect(provider.enabled).toBe(false)
    expect(buildMapOptions(provider).basemaps[0]).toMatchObject({ show: false })
  })

  it("file 页面拒绝文件系统根路径和越界相对路径", () => {
    expect(() =>
      resolveMapProvider(
        { VITE_MAP_PROVIDER: "offline", VITE_OFFLINE_XYZ_URL: "/map/{z}.png" },
        "file:///C:/app/web/index.html",
      ),
    ).toThrow(MapConfigurationError)
    expect(() =>
      resolveMapProvider(
        { VITE_MAP_PROVIDER: "offline", VITE_OFFLINE_XYZ_URL: "../map/{z}.png" },
        "file:///C:/app/web/index.html",
      ),
    ).toThrow(MapConfigurationError)
  })

  it("开发天地图模式要求由环境注入 Key", () => {
    expect(() => resolveMapProvider({ VITE_MAP_PROVIDER: "tianditu" })).toThrow(
      "开发天地图 Key 未配置",
    )

    const provider = resolveMapProvider({
      VITE_MAP_PROVIDER: "tianditu",
      VITE_TDT_KEY: "local-development-key",
      VITE_DEV_TERRAIN_URL: "https://terrain.example.test/quantized-mesh",
      DEV: true,
    })
    expect(provider.mode).toBe("tianditu")
    expect(buildMapOptions(provider).basemaps[0]).toMatchObject({ type: "tdt", key: "local-development-key" })
    expect(buildMapOptions(provider)).toMatchObject({
      terrain: { url: "https://terrain.example.test/quantized-mesh", show: true },
    })
  })

  it("拒绝非 HTTP(S) 的开发在线高程地址", () => {
    expect(() => resolveMapProvider({
      VITE_MAP_PROVIDER: "tianditu",
      VITE_TDT_KEY: "local-development-key",
      VITE_DEV_TERRAIN_URL: "file:///C:/terrain",
      DEV: true,
    })).toThrow("必须使用 HTTP(S)")
  })

  it("生产构建拒绝天地图模式", () => {
    expect(() =>
      resolveMapProvider({
        VITE_MAP_PROVIDER: "tianditu",
        VITE_TDT_KEY: "local-development-key",
        DEV: false,
      }),
    ).toThrow("仅允许在开发构建中使用")
  })
})
