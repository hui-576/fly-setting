import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const apiProject = join(root, "services", "api");
const webRoot = join(root, "apps", "web", "dist");
const child = spawn(
  "uv",
  ["run", "--project", apiProject, "fly-setting-api"],
  {
    env: {
      ...process.env,
      FLY_SETTING_API_HOST: "127.0.0.1",
      FLY_SETTING_API_PORT: "4173",
      FLY_SETTING_WEB_ROOT: webRoot,
    },
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  },
);

function stop() {
  if (!child.killed) child.kill("SIGTERM");
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
child.once("error", (error) => {
  console.error("E2E local API failed to start", error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
