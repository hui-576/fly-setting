import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test("数据包 DTM、DSM 与 Mars3D 本地图层可离线加载", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const evidenceDirectory = process.env.TASK002_EVIDENCE_DIR;
  const localResources = new Map<string, number>();
  const externalRequests: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/v1/map/")) {
      localResources.set(url.pathname, response.status());
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") {
      externalRequests.push(url.toString());
    }
  });

  await page.goto("/");
  await expect(page.locator('[data-map-data-state="ready"]')).toContainText("hubei-demo");
  await expect(page.locator(".map-data-summary")).toContainText("DTM 裸地");
  await expect(page.locator(".map-data-summary")).toContainText("DSM 地表");
  await expect(page.locator(".map-data-summary")).toContainText("10m");
  await expect(page.locator(".map-data-summary")).toContainText("DSM 地表");
  await expect(page.locator(".map-ready-label")).toBeVisible({ timeout: 30_000 });

  const switchVersion = testInfo.project.name === "desktop-1440" ? "2026.08.0" : "2026.09.0";
  const sourceDirectory = join(
    process.cwd(),
    "test-results",
    "task002-data-switch-source",
    `hubei-demo-${switchVersion}`,
  );
  await page.getByRole("button", { name: "运行设置" }).click();
  await page.getByLabel("本地数据包目录").fill(sourceDirectory);
  await page.getByRole("button", { name: "安装并校验" }).click();
  await expect(page.getByRole("status")).toContainText("安装并校验完成");
  await expect(page.getByRole("radio", { name: new RegExp(`v${switchVersion}`) }))
    .toBeChecked();
  const surfaceMode = page.getByRole("radio", { name: /DSM 地表/ });
  await surfaceMode.check();
  if (evidenceDirectory) {
    await mkdir(evidenceDirectory, { recursive: true });
    await page.screenshot({
      path: join(evidenceDirectory, `data-package-settings-${testInfo.project.name}.png`),
    });
  }
  await page.getByRole("button", { name: "启用所选版本" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator('[data-map-data-state="ready"]')).toContainText(switchVersion);
  await expect(page.locator(".map-data-summary")).toContainText("当前模式 DSM 地表");

  await page.locator(".map-layer-control summary").click();
  const roadsToggle = page.getByLabel("道路矢量瓦片");
  await expect(roadsToggle).toBeChecked();
  await roadsToggle.uncheck();
  await expect(roadsToggle).not.toBeChecked();
  await roadsToggle.check();
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole("button", { name: "放大" }).click();
  }

  await expect.poll(() => [...localResources.keys()], { timeout: 30_000 }).toEqual(
    expect.arrayContaining([
      "/api/v1/map/manifest",
      `/api/v1/map/packages/hubei-demo/${switchVersion}/xyz/0/0/0.png`,
      `/api/v1/map/packages/hubei-demo/${switchVersion}/terrain/layer.json`,
      `/api/v1/map/packages/hubei-demo/${switchVersion}/roads/8/207/104.mvt`,
    ]),
  );
  await expect.poll(
    () => [...localResources.keys()].some((path) => path.endsWith(".terrain")),
    { timeout: 30_000 },
  ).toBe(true);
  expect([...localResources.values()]).not.toContain(404);
  expect(externalRequests).toEqual([]);

  const manifest = await page.request.get("/api/v1/map/manifest");
  const prefix = `/api/v1/map/packages/hubei-demo/${switchVersion}`;
  const terrain = await page.request.get(`${prefix}/terrain/0/0/0.terrain`);
  const roads = await page.request.get(`${prefix}/roads/8/207/104.mvt`);
  expect(manifest.ok()).toBe(true);
  expect(terrain.ok()).toBe(true);
  expect(terrain.headers()["content-type"]).toContain("application/vnd.quantized-mesh");
  expect(roads.ok()).toBe(true);
  expect(roads.headers()["content-type"]).toContain("application/vnd.mapbox-vector-tile");

  if (evidenceDirectory) {
    await page.screenshot({
      path: join(evidenceDirectory, `data-package-${testInfo.project.name}.png`),
    });
  }
});
