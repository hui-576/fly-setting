/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAP_PROVIDER?: "offline" | "tianditu";
  readonly VITE_OFFLINE_XYZ_URL?: string;
  readonly VITE_TDT_KEY?: string;
  readonly VITE_DEV_TERRAIN_URL?: string;
  readonly VITE_CESIUM_BASE_URL?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
