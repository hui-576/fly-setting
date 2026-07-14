import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";

test("真实 Mars3D 工作台可离线启动且没有布局溢出", async ({ page }, testInfo) => {
  const externalRequests: string[] = [];
  const failedResponses: string[] = [];
  const pageErrors: string[] = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalRequests.push(url.toString());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const documentResponse = await page.goto("/");
  expect(documentResponse?.headers()["content-security-policy"]).toContain("worker-src 'self' blob:");
  await expect(page.locator(".map-ready-label")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-map-engine="mars3d"] canvas')).toHaveCount(1);
  await expect(page.locator(".mars3d-host .cesium-widget")).toHaveCount(1);
  await expect(page.locator('[data-map-data-state="missing"]')).toContainText("本地底图待安装");

  const canvasSize = await page.locator('[data-map-engine="mars3d"] canvas').evaluate((canvas) => ({
    height: (canvas as HTMLCanvasElement).height,
    width: (canvas as HTMLCanvasElement).width,
  }));
  expect(canvasSize.width).toBeGreaterThan(0);
  expect(canvasSize.height).toBeGreaterThan(0);

  const canvasImage = PNG.sync.read(
    await page.locator('[data-map-engine="mars3d"] canvas').screenshot(),
  );
  const renderedPixels = (() => {
    const pixels = canvasImage.data;
    let colored = 0;
    let minimum = 765;
    let maximum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = pixels[index] + pixels[index + 1] + pixels[index + 2];
      if (luminance > 9) colored += 1;
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
    }
    return { colored, spread: maximum - minimum };
  })();
  expect(renderedPixels.colored).toBeGreaterThan(100);
  expect(renderedPixels.spread).toBeGreaterThan(10);

  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  expect(overflow).toEqual({ x: false, y: false });
  expect(externalRequests).toEqual([]);
  expect(failedResponses).toEqual([]);
  expect(pageErrors).toEqual([]);

  const evidenceDirectory = process.env.TASK001_EVIDENCE_DIR;
  if (evidenceDirectory) {
    await mkdir(evidenceDirectory, { recursive: true });
    await page.screenshot({
      path: join(evidenceDirectory, `map-workbench-${testInfo.project.name}.png`),
    });
  }
});
