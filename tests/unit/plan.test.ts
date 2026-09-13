import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, parseConfig } from "../../src/config.ts";
import { planOutputs, selectBundles } from "../../src/plan.ts";

describe("planOutputs", () => {
  const root = join(tmpdir(), `srcpack-plan-${Date.now()}`);

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const bundlesOf = (bundles: Record<string, unknown>) =>
    parseConfig({ bundles }).bundles;

  test("should derive each active destination once", async () => {
    const configured = bundlesOf({
      web: "src/**/*",
      docs: { include: "docs/**", outfile: "out/docs.md" },
    });

    const plan = await planOutputs(root, ".srcpack", configured, [
      ["docs", configured.docs!],
    ]);

    expect(plan.bundles).toEqual([
      {
        name: "docs",
        source: configured.docs!,
        text: { outfile: join(root, "out/docs.md") },
      },
    ]);
    // A bundle that isn't active still claims its outputs
    await expect(
      planOutputs(root, ".srcpack", configured, [["web", configured.web!]]),
    ).resolves.toMatchObject({ bundles: [{ name: "web" }] });
    // Inactive bundles' outputs are still srcpack's, and never bundled
    expect(plan.ownOutputs).toContain(join(root, ".srcpack/web.txt"));
  });

  test("should reject configured bundles sharing a file on any run", async () => {
    const configured = bundlesOf({
      Web: { include: "src/**", outfile: ".srcpack/Context.txt" },
      web: { include: "src/**", outfile: ".srcpack/context.txt" },
    });

    // Neither bundle is active: a config error doesn't depend on the request
    await expect(planOutputs(root, ".srcpack", configured, [])).rejects.toThrow(
      'Bundles "Web" and "web" both write to ".srcpack/context.txt"',
    );
  });

  test("should reject outfiles aliased through a symlinked directory", async () => {
    await mkdir(join(root, ".srcpack"), { recursive: true });
    await symlink(join(root, ".srcpack"), join(root, "alias"));
    const configured = bundlesOf({
      a: { include: "src/**", outfile: ".srcpack/ctx.txt" },
      b: { include: "src/**", outfile: "alias/ctx.txt" },
    });

    await expect(planOutputs(root, ".srcpack", configured, [])).rejects.toThrow(
      "both write to",
    );
  });

  test("should let an ad-hoc bundle shadow a configured one of its name", async () => {
    const configured = bundlesOf({ staged: ["git:staged", "!bun.lock"] });

    const plan = await planOutputs(root, ".srcpack", configured, [
      ["staged", ["git:staged"]],
    ]);

    expect(plan.bundles.map((b) => b.name)).toEqual(["staged"]);
  });

  test("should plan text, images, or both", async () => {
    const configured = bundlesOf({
      home: { screenshot: "http://localhost:5173/" },
      pricing: {
        include: "src/**",
        screenshot: {
          url: "http://localhost:5173/pricing",
          viewport: "mobile",
        },
      },
    });

    const { bundles } = await planOutputs(root, ".srcpack", configured, [
      ["home", configured.home!],
      ["pricing", configured.pricing!],
    ]);

    // A screenshot-only bundle reserves no <name>.txt
    expect(bundles[0]!.text).toBeUndefined();
    expect(bundles[0]!.images).toEqual({
      target: { url: "http://localhost:5173/", viewport: "desktop", hide: [] },
      dir: join(root, ".srcpack"),
    });
    expect(bundles[1]!.text).toEqual({
      outfile: join(root, ".srcpack/pricing.txt"),
    });
    expect(bundles[1]!.images?.target.viewport).toBe("mobile");
  });

  test("should reject an outfile inside its own bundle's image family", async () => {
    const configured = bundlesOf({
      home: {
        include: "src/**",
        screenshot: "http://x/",
        outfile: ".srcpack/home-00.png",
      },
    });

    await expect(planOutputs(root, ".srcpack", configured, [])).rejects.toThrow(
      'Bundle "home" writes its text and its images to ".srcpack/home-00.png"',
    );
  });

  test("should reject an outfile reaching a family through a symlink", async () => {
    await mkdir(join(root, ".srcpack"), { recursive: true });
    await symlink(join(root, ".srcpack"), join(root, "alias"));
    const configured = bundlesOf({
      home: { screenshot: "http://x/" },
      notes: { include: "docs/**", outfile: "alias/HOME-03.png" },
    });

    await expect(planOutputs(root, ".srcpack", configured, [])).rejects.toThrow(
      'Bundles "home" and "notes" both write to "alias/HOME-03.png"',
    );
  });

  test("should tell apart families whose names only share a prefix", async () => {
    const configured = bundlesOf({
      home: { screenshot: "http://x/" },
      "home-01": { screenshot: "http://x/01" },
      notes: { include: "docs/**", outfile: ".srcpack/home-01.txt" },
    });

    await expect(
      planOutputs(root, ".srcpack", configured, []),
    ).resolves.toBeDefined();
  });

  test("should reject image families differing only by case", async () => {
    const configured = bundlesOf({
      Web: { screenshot: "http://x/" },
      web: { screenshot: "http://x/" },
    });

    await expect(planOutputs(root, ".srcpack", configured, [])).rejects.toThrow(
      'Bundles "Web" and "web" both write to ".srcpack/web-NN.png". Rename one of them.',
    );
  });

  test("should let --screenshot shadow a configured screenshot bundle", async () => {
    const configured = bundlesOf({
      screenshot: { screenshot: "http://localhost:5173/" },
    });

    const { bundles } = await planOutputs(root, ".srcpack", configured, [
      ["screenshot", { screenshot: { url: "http://localhost:3000/" } }],
    ]);

    expect(bundles[0]!.images?.target.url).toBe("http://localhost:3000/");
  });

  test("should reject --screenshot over another bundle's outfile", async () => {
    const configured = bundlesOf({
      notes: { include: "docs/**", outfile: ".srcpack/screenshot-00.png" },
    });

    await expect(
      planOutputs(root, ".srcpack", configured, [
        ["screenshot", { screenshot: { url: "http://localhost:3000/" } }],
      ]),
    ).rejects.toThrow('Bundles "notes" and "screenshot" both write to');
  });

  test("should reject an ad-hoc bundle writing over another bundle's file", async () => {
    const configured = bundlesOf({
      review: { include: "git:staged", outfile: ".srcpack/staged.txt" },
    });

    await expect(
      planOutputs(root, ".srcpack", configured, [["staged", ["git:staged"]]]),
    ).rejects.toThrow('Bundles "review" and "staged" both write to');
  });
});

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
