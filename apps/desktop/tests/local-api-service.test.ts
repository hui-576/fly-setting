import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  LocalApiService,
  type ApiChildProcess,
} from "../src/local-api-service.js";

type TestChild = Omit<ApiChildProcess, "stderr" | "stdout"> & EventEmitter & {
  stderr: PassThrough;
  stdout: PassThrough;
};

function createChild(): TestChild {
  return Object.assign(new EventEmitter(), {
    kill: vi.fn(() => true),
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  }) as TestChild;
}

describe("LocalApiService", () => {
  it("starts on a reserved loopback port and waits for the versioned health endpoint", async () => {
    const child = createChild();
    const spawnProcess = vi.fn(() => child);
    const checkHealth = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const service = new LocalApiService(
      { args: ["run"], command: "uv", cwd: "C:/api" },
      {
        checkHealth,
        delay: vi.fn(() => Promise.resolve()),
        environment: { PATH: "test" },
        reservePort: vi.fn(() => Promise.resolve(43125)),
        spawnProcess,
      },
    );

    await expect(service.start()).resolves.toBe("http://127.0.0.1:43125/");
    expect(spawnProcess).toHaveBeenCalledWith(
      "uv",
      ["run"],
      expect.objectContaining({
        cwd: "C:/api",
        env: expect.objectContaining({
          FLY_SETTING_API_HOST: "127.0.0.1",
          FLY_SETTING_API_PORT: "43125",
        }),
        shell: false,
      }),
    );
    expect(checkHealth).toHaveBeenCalledWith("http://127.0.0.1:43125/api/v1/health");
  });

  it("includes bounded child-process diagnostics when startup fails", async () => {
    const child = createChild();
    const service = new LocalApiService(
      { args: [], command: "api.exe", cwd: "C:/api" },
      {
        checkHealth: vi.fn(() => Promise.resolve(false)),
        delay: vi.fn(async () => {
          child.stderr.write("missing terrain runtime\n");
          child.emit("exit", 2, null);
        }),
        environment: {},
        reservePort: vi.fn(() => Promise.resolve(43126)),
        spawnProcess: vi.fn(() => child),
      },
    );

    await expect(service.start()).rejects.toThrow(/missing terrain runtime/);
  });

  it("terminates the child when stopped", async () => {
    const child = createChild();
    const service = new LocalApiService(
      { args: [], command: "api.exe", cwd: "C:/api" },
      {
        checkHealth: vi.fn(() => Promise.resolve(true)),
        delay: vi.fn(() => Promise.resolve()),
        environment: {},
        reservePort: vi.fn(() => Promise.resolve(43127)),
        spawnProcess: vi.fn(() => child),
      },
    );
    await service.start();

    service.stop();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("returns the running base URL when a macOS window is recreated", async () => {
    const child = createChild();
    const spawnProcess = vi.fn(() => child);
    const service = new LocalApiService(
      { args: [], command: "api", cwd: "/api" },
      {
        checkHealth: vi.fn(() => Promise.resolve(true)),
        delay: vi.fn(() => Promise.resolve()),
        environment: {},
        reservePort: vi.fn(() => Promise.resolve(43128)),
        spawnProcess,
      },
    );

    await expect(Promise.all([service.start(), service.start()])).resolves.toEqual([
      "http://127.0.0.1:43128/",
      "http://127.0.0.1:43128/",
    ]);
    expect(spawnProcess).toHaveBeenCalledOnce();
  });

  it("starts a replacement process after an unexpected service exit", async () => {
    const firstChild = createChild();
    const secondChild = createChild();
    const service = new LocalApiService(
      { args: [], command: "api", cwd: "/api" },
      {
        checkHealth: vi.fn(() => Promise.resolve(true)),
        delay: vi.fn(() => Promise.resolve()),
        environment: {},
        reservePort: vi.fn()
          .mockResolvedValueOnce(43129)
          .mockResolvedValueOnce(43130),
        spawnProcess: vi.fn()
          .mockReturnValueOnce(firstChild)
          .mockReturnValueOnce(secondChild),
      },
    );
    await expect(service.start()).resolves.toBe("http://127.0.0.1:43129/");
    firstChild.emit("exit", 1, null);

    await expect(service.start()).resolves.toBe("http://127.0.0.1:43130/");
  });

  it("reports an unexpected exit after the service became healthy", async () => {
    const child = createChild();
    const onUnexpectedExit = vi.fn();
    const service = new LocalApiService(
      { args: [], command: "api", cwd: "/api" },
      {
        checkHealth: vi.fn(() => Promise.resolve(true)),
        delay: vi.fn(() => Promise.resolve()),
        environment: {},
        reservePort: vi.fn(() => Promise.resolve(43131)),
        spawnProcess: vi.fn(() => child),
      },
      {},
      onUnexpectedExit,
    );
    await service.start();

    child.emit("exit", 3, null);

    expect(onUnexpectedExit).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("exited (code=3"),
    }));
  });
});
