import { describe, expect, it } from "vitest";

import { createDesktopApi } from "../src/preload-api.js";

describe("createDesktopApi", () => {
  it("exposes only immutable, non-privileged runtime metadata", () => {
    const api = createDesktopApi({
      chrome: "142.0.0",
      electron: "43.1.0",
      node: "24.0.0",
      platform: "win32",
    });

    expect(api.getRuntimeInfo()).toEqual({
      chrome: "142.0.0",
      electron: "43.1.0",
      platform: "win32",
    });
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.getRuntimeInfo())).toBe(true);
    expect(Object.keys(api)).toEqual(["getRuntimeInfo"]);
  });
});
