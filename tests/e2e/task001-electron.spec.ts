import { _electron as electron, expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const projectRoot = process.cwd();
const desktopRoot = join(projectRoot, "apps", "desktop");
const desktopEntry = join(desktopRoot, "dist", "main.js");
const dataRoot = join(projectRoot, "test-results", "task002-data");

async function runSecondInstance(executable: string): Promise<number | null> {
  const child = spawn(executable, [desktopEntry], {
    env: {
      ...process.env,
      FLY_SETTING_API_ALLOW_LAN: "false",
      FLY_SETTING_DATA_PACKAGE_ROOT: dataRoot,
    },
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("第二实例未在 15 秒内退出")), 15_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

test("应用启动后真实 Mars3D、sandbox preload 与单实例锁均可用", async () => {
  test.setTimeout(90_000);
  const externalRequests: string[] = [];
  let localBaseUrl: string | undefined;
  const electronApp = await electron.launch({
    args: [desktopEntry],
    env: {
      ...process.env,
      FLY_SETTING_API_ALLOW_LAN: "false",
      FLY_SETTING_DATA_PACKAGE_ROOT: dataRoot,
    },
    timeout: 60_000,
  });

  try {
    const page = await electronApp.firstWindow({ timeout: 30_000 });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        ["http:", "https:"].includes(url.protocol)
        && !["127.0.0.1", "localhost"].includes(url.hostname)
      ) {
        externalRequests.push(url.toString());
      }
    });

    await expect(page.locator(".map-ready-label")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-map-engine="mars3d"] canvas')).toHaveCount(1);
    await expect(page.locator(".mars3d-host .cesium-widget")).toHaveCount(1);

    const runtimeInfo = await page.evaluate(() => {
      const api = (window as typeof window & {
        desktopApi?: { getRuntimeInfo(): { electron: string; platform: string } };
      }).desktopApi;
      return api?.getRuntimeInfo();
    });
    expect(runtimeInfo?.electron).toMatch(/^43\./);
    expect(runtimeInfo?.platform).toBe("win32");
    expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    localBaseUrl = page.url();
    expect(await electronApp.evaluate(({ app }) => app.hasSingleInstanceLock())).toBe(true);
    expect(await runSecondInstance(electronApp.process().spawnfile)).toBe(0);
    expect(electronApp.windows()).toHaveLength(1);
    expect(externalRequests).toEqual([]);

    const evidenceDirectory = process.env.TASK001_EVIDENCE_DIR;
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      await page.screenshot({ path: join(evidenceDirectory, "electron-map-workbench-1440.png") });
    }
  } finally {
    await electronApp.close();
  }

  if (localBaseUrl) {
    await expect.poll(async () => {
      try {
        await fetch(new URL("api/v1/health", localBaseUrl), {
          signal: AbortSignal.timeout(500),
        });
        return true;
      } catch {
        return false;
      }
    }, { timeout: 10_000 }).toBe(false);
  }
});
