import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config.ts";

let dir: string;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/**
 * `srcpack init` writes `srcpack.config.mts` in a CommonJS project, so it has
 * to be discoverable — cosmiconfig only looks at the names in `searchPlaces`.
 */
describe("config discovery", () => {
  test("should find srcpack.config.mts", async () => {
    dir = await mkdtemp(join(tmpdir(), "srcpack-cfg-"));
    await writeFile(
      join(dir, "srcpack.config.mts"),
      `export default { bundles: { app: "src/**/*" } };\n`,
    );

    const config = await loadConfig(dir);

    expect(config?.bundles).toEqual({ app: "src/**/*" });
  });

  test("should prefer srcpack.config.ts when both exist", async () => {
    dir = await mkdtemp(join(tmpdir(), "srcpack-cfg-"));
    await writeFile(
      join(dir, "srcpack.config.ts"),
      `export default { bundles: { fromTs: "src/**/*" } };\n`,
    );
    await writeFile(
      join(dir, "srcpack.config.mts"),
      `export default { bundles: { fromMts: "src/**/*" } };\n`,
    );

    const config = await loadConfig(dir);

    expect(config?.bundles).toHaveProperty("fromTs");
  });
});
