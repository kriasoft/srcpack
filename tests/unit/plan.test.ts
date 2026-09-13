import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig } from "../../src/config.ts";
import { selectBundles } from "../../src/plan.ts";

describe("selectBundles", () => {
  const { bundles } = parseConfig({
    bundles: {
      code: "src/**/*",
      docs: { include: "docs/**/*", onDemand: false },
      home: { include: "pages/**/*", onDemand: true },
      backlog: { linear: "ENG", onDemand: true },
    },
  });

  test("should skip on-demand bundles in a full run", () => {
    expect(selectBundles(bundles, [])).toEqual({
      names: ["code", "docs"],
      skipped: ["home", "backlog"],
    });
  });

  test("should build a named bundle whether or not it is on demand", () => {
    expect(selectBundles(bundles, ["home", "code"])).toEqual({
      names: ["home", "code"],
      skipped: [],
    });
  });

  test("should select nothing when every bundle is on demand", () => {
    const config = parseConfig({
      bundles: { home: { include: "x", onDemand: true } },
    });
    expect(selectBundles(config.bundles, [])).toEqual({
      names: [],
      skipped: ["home"],
    });
  });

  test("should build a bundle named twice once", () => {
    expect(selectBundles(bundles, ["home", "home"]).names).toEqual(["home"]);
  });

  test("should reject an unknown or inherited name", () => {
    expect(() => selectBundles(bundles, ["nope"])).toThrow(ConfigError);
    expect(() => selectBundles(bundles, ["toString"])).toThrow(
      "Unknown bundle: toString",
    );
  });
});
