<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { buildMapOptions, resolveMapProvider } from "./map/mapConfig";
import { locateInitialView } from "./map/location";
import { createMapController, type MapController } from "./map/mapController";

type RuntimeState = "loading" | "ready" | "error";

const host = ref<HTMLElement>();
const runtimeState = ref<RuntimeState>("loading");
const statusMessage = ref("正在初始化 Mars3D 与本地资源");
const providerLabel = ref("离线 XYZ");
const mapDataState = ref<"available" | "missing">("missing");
let controller: MapController | undefined;

const statusTitle = computed(() => ({
  loading: "地图启动检查",
  ready: "Mars3D 地图已就绪",
  error: "地图启动失败",
})[runtimeState.value]);

async function initializeMap(): Promise<void> {
  if (!host.value) return;
  controller?.destroy();
  controller = undefined;
  runtimeState.value = "loading";
  try {
    const mars3d = await import("mars3d");
    const provider = resolveMapProvider(import.meta.env);
    mapDataState.value = provider.mode === "offline" && !provider.enabled ? "missing" : "available";
    providerLabel.value = provider.mode === "offline"
      ? (provider.enabled ? "离线 XYZ" : "本地底图待安装")
      : "开发天地图";
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
        runtimeState.value = "error";
      },
    );
    const locationMessage = initialView.source === "device" ? "已定位当前位置" : "定位不可用，已设置湖北视角";
    statusMessage.value = mapDataState.value === "missing"
      ? `${locationMessage}；本地底图待安装`
      : locationMessage;
    runtimeState.value = "ready";
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "未知地图错误";
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
        :class="{ warning: mapDataState === 'missing' }"
        :data-map-data-state="mapDataState"
      ><i></i>{{ providerLabel }}</span>
      <span class="status-chip muted">单机模式</span>
      <button class="secondary-button" type="button">运行设置</button>
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
        <div v-if="runtimeState !== 'ready'" class="map-state" :class="runtimeState" role="status">
          <span class="state-indicator" aria-hidden="true"></span>
          <h1>{{ statusTitle }}</h1>
          <p>{{ statusMessage }}</p>
          <button v-if="runtimeState === 'error'" class="secondary-button" type="button" @click="initializeMap">重新加载</button>
        </div>
        <div v-else class="map-ready-label"><i></i>{{ statusMessage }}</div>
        <div class="map-tools" aria-label="地图工具">
          <button type="button" title="放大" aria-label="放大" @click="controller?.zoomIn()">＋</button>
          <button type="button" title="缩小" aria-label="缩小" @click="controller?.zoomOut()">−</button>
          <button type="button" title="定位湖北" aria-label="定位湖北" @click="controller?.showHubei()">◎</button>
        </div>
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
  </div>
</template>
