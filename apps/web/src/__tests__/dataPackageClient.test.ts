import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DataPackageApiError,
  createDataPackageClient,
} from "../dataPackages/dataPackageClient";

const readyPackage = {
  id: "hubei-demo",
  version: "2026.07.0",
  displayName: "湖北演示数据包",
  status: "installed",
  active: false,
  supportedObscurationModes: ["bare-earth", "surface"],
  dtm: { available: true, resolutionMeters: 10, accuracyHint: "垂直精度约 3m" },
  dsm: { available: true, resolutionMeters: 10, accuracyHint: "垂直精度约 3m" },
};

describe("数据包 API 客户端", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("读取已安装版本并发送分页参数", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: [readyPackage],
      meta: { page: 1, limit: 100, total: 1 },
    }), { status: 200 }));
    const client = createDataPackageClient(fetcher);

    await expect(client.list()).resolves.toEqual([readyPackage]);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/data-packages?page=1&limit=100",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("安装和激活使用约定的请求体", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: readyPackage }), {
      status: 200,
    }));
    const client = createDataPackageClient(fetcher);

    await client.install("D:\\map-data\\hubei");
    await client.activate("hubei-demo", "2026.07.0", "surface");

    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/data-packages/install", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ sourceDirectory: "D:\\map-data\\hubei" }),
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/v1/data-packages/active", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        packageId: "hubei-demo",
        version: "2026.07.0",
        obscurationMode: "surface",
      }),
    }));
  });

  it("大数据包安装不使用短请求超时中断服务端导入", async () => {
    vi.useFakeTimers();
    let resolveResponse: ((response: Response) => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });
    });
    const client = createDataPackageClient(fetcher);

    const installation = client.install("D:\\map-data\\hubei-large");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(requestSignal).toBeUndefined();
    resolveResponse?.(new Response(JSON.stringify({ data: readyPackage }), { status: 200 }));
    await expect(installation).resolves.toEqual(readyPackage);
  });

  it("把结构化服务错误转换为可操作的中文错误", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "OBSCURATION_MODE_UNAVAILABLE",
        message: "Surface mode requires a DSM",
      },
    }), { status: 409 }));
    const client = createDataPackageClient(fetcher);

    await expect(client.activate("hubei-demo", "2026.07.0", "surface")).rejects.toMatchObject({
      name: "DataPackageApiError",
      code: "OBSCURATION_MODE_UNAVAILABLE",
      message: "所选数据包不包含 DSM，无法启用地表遮挡模式",
    } satisfies Partial<DataPackageApiError>);
  });
});
