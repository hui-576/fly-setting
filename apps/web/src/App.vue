<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import DataPackageSettings from "./components/DataPackageSettings.vue";
import { dataPackageClient, type DataPackageDescriptor } from "./dataPackages/dataPackageClient";
import { buildMapOptions, resolveMapProvider, type MapProvider } from "./map/mapConfig";
import { fetchMapManifest, type MapPackageInfo } from "./map/mapManifest";
import { locateInitialView } from "./map/location";
import { createMapController, type MapController } from "./map/mapController";

type RuntimeState = "loading" | "ready" | "empty" | "error";
type MapDataState = "loading" | "ready" | "missing" | "invalid" | "development";

const host = ref<HTMLElement>();
const runtimeState = ref<RuntimeState>("loading");
const statusMessage = ref("正在初始化 Mars3D 与本地资源");
const providerLabel = ref("正在检查数据包");
const mapDataState = ref<MapDataState>("loading");
const packageInfo = ref<MapPackageInfo>();
const manifestErrors = ref<string[]>([]);
const dataSettingsOpen = ref(false);
const layerVisibility = ref({ basemap: true, terrain: true, roads: true });
let controller: MapController | undefined;

const statusTitle = computed(() => ({
  loading: "地图启动检查",
  ready: "Mars3D 地图已就绪",
  empty: "尚未安装地图数据包",
  error: "地图启动失败",
})[runtimeState.value]);

function resetMapRuntime(): void {
  controller?.destroy();
  controller = undefined;
  runtimeState.value = "loading";
  mapDataState.value = "loading";
  layerVisibility.value = { basemap: true, terrain: true, roads: true };
  packageInfo.value = undefined;
  manifestErrors.value = [];
}

async function resolveRuntimeProvider(): Promise<MapProvider | undefined> {
  const selection = resolveMapProvider(import.meta.env);
  if (selection.mode !== "offline") {
    mapDataState.value = "development";
    providerLabel.value = "开发天地图 · 在线高程";
    return selection;
  }
  const manifest = await fetchMapManifest();
  if (manifest.status === "missing") {
    mapDataState.value = "missing";
    providerLabel.value = "数据包未安装";
    statusMessage.value = "请先安装已校验的湖北地理数据包，然后重新检查";
    runtimeState.value = "empty";
    return undefined;
  }
  if (manifest.status === "invalid") {
    mapDataState.value = "invalid";
    providerLabel.value = "数据包不可用";
    manifestErrors.value = manifest.errors;
    statusMessage.value = manifest.errors[0] || "数据包校验失败，请重新安装或切换有效版本";
    runtimeState.value = "error";
    return undefined;
  }
  packageInfo.value = manifest.package;
  mapDataState.value = "ready";
  providerLabel.value = `${manifest.package.id} · ${manifest.package.version}`;
  return { mode: "offline", manifest };
}

async function createRuntimeMap(provider: MapProvider): Promise<void> {
  if (!host.value) return;
  const mars3d = await import("mars3d");
  const initialView = await locateInitialView(navigator.geolocation);
  const options = buildMapOptions(provider);
  options.scene.center = {
    lat: initialView.latitude,
    lng: initialView.longitude,
    alt: initialView.altitude,
  };
  controller = createMapController(
    (mapHost, mapOptions) => new mars3d.Map(mapHost, mapOptions),
    host.value,
    options,
    (error) => {
      statusMessage.value = error.message;
      mapDataState.value = "invalid";
      providerLabel.value = "本地图层异常";
      runtimeState.value = "error";
    },
  );
  statusMessage.value = initialView.source === "device"
    ? "已定位当前位置"
    : "定位不可用，已设置湖北视角";
  runtimeState.value = "ready";
}

async function initializeMap(): Promise<void> {
  if (!host.value) return;
  resetMapRuntime();
  try {
    const provider = await resolveRuntimeProvider();
    if (!provider) return;
    await createRuntimeMap(provider);
  } catch (error) {
    if (mapDataState.value === "loading") {
      mapDataState.value = "invalid";
      providerLabel.value = "地图配置错误";
    }
    statusMessage.value = error instanceof Error ? error.message : "未知地图错误";
    runtimeState.value = "error";
  }
}

function handleDataPackageActivated(_dataPackage: DataPackageDescriptor): void {
  dataSettingsOpen.value = false;
  void initializeMap();
}

async function setLayerVisible(
  layer: "basemap" | "terrain" | "roads",
  visible: boolean,
): Promise<void> {
  layerVisibility.value = { ...layerVisibility.value, [layer]: visible };
  try {
    await controller?.setLayerVisible(layer, visible);
  } catch (error) {
    layerVisibility.value = { ...layerVisibility.value, [layer]: !visible };
    statusMessage.value = error instanceof Error ? error.message : "图层切换失败";
    runtimeState.value = "error";
  }
}

onMounted(() => void initializeMap());
onBeforeUnmount(() => {
  controller?.destroy();
  controller = undefined;
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-mark" aria-hidden="true"><i></i><b></b><i></i></div>
      <div class="brand-copy">
        <strong>视距通信智能规划</strong>
        <span>系留无人机升空规划工具</span>
      </div>
      <div class="topbar-spacer"></div>
      <span
        class="status-chip"
        :class="{ warning: mapDataState === 'missing' || mapDataState === 'development', danger: mapDataState === 'invalid' }"
        :data-map-data-state="mapDataState"
      ><i></i>{{ providerLabel }}</span>
      <span class="status-chip muted">单机模式</span>
      <button
        data-open-data-settings
        class="secondary-button"
        type="button"
        @click="dataSettingsOpen = true"
      >运行设置</button>
    </header>

    <section class="workflow" aria-label="规划流程">
      <div class="workflow-intro"><small>规划流程</small><b>确定升空位置与最低高度</b></div>
      <ol>
        <li class="active"><span>1</span><b>设置任务点</b><small>等待录入</small></li>
        <li><span>2</span><b>分析条件</b><small>地形与参数</small></li>
        <li><span>3</span><b>升空范围</b><small>道路或手绘</small></li>
        <li><span>4</span><b>生成方案</b><small>视距求解</small></li>
        <li><span>5</span><b>推荐结果</b><small>等待计算</small></li>
      </ol>
      <button class="primary-button" type="button" disabled>生成升空方案</button>
    </section>

    <main class="workspace">
      <aside class="left-panel">
        <nav aria-label="任务工作区">
          <button class="active" type="button">任务库</button>
          <button type="button">任务点</button>
          <button type="button">参数</button>
          <button type="button">限制区</button>
        </nav>
        <div class="panel-content empty-state">
          <div class="empty-symbol" aria-hidden="true"></div>
          <h2>尚无规划任务</h2>
          <p>新建任务后，在 Mars3D 地图上设置通信目标。</p>
          <button class="primary-button" type="button">新建任务</button>
        </div>
      </aside>

      <section class="map-stage" data-map-engine="mars3d" aria-label="Mars3D 地图工作台">
        <div ref="host" class="mars3d-host"></div>
        <div
          v-if="runtimeState !== 'ready'"
          class="map-state"
          :class="runtimeState"
          :role="runtimeState === 'error' ? 'alert' : 'status'"
        >
          <span class="state-indicator" aria-hidden="true"></span>
          <h1>{{ statusTitle }}</h1>
          <p>{{ statusMessage }}</p>
          <ul v-if="manifestErrors.length > 1" class="map-error-list">
            <li v-for="message in manifestErrors.slice(1)" :key="message">{{ message }}</li>
          </ul>
          <button
            v-if="runtimeState === 'error' || runtimeState === 'empty'"
            class="secondary-button"
            type="button"
            @click="runtimeState === 'empty' ? dataSettingsOpen = true : initializeMap()"
          >{{ runtimeState === "empty" ? "安装或切换数据包" : "重新加载" }}</button>
        </div>
        <div v-else class="map-ready-label"><i></i>{{ statusMessage }}</div>
        <section v-if="packageInfo" class="map-data-summary" aria-label="当前地图数据包">
          <header><b>{{ packageInfo.id }}</b><span>v{{ packageInfo.version }}</span></header>
          <dl>
            <div><dt>DTM 裸地</dt><dd>{{ packageInfo.dtm.available ? "可用" : "缺失" }}</dd></div>
            <div><dt>DSM 地表</dt><dd>{{ packageInfo.dsm.available ? "可用" : "缺失" }}</dd></div>
          </dl>
          <p v-if="packageInfo.dtm.resolutionMeters || packageInfo.dsm.resolutionMeters">
            分辨率 {{ packageInfo.dtm.resolutionMeters ?? packageInfo.dsm.resolutionMeters }}m
          </p>
          <p>当前模式 {{ packageInfo.obscurationMode === "surface" ? "DSM 地表" : "DTM 裸地" }}</p>
          <p v-if="packageInfo.dtm.accuracyHint || packageInfo.dsm.accuracyHint">
            {{ packageInfo.dtm.accuracyHint ?? packageInfo.dsm.accuracyHint }}
          </p>
        </section>
        <div class="map-tools" aria-label="地图工具">
          <button type="button" title="放大" aria-label="放大" @click="controller?.zoomIn()">＋</button>
          <button type="button" title="缩小" aria-label="缩小" @click="controller?.zoomOut()">−</button>
          <button type="button" title="定位湖北" aria-label="定位湖北" @click="controller?.showHubei()">◎</button>
        </div>
        <details v-if="mapDataState === 'ready'" class="map-layer-control">
          <summary>图层</summary>
          <label><input
            type="checkbox"
            :checked="layerVisibility.basemap"
            @change="setLayerVisible('basemap', ($event.target as HTMLInputElement).checked)"
          >本地底图</label>
          <label><input
            type="checkbox"
            :checked="layerVisibility.terrain"
            @change="setLayerVisible('terrain', ($event.target as HTMLInputElement).checked)"
          >量化网格地形</label>
          <label><input
            type="checkbox"
            :checked="layerVisibility.roads"
            @change="setLayerVisible('roads', ($event.target as HTMLInputElement).checked)"
          >道路矢量瓦片</label>
        </details>
      </section>

      <aside class="right-panel">
        <header><span class="inspector-icon"></span><div><b>方案检查器</b><small>未选择对象</small></div></header>
        <div class="panel-content empty-state compact">
          <div class="route-symbol" aria-hidden="true"></div>
          <p>设置任务点和分析条件后，候选位置与最低高度将在这里显示。</p>
        </div>
      </aside>
    </main>

    <footer class="statusbar">
      <span>候选点 <b>0</b></span><span>结果 <b>—</b></span><span class="footer-spacer"></span><span>{{ statusTitle }}</span>
    </footer>

    <DataPackageSettings
      v-if="dataSettingsOpen"
      :client="dataPackageClient"
      @close="dataSettingsOpen = false"
      @activated="handleDataPackageActivated"
    />
  </div>
</template>
