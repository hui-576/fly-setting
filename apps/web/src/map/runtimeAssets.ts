export function resolveCesiumBaseUrl(value?: string): string {
  const candidate = value?.trim() || "./mars3d-cesium/";
  if (!candidate.startsWith("./") || candidate.includes("..") || candidate.includes(":")) {
    throw new Error("Cesium 运行资源必须使用应用内相对路径");
  }
  return candidate.endsWith("/") ? candidate : `${candidate}/`;
}
