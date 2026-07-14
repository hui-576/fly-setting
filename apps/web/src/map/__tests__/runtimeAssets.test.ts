import { describe, expect, it } from "vitest";

import { resolveCesiumBaseUrl } from "../runtimeAssets";

describe("Cesium 本地运行资源", () => {
  it("默认并规范化应用内路径", () => {
    expect(resolveCesiumBaseUrl()).toBe("./mars3d-cesium/");
    expect(resolveCesiumBaseUrl("./vendor/cesium")).toBe("./vendor/cesium/");
  });

  it("拒绝公网、协议相对和目录越界路径", () => {
    expect(() => resolveCesiumBaseUrl("https://cdn.example.com/cesium/")).toThrow();
    expect(() => resolveCesiumBaseUrl("//cdn.example.com/cesium/")).toThrow();
    expect(() => resolveCesiumBaseUrl("../cesium/")).toThrow();
  });
});
