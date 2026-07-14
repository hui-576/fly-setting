import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import DataPackageSettings from "../components/DataPackageSettings.vue";
import type {
  DataPackageClient,
  DataPackageDescriptor,
} from "../dataPackages/dataPackageClient";

function descriptor(
  overrides: Partial<DataPackageDescriptor> = {},
): DataPackageDescriptor {
  return {
    id: "hubei-demo",
    version: "2026.07.0",
    displayName: "湖北演示数据包",
    status: "installed",
    active: false,
    supportedObscurationModes: ["bare-earth", "surface"],
    dtm: { available: true, resolutionMeters: 10, accuracyHint: "垂直精度约 3m" },
    dsm: { available: true, resolutionMeters: 10, accuracyHint: "垂直精度约 3m" },
    ...overrides,
  };
}

function client(overrides: Partial<DataPackageClient> = {}): DataPackageClient {
  return {
    list: vi.fn(async () => []),
    install: vi.fn(async () => descriptor()),
    activate: vi.fn(async () => descriptor({ active: true })),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("数据包管理对话框", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("读取期间显示加载状态，空列表给出安装引导", async () => {
    const pending = deferred<DataPackageDescriptor[]>();
    const wrapper = mount(DataPackageSettings, {
      props: { client: client({ list: vi.fn(() => pending.promise) }) },
    });

    expect(wrapper.get("[role='status']").text()).toContain("正在读取已安装的数据包");
    pending.resolve([]);
    await flushPromises();

    expect(wrapper.get("[data-package-empty]").text()).toContain("尚未安装任何数据包");
    expect(wrapper.get("label[for='package-source']").text()).toBe("本地数据包目录");
  });

  it("列表失败显示可诊断错误并允许重试", async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error("服务离线"))
      .mockResolvedValueOnce([descriptor()]);
    const wrapper = mount(DataPackageSettings, { props: { client: client({ list }) } });
    await flushPromises();

    expect(wrapper.get("[role='alert']").text()).toContain("无法读取数据包列表");
    await wrapper.get("[data-retry-packages]").trigger("click");
    await flushPromises();

    expect(list).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("湖北演示数据包");
  });

  it("标出无效版本，并在 DSM 缺失时禁用地表模式", async () => {
    const invalid = descriptor({
      id: "invalid-package",
      displayName: "损坏的数据包",
      status: "invalid",
      supportedObscurationModes: [],
      dtm: { available: false },
      dsm: { available: false },
    });
    const dtmOnly = descriptor({
      id: "dtm-only",
      displayName: "湖北裸地数据包",
      supportedObscurationModes: ["bare-earth"],
      dsm: { available: false },
    });
    const wrapper = mount(DataPackageSettings, {
      props: { client: client({ list: vi.fn(async () => [invalid, dtmOnly]) }) },
    });
    await flushPromises();

    expect(wrapper.get("[data-package-id='invalid-package']").text()).toContain("校验失败");
    expect(wrapper.get("input[value='invalid-package::2026.07.0']").attributes("disabled")).toBeDefined();
    await wrapper.get("input[value='dtm-only::2026.07.0']").setValue(true);

    const surface = wrapper.get<HTMLInputElement>("input[value='surface']");
    expect(surface.attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("当前版本未提供 DSM");
  });

  it("安装时校验目录、阻止重复提交并显示成功结果", async () => {
    const pending = deferred<DataPackageDescriptor>();
    const install = vi.fn(() => pending.promise);
    const wrapper = mount(DataPackageSettings, {
      props: { client: client({ install }) },
    });
    await flushPromises();

    await wrapper.get("form[data-install-form]").trigger("submit");
    expect(wrapper.get("[data-install-error]").text()).toContain("请输入数据包所在的本地目录");

    await wrapper.get("#package-source").setValue("  D:\\data\\hubei  ");
    await wrapper.get("form[data-install-form]").trigger("submit");
    await wrapper.get("form[data-install-form]").trigger("submit");

    expect(install).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledWith("D:\\data\\hubei");
    expect(wrapper.get("[data-install-submit]").attributes("disabled")).toBeDefined();
    pending.resolve(descriptor());
    await flushPromises();

    expect(wrapper.get("[role='status']").text()).toContain("数据包安装并校验完成");
    expect(wrapper.text()).toContain("湖北演示数据包");
  });

  it("激活所选模式只提交一次并通知宿主", async () => {
    const pending = deferred<DataPackageDescriptor>();
    const activate = vi.fn(() => pending.promise);
    const wrapper = mount(DataPackageSettings, {
      props: { client: client({
        list: vi.fn(async () => [descriptor()]),
        activate,
      }) },
    });
    await flushPromises();

    await wrapper.get("input[value='surface']").setValue(true);
    await wrapper.get("form[data-activate-form]").trigger("submit");
    await wrapper.get("form[data-activate-form]").trigger("submit");
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith("hubei-demo", "2026.07.0", "surface");
    expect(wrapper.get("[data-activate-submit]").attributes("disabled")).toBeDefined();

    const activated = descriptor({ active: true });
    pending.resolve(activated);
    await flushPromises();
    expect(wrapper.emitted("activated")?.[0]).toEqual([activated]);
  });

  it("Escape 关闭并在卸载后把焦点还给触发按钮", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "运行设置";
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mount(DataPackageSettings, {
      attachTo: document.body,
      props: { client: client() },
    });
    await flushPromises();

    expect(wrapper.get("[role='dialog']").attributes("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(wrapper.get("[data-dialog-close]").element);
    await wrapper.get("[role='dialog']").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("close")).toHaveLength(1);

    wrapper.unmount();
    expect(document.activeElement).toBe(trigger);
  });
});
