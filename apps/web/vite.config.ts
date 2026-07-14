import { defineConfig, loadEnv } from "vite"
import vue from "@vitejs/plugin-vue"
import { cpSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const projectDirectory = dirname(fileURLToPath(import.meta.url))
const cesiumPackage = dirname(require.resolve("mars3d-cesium/package.json"))

function copyCesiumRuntime() {
  return {
    name: "copy-mars3d-cesium-runtime",
    closeBundle() {
      cpSync(
        join(cesiumPackage, "Build", "Cesium"),
        join(projectDirectory, "dist", "mars3d-cesium"),
        { recursive: true },
      )
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, projectDirectory, "")
  if (
    command === "build"
    && (
      environment.VITE_MAP_PROVIDER === "tianditu"
      || Boolean(environment.VITE_TDT_KEY)
      || Boolean(environment.VITE_DEV_TERRAIN_URL)
    )
  ) {
    throw new Error("生产构建禁止包含天地图 Key 或开发在线高程配置")
  }
  return {
    plugins: [vue(), copyCesiumRuntime()],
    base: "./",
    build: {
      target: "es2022",
      sourcemap: false,
    },
  }
})
