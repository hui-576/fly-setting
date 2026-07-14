import { describe, expect, it } from "vitest";

import { resolveApiProcessCommand } from "../src/local-api-config.js";

describe("resolveApiProcessCommand", () => {
  it("uses uv with the API project during development", () => {
    expect(
      resolveApiProcessCommand({
        apiProjectPath: "C:/workspace/services/api",
        environment: {},
        isPackaged: false,
        platform: "win32",
        resourcesPath: "C:/app/resources",
      }),
    ).toEqual({
      args: ["run", "--project", "C:/workspace/services/api", "fly-setting-api"],
      command: "uv",
      cwd: "C:/workspace/services/api",
    });
  });

  it("uses the packaged service executable by default", () => {
    expect(
      resolveApiProcessCommand({
        apiProjectPath: "C:/workspace/services/api",
        environment: {},
        isPackaged: true,
        platform: "win32",
        resourcesPath: "C:/app/resources",
      }),
    ).toEqual({
      args: [],
      command: "C:\\app\\resources\\api\\fly-setting-api.exe",
      cwd: "C:\\app\\resources\\api",
    });
  });

  it("accepts an explicit JSON command and working directory override", () => {
    expect(
      resolveApiProcessCommand({
        apiProjectPath: "C:/workspace/services/api",
        environment: {
          FLY_SETTING_API_COMMAND: '["python","-m","fly_setting_api.main"]',
          FLY_SETTING_API_WORKING_DIRECTORY: "D:/portable/api",
        },
        isPackaged: true,
        platform: "win32",
        resourcesPath: "C:/app/resources",
      }),
    ).toEqual({
      args: ["-m", "fly_setting_api.main"],
      command: "python",
      cwd: "D:/portable/api",
    });
  });

  it("rejects malformed or empty command overrides", () => {
    expect(() =>
      resolveApiProcessCommand({
        apiProjectPath: "C:/workspace/services/api",
        environment: { FLY_SETTING_API_COMMAND: "uv run" },
        isPackaged: false,
        platform: "linux",
        resourcesPath: "/opt/app/resources",
      }),
    ).toThrow(/JSON array/i);
  });
});
