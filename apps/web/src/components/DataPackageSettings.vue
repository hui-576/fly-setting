<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  DataPackageApiError,
  type DataPackageClient,
  type DataPackageDescriptor,
  type ObscurationMode,
} from "../dataPackages/dataPackageClient";

const props = defineProps<{ client: DataPackageClient }>();
const emit = defineEmits<{
  close: [];
  activated: [dataPackage: DataPackageDescriptor];
}>();

type ListState = "loading" | "ready" | "error";

const dialog = ref<HTMLElement>();
const packages = ref<DataPackageDescriptor[]>([]);
const listState = ref<ListState>("loading");
const listError = ref("");
const selectedKey = ref("");
const obscurationMode = ref<ObscurationMode>("bare-earth");
const sourceDirectory = ref("");
const installError = ref("");
const operationError = ref("");
const operationMessage = ref("");
const installing = ref(false);
const activating = ref(false);
const returnFocus = document.activeElement instanceof HTMLElement
  ? document.activeElement
  : undefined;

const busy = computed(() => installing.value || activating.value);
const selectedPackage = computed(() => packages.value.find(
  (entry) => packageKey(entry) === selectedKey.value,
));
const surfaceAvailable = computed(() => Boolean(
  selectedPackage.value?.dsm.available
  && selectedPackage.value.supportedObscurationModes.includes("surface"),
));
const canActivate = computed(() => Boolean(
  selectedPackage.value
  && isUsable(selectedPackage.value)
  && !busy.value,
));

function packageKey(entry: DataPackageDescriptor): string {
  return `${entry.id}::${entry.version}`;
}

function isUsable(entry: DataPackageDescriptor): boolean {
  return entry.status === "installed" && entry.dtm.available;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof DataPackageApiError ? error.message : fallback;
}

function setInitialSelection(entries: DataPackageDescriptor[]): void {
  const current = entries.find((entry) => packageKey(entry) === selectedKey.value && isUsable(entry));
  const preferred = current || entries.find((entry) => entry.active && isUsable(entry))
    || entries.find(isUsable);
  selectedKey.value = preferred ? packageKey(preferred) : "";
  if (preferred?.active && preferred.obscurationMode) {
    obscurationMode.value = preferred.obscurationMode;
  }
}

async function loadPackages(): Promise<void> {
  listState.value = "loading";
  listError.value = "";
  try {
    packages.value = await props.client.list();
    setInitialSelection(packages.value);
    listState.value = "ready";
  } catch (error) {
    listError.value = errorMessage(error, "无法读取数据包列表，请检查本地服务后重试");
    listState.value = "error";
  }
}

function upsertPackage(entry: DataPackageDescriptor): void {
  const key = packageKey(entry);
  packages.value = [
    entry,
    ...packages.value.filter((candidate) => packageKey(candidate) !== key),
  ];
  selectedKey.value = key;
}

async function installPackage(): Promise<void> {
  if (installing.value) return;
  const directory = sourceDirectory.value.trim();
  installError.value = "";
  operationError.value = "";
  operationMessage.value = "";
  if (!directory) {
    installError.value = "请输入数据包所在的本地目录";
    return;
  }
  if (directory.length > 32_767) {
    installError.value = "本地目录路径过长，请选择更短的路径";
    return;
  }
  installing.value = true;
  try {
    const installed = await props.client.install(directory);
    upsertPackage(installed);
    sourceDirectory.value = "";
    operationMessage.value = "数据包安装并校验完成，请选择遮挡模式后启用";
    listState.value = "ready";
  } catch (error) {
    operationError.value = errorMessage(error, "数据包安装失败，请核对目录和包内容后重试");
  } finally {
    installing.value = false;
  }
}

async function activatePackage(): Promise<void> {
  if (activating.value || !canActivate.value || !selectedPackage.value) return;
  operationError.value = "";
  operationMessage.value = "";
  activating.value = true;
  try {
    const activated = await props.client.activate(
      selectedPackage.value.id,
      selectedPackage.value.version,
      obscurationMode.value,
    );
    packages.value = packages.value.map((entry) => ({
      ...entry,
      active: packageKey(entry) === packageKey(activated),
    }));
    operationMessage.value = "数据包已启用，正在重新加载地图";
    emit("activated", activated);
  } catch (error) {
    operationError.value = errorMessage(error, "无法启用所选数据包，请重试");
  } finally {
    activating.value = false;
  }
}

function requestClose(): void {
  if (!busy.value) emit("close");
}

function focusableElements(): HTMLElement[] {
  if (!dialog.value) return [];
  return [...dialog.value.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )].filter((element) => !element.hasAttribute("hidden"));
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    requestClose();
    return;
  }
  if (event.key !== "Tab") return;
  const elements = focusableElements();
  if (!elements.length) return;
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

watch(selectedPackage, (entry) => {
  if (!entry || !surfaceAvailable.value) obscurationMode.value = "bare-earth";
});

onMounted(async () => {
  await nextTick();
  dialog.value?.querySelector<HTMLElement>("[data-dialog-close]")?.focus();
  void loadPackages();
});

onBeforeUnmount(() => returnFocus?.focus());
</script>

<template>
  <div class="dialog-backdrop" @mousedown.self="requestClose">
    <section
      ref="dialog"
      class="settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="data-package-settings-title"
      aria-describedby="data-package-settings-description"
      @keydown="handleDialogKeydown"
    >
      <header class="settings-dialog-header">
        <div>
          <h2 id="data-package-settings-title">地图数据包</h2>
          <p id="data-package-settings-description">安装并选择经过校验的离线地图、高程和道路数据。</p>
        </div>
        <button
          data-dialog-close
          class="dialog-close"
          type="button"
          aria-label="关闭地图数据包设置"
          :disabled="busy"
          @click="requestClose"
        >×</button>
      </header>

      <div class="settings-dialog-body">
        <section class="settings-section" aria-labelledby="installed-packages-title">
          <div class="settings-section-heading">
            <h3 id="installed-packages-title">已安装版本</h3>
            <button
              v-if="listState !== 'loading'"
              class="text-button"
              type="button"
              :disabled="busy"
              @click="loadPackages"
            >刷新</button>
          </div>

          <div v-if="listState === 'loading'" class="settings-feedback" role="status">
            <span class="mini-spinner" aria-hidden="true"></span>正在读取已安装的数据包…
          </div>
          <div v-else-if="listState === 'error'" class="settings-feedback error" role="alert">
            <p>{{ listError }}</p>
            <button data-retry-packages class="secondary-button" type="button" @click="loadPackages">重新读取</button>
          </div>
          <div v-else-if="packages.length === 0" data-package-empty class="package-empty">
            <b>尚未安装任何数据包</b>
            <span>从本机目录安装后，才能启用离线地图。</span>
          </div>
          <div v-else class="package-list" role="radiogroup" aria-label="选择数据包版本">
            <label
              v-for="entry in packages"
              :key="packageKey(entry)"
              class="package-option"
              :class="{ invalid: !isUsable(entry), selected: selectedKey === packageKey(entry) }"
              :data-package-id="entry.id"
            >
              <input
                v-model="selectedKey"
                type="radio"
                name="data-package-version"
                :value="packageKey(entry)"
                :disabled="!isUsable(entry) || busy"
              >
              <span class="package-option-main">
                <span class="package-option-title"><b>{{ entry.displayName }}</b><small>{{ entry.id }} · v{{ entry.version }}</small></span>
                <span class="package-state" :class="{ danger: !isUsable(entry), active: entry.active }">
                  {{ !isUsable(entry) ? "校验失败" : entry.active ? "当前使用" : "已校验" }}
                </span>
                <span class="package-capabilities">
                  DTM {{ entry.dtm.available ? "可用" : "缺失" }} · DSM {{ entry.dsm.available ? "可用" : "缺失" }}
                </span>
              </span>
            </label>
          </div>
        </section>

        <form data-install-form class="settings-section install-form" @submit.prevent="installPackage">
          <h3>安装新版本</h3>
          <label for="package-source">本地数据包目录</label>
          <div class="input-action-row">
            <input
              id="package-source"
              v-model="sourceDirectory"
              type="text"
              maxlength="32767"
              autocomplete="off"
              spellcheck="false"
              placeholder="例如 D:\地图数据\湖北"
              :disabled="installing || activating"
              :aria-invalid="Boolean(installError)"
              aria-describedby="package-source-hint package-source-error"
            >
            <button data-install-submit class="secondary-button" type="submit" :disabled="busy">
              {{ installing ? "正在校验…" : "安装并校验" }}
            </button>
          </div>
          <p id="package-source-hint" class="field-hint">目录应包含数据包清单及其声明的全部文件。</p>
          <p v-if="installError" id="package-source-error" data-install-error class="field-error" role="alert">{{ installError }}</p>
        </form>

        <form data-activate-form class="settings-section" @submit.prevent="activatePackage">
          <h3>遮挡模式</h3>
          <fieldset class="mode-fieldset" :disabled="!selectedPackage || busy">
            <legend class="sr-only">选择启用后的遮挡模式</legend>
            <label class="mode-option" :class="{ selected: obscurationMode === 'bare-earth' }">
              <input v-model="obscurationMode" type="radio" name="obscuration-mode" value="bare-earth">
              <span><b>DTM 裸地</b><small>仅考虑山体与地形遮挡</small></span>
            </label>
            <label class="mode-option" :class="{ selected: obscurationMode === 'surface', disabled: !surfaceAvailable }">
              <input
                v-model="obscurationMode"
                type="radio"
                name="obscuration-mode"
                value="surface"
                :disabled="!surfaceAvailable || busy"
              >
              <span><b>DSM 地表</b><small>同时考虑建筑与植被等地表障碍</small></span>
            </label>
          </fieldset>
          <p v-if="selectedPackage && !surfaceAvailable" class="field-hint warning">当前版本未提供 DSM，只能使用 DTM 裸地模式。</p>

          <div v-if="operationError" class="operation-feedback error" role="alert">{{ operationError }}</div>
          <div v-else-if="operationMessage" class="operation-feedback success" role="status">{{ operationMessage }}</div>

          <div class="dialog-actions">
            <button class="secondary-button" type="button" :disabled="busy" @click="requestClose">取消</button>
            <button data-activate-submit class="primary-button" type="submit" :disabled="!canActivate">
              {{ activating ? "正在切换…" : "启用所选版本" }}
            </button>
          </div>
        </form>
      </div>
    </section>
  </div>
</template>
