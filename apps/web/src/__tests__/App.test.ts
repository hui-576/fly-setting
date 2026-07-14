import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App.vue";

const MarsMap = vi.hoisted(() => vi.fn(function MarsMapMock() {
  return {
    destroy: vi.fn(),
    level: 8,
    getExtent: () => ({ xmin: 112.2, ymin: 30.8, xmax: 112.4, ymax: 31 }),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}));
vi.mock("mars3d", () => ({ Map: MarsMap }));

describe("地图数据包状态", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { geolocation: undefined });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    MarsMap.mockClear();
  });

  it("没有安装数据包时显示明确空状态且不初始化空白地图", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "missing",
      package: null,
      layers: null,
      errors: [],
    }))));

    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.get("[data-map-data-state='missing']").text()).toContain("数据包未安装");
    expect(wrapper.get(".map-state.empty").text()).toContain("请先安装已校验的湖北地理数据包");
    expect(wrapper.get(".map-state.empty button").text()).toBe("安装或切换数据包");
    expect(MarsMap).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("损坏数据包显示全部诊断且不回退到公网地图", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "invalid",
      package: { id: "hubei-core", version: "2026.07" },
      layers: null,
      errors: [
        { code: "CHECKSUM_MISMATCH", message: "道路文件 SHA-256 校验失败" },
        { code: "ELEVATION_ALIGNMENT_MISMATCH", message: "DSM 与 DTM 像元未对齐" },
      ],
    }))));

    const wrapper = mount(App);
    await flushPromises();

    const errorState = wrapper.get(".map-state.error");
    expect(wrapper.get("[data-map-data-state='invalid']").text()).toContain("数据包不可用");
    expect(errorState.text()).toContain("道路文件 SHA-256 校验失败");
    expect(errorState.text()).toContain("DSM 与 DTM 像元未对齐");
    expect(errorState.get("button").text()).toBe("重新加载");
    expect(MarsMap).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("服务返回不支持的清单模式时显示可操作错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "installing",
      errors: [],
    }))));

    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.get("[data-map-data-state='invalid']").text()).toContain("地图配置错误");
    expect(wrapper.get(".map-state.error").text()).toContain("不支持的地图清单状态：installing");
    expect(MarsMap).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("ready 状态展示版本、双模式能力、分辨率与精度并初始化三类本地图层", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
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
        basemap: { type: "xyz", urlTemplate: "/api/v1/map/tiles/{z}/{x}/{y}.png" },
        terrain: { type: "quantized-mesh", url: "/api/v1/map/terrain" },
        roads: {
          type: "mvt",
          urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
          layer: "roads",
          minimumLevel: 0,
          maximumLevel: 14,
        },
      },
      errors: [],
    }))));

    const wrapper = mount(App);
    await flushPromises();

    const summary = wrapper.get(".map-data-summary");
    expect(summary.text()).toContain("hubei-core");
    expect(summary.text()).toContain("v2026.07");
    expect(summary.text()).toContain("DTM 裸地可用");
    expect(summary.text()).toContain("DSM 地表缺失");
    expect(summary.text()).toContain("分辨率 10m");
    expect(summary.text()).toContain("垂直精度约 3m");
    await vi.waitFor(() => {
      expect(MarsMap).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
        basemaps: [expect.objectContaining({ type: "xyz" })],
        terrain: expect.objectContaining({ type: "xyz" }),
      }));
    });
    wrapper.unmount();
  });

  it("从运行设置激活数据包后关闭对话框并重新初始化地图", async () => {
    const packageDescriptor = {
      id: "hubei-core",
      version: "2026.07",
      displayName: "湖北离线数据",
      status: "installed",
      active: true,
      obscurationMode: "surface",
      supportedObscurationModes: ["bare-earth", "surface"],
      dtm: { available: true, resolutionMeters: 10, accuracyHint: "垂直精度约 3m" },
      dsm: { available: true, resolutionMeters: 10, accuracyHint: "垂直精度约 3m" },
    };
    const mapManifest = {
      status: "ready",
      package: packageDescriptor,
      layers: {
        basemap: { type: "xyz", urlTemplate: "/api/v1/map/xyz/{z}/{x}/{y}.png" },
        terrain: { type: "quantized-mesh", url: "/api/v1/map/terrain" },
        roads: {
          type: "mvt",
          urlTemplate: "/api/v1/map/roads/{z}/{x}/{y}.mvt",
          layer: "roads",
          minimumLevel: 0,
          maximumLevel: 14,
        },
      },
      errors: [],
    };
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, ...(init ? { init } : {}) });
      if (url.startsWith("/api/v1/data-packages?")) {
        return new Response(JSON.stringify({ data: [packageDescriptor] }));
      }
      if (url === "/api/v1/data-packages/active") {
        return new Response(JSON.stringify({ data: packageDescriptor }));
      }
      return new Response(JSON.stringify(mapManifest));
    }));

    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await wrapper.get("[data-open-data-settings]").trigger("click");
    await flushPromises();
    expect(wrapper.get("[role='dialog']").text()).toContain("湖北离线数据");

    await wrapper.get("input[value='surface']").setValue(true);
    await wrapper.get("form[data-activate-form]").trigger("submit");
    await flushPromises();

    expect(wrapper.find("[role='dialog']").exists()).toBe(false);
    expect(requests.find((request) => request.url === "/api/v1/data-packages/active")?.init?.body)
      .toBe(JSON.stringify({
        packageId: "hubei-core",
        version: "2026.07",
        obscurationMode: "surface",
      }));
    expect(MarsMap).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
