export type ObscurationMode = "bare-earth" | "surface";

export interface ElevationCapability {
  available: boolean;
  resolutionMeters?: number | null;
  accuracyHint?: string | null;
}

export interface DataPackageDescriptor {
  id: string;
  version: string;
  displayName: string;
  status: string;
  active: boolean;
  obscurationMode?: ObscurationMode | null;
  supportedObscurationModes: ObscurationMode[];
  dtm: ElevationCapability;
  dsm: ElevationCapability;
}

export interface DataPackageClient {
  list(): Promise<DataPackageDescriptor[]>;
  install(sourceDirectory: string): Promise<DataPackageDescriptor>;
  activate(
    packageId: string,
    version: string,
    obscurationMode: ObscurationMode,
  ): Promise<DataPackageDescriptor>;
}

interface ErrorPayload {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

const errorMessages: Record<string, string> = {
  PACKAGE_VERSION_EXISTS: "该数据包版本已经安装，请选择其他版本或直接启用现有版本",
  PACKAGE_NOT_FOUND: "所选数据包版本不存在，请刷新列表后重试",
  OBSCURATION_MODE_UNAVAILABLE: "所选数据包不包含 DSM，无法启用地表遮挡模式",
  ACTIVE_PACKAGE_MISSING: "尚未选择可用的数据包版本",
  SOURCE_DIRECTORY_NOT_FOUND: "数据包目录不存在，请检查路径后重试",
  SOURCE_STORAGE_OVERLAP: "不能从应用托管的数据目录内部导入数据包",
  PACKAGE_REPARSE_POINT_FORBIDDEN: "数据包包含符号链接或目录联接，已拒绝导入",
  PACKAGE_FILE_COUNT_EXCEEDED: "数据包文件数量超过安全上限",
  PACKAGE_FILE_TOO_LARGE: "数据包包含超过单文件上限的文件",
  PACKAGE_TOTAL_SIZE_EXCEEDED: "数据包总容量超过安全上限",
  PACKAGE_DEPTH_EXCEEDED: "数据包目录层级超过安全上限",
  CHECKSUM_MISMATCH: "数据包文件校验和不一致，可能已损坏或被修改",
  ELEVATION_ALIGNMENT_MISMATCH: "DTM 与 DSM 网格未对齐，不能用于双模式分析",
  ELEVATION_HAS_NO_VALID_DATA: "高程文件没有可用像元，不能启用该数据包",
  ROADS_OUTSIDE_ELEVATION_EXTENT: "道路数据与高程覆盖范围不一致",
  LICENSE_NOT_APPROVED: "数据许可未明确允许离线处理和部署",
  LICENSE_ID_INVALID: "数据许可标识不明确，不能启用该数据包",
};

export class DataPackageApiError extends Error {
  override readonly name = "DataPackageApiError";

  constructor(
    message: string,
    readonly code = "DATA_PACKAGE_REQUEST_FAILED",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseElevationCapability(value: Record<string, unknown>): ElevationCapability {
  return {
    available: value.available as boolean,
    ...(typeof value.resolutionMeters === "number"
      ? { resolutionMeters: value.resolutionMeters }
      : value.resolutionMeters === null ? { resolutionMeters: null } : {}),
    ...(typeof value.accuracyHint === "string"
      ? { accuracyHint: value.accuracyHint }
      : value.accuracyHint === null ? { accuracyHint: null } : {}),
  };
}

function parseDescriptor(value: unknown): DataPackageDescriptor {
  if (!isObject(value) || !isObject(value.dtm) || !isObject(value.dsm)) {
    throw new DataPackageApiError("数据包服务返回了无法识别的数据，请重新启动应用");
  }
  const modes = Array.isArray(value.supportedObscurationModes)
    ? value.supportedObscurationModes.filter(
      (mode): mode is ObscurationMode => mode === "bare-earth" || mode === "surface",
    )
    : [];
  if (
    typeof value.id !== "string"
    || typeof value.version !== "string"
    || typeof value.displayName !== "string"
    || typeof value.status !== "string"
    || typeof value.active !== "boolean"
    || typeof value.dtm.available !== "boolean"
    || typeof value.dsm.available !== "boolean"
  ) {
    throw new DataPackageApiError("数据包服务返回了无法识别的数据，请重新启动应用");
  }
  return {
    id: value.id,
    version: value.version,
    displayName: value.displayName,
    status: value.status,
    active: value.active,
    ...(value.obscurationMode === "bare-earth" || value.obscurationMode === "surface"
      ? { obscurationMode: value.obscurationMode }
      : value.obscurationMode === null ? { obscurationMode: null } : {}),
    supportedObscurationModes: modes,
    dtm: parseElevationCapability(value.dtm),
    dsm: parseElevationCapability(value.dsm),
  };
}

async function parseResponse(response: Response): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DataPackageApiError("数据包服务返回异常，请稍后重试");
  }
  if (response.ok) return payload;
  const error = isObject(payload) ? (payload as ErrorPayload).error : undefined;
  const code = typeof error?.code === "string" ? error.code : "DATA_PACKAGE_REQUEST_FAILED";
  throw new DataPackageApiError(
    errorMessages[code] || `数据包操作失败（${code}，HTTP ${response.status}）`,
    code,
    error?.details,
  );
}

function responseData(payload: unknown): unknown {
  if (!isObject(payload) || !("data" in payload)) {
    throw new DataPackageApiError("数据包服务返回了无法识别的数据，请重新启动应用");
  }
  return payload.data;
}

async function fetchJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number | null = 15_000,
): Promise<unknown> {
  const controller = timeoutMs === null ? undefined : new AbortController();
  const timeout = timeoutMs === null
    ? undefined
    : window.setTimeout(() => controller?.abort(), timeoutMs);
  const request: RequestInit = {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  };
  if (controller !== undefined) request.signal = controller.signal;
  try {
    return await parseResponse(await fetcher(url, request));
  } catch (error) {
    if (error instanceof DataPackageApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DataPackageApiError("数据包服务响应超时，请稍后重试", "DATA_PACKAGE_TIMEOUT");
    }
    throw new DataPackageApiError("无法连接本地数据包服务，请确认应用服务已启动");
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

export function createDataPackageClient(fetcher: typeof fetch = fetch): DataPackageClient {
  return Object.freeze({
    async list() {
      const payload = await fetchJson(fetcher, "/api/v1/data-packages?page=1&limit=100", {
        method: "GET",
      });
      const data = responseData(payload);
      if (!Array.isArray(data)) {
        throw new DataPackageApiError("数据包服务返回了无法识别的数据，请重新启动应用");
      }
      return data.map(parseDescriptor);
    },
    async install(sourceDirectory: string) {
      const payload = await fetchJson(fetcher, "/api/v1/data-packages/install", {
        method: "POST",
        body: JSON.stringify({ sourceDirectory }),
      }, null);
      return parseDescriptor(responseData(payload));
    },
    async activate(packageId: string, version: string, obscurationMode: ObscurationMode) {
      const payload = await fetchJson(fetcher, "/api/v1/data-packages/active", {
        method: "PUT",
        body: JSON.stringify({ packageId, version, obscurationMode }),
      });
      return parseDescriptor(responseData(payload));
    },
  });
}

export const dataPackageClient = createDataPackageClient((input, init) => fetch(input, init));
