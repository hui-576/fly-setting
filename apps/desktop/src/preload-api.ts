export interface RuntimeVersions {
  chrome: string;
  electron: string;
  node: string;
  platform: string;
}

export interface DesktopRuntimeInfo {
  chrome: string;
  electron: string;
  platform: string;
}

export interface DesktopApi {
  getRuntimeInfo(): DesktopRuntimeInfo;
}

export function createDesktopApi(versions: RuntimeVersions): Readonly<DesktopApi> {
  const runtimeInfo = Object.freeze({
    chrome: versions.chrome,
    electron: versions.electron,
    platform: versions.platform,
  });
  return Object.freeze({
    getRuntimeInfo: () => runtimeInfo,
  });
}
