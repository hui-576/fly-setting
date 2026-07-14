import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("desktop build configuration", () => {
  it("bundles the sandbox preload as a single CommonJS file", () => {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { scripts: { build: string } };

    expect(manifest.scripts.build).toContain("esbuild src/preload.ts");
    expect(manifest.scripts.build).toContain("--bundle");
    expect(manifest.scripts.build).toContain("--format=cjs");
    expect(manifest.scripts.build).toContain("--outfile=dist/preload.cjs");
  });
});
