import { describe, expect, test } from "bun:test";
import { configFileName, generateConfig } from "../../src/init.ts";

/**
 * Node picks a `.ts` file's module format from the nearest package.json, so
 * the generated config — which opens with `import { defineConfig }` — is a
 * syntax error in a CommonJS project. `.mts` is ESM either way.
 */
describe("configFileName", () => {
  test("should use .ts in an ESM project", () => {
    expect(configFileName("module")).toBe("srcpack.config.ts");
  });

  test("should use .mts in a CommonJS project", () => {
    expect(configFileName("commonjs")).toBe("srcpack.config.mts");
  });

  test("should use .mts when type is absent", () => {
    // `npm init -y` writes no `type` field at all
    expect(configFileName(undefined)).toBe("srcpack.config.mts");
  });
});

/**
 * The generated file is TypeScript that srcpack itself loads on the next run,
 * so a value that breaks the syntax — or silently changes meaning — is a bug
 * the user only discovers later.
 */
describe("generateConfig", () => {
  test("should generate a config for a single pattern", () => {
    const config = generateConfig(
      [{ name: "app", include: ["src/**/*"] }],
      ".srcpack",
    );

    expect(config).toContain(`outDir: ".srcpack"`);
    expect(config).toContain(`app: "src/**/*",`);
  });

  test("should generate an array for multiple patterns", () => {
    const config = generateConfig(
      [{ name: "app", include: ["src/**/*", "!bun.lock"] }],
      ".srcpack",
    );

    expect(config).toContain(`app: ["src/**/*","!bun.lock"],`);
  });

  test("should quote a hyphenated bundle name", () => {
    // `my-app: "..."` is not valid TypeScript, but init accepts hyphens
    const config = generateConfig(
      [{ name: "my-app", include: ["src/**/*"] }],
      ".srcpack",
    );

    expect(config).toContain(`"my-app": "src/**/*",`);
  });

  test("should escape backslashes in patterns", () => {
    // Unescaped, `"src\\**\\*"` parses back as `src***`
    const config = generateConfig(
      [{ name: "app", include: ["src\\**\\*"] }],
      ".srcpack",
    );

    expect(config).toContain(String.raw`app: "src\\**\\*",`);
  });

  test("should escape quotes in outDir", () => {
    const config = generateConfig(
      [{ name: "app", include: ["src/**/*"] }],
      `out"dir`,
    );

    expect(config).toContain(String.raw`outDir: "out\"dir"`);
  });
});
