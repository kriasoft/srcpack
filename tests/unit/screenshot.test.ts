import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { pathKey } from "../../src/fs.ts";
import {
  imageFileName,
  isImageOf,
  launchBrowser,
  loadPlaywright,
  packageManager,
  planSlices,
  ScreenshotError,
  toScreenshotTarget,
  watchNetwork,
  type Playwright,
  type Require,
} from "../../src/screenshot.ts";

describe("planSlices", () => {
  test("should return the whole page when it fits in one slice", () => {
    expect(planSlices(900, 1)).toEqual([{ y: 0, height: 900 }]);
    expect(planSlices(2200, 1)).toEqual([{ y: 0, height: 2200 }]);
  });

  test("should cover the page with overlapping slices ending flush", () => {
    for (const [height, dpr] of [
      [2201, 1],
      [4000, 1],
      [4240, 1], // 2 × 2,200 − 160: exactly two slices
      [9000, 1],
      [9480, 2],
      [45_000, 1],
    ] as const) {
      const slices = planSlices(height, dpr);
      expect(slices[0]!.y).toBe(0);
      const last = slices.at(-1)!;
      expect(last.y + last.height).toBe(height);
      for (let i = 1; i < slices.length; i++) {
        const overlap = slices[i - 1]!.y + slices[i - 1]!.height - slices[i]!.y;
        expect(overlap).toBeGreaterThanOrEqual(160 / dpr);
        // Evenly spread: no gap wider than the budget allows
        expect(slices[i]!.y - slices[i - 1]!.y).toBeLessThanOrEqual(
          (2200 - 160) / dpr,
        );
      }
    }
  });

  test("should end flush even where floating point rounds down", () => {
    for (const [height, dpr] of [
      [1_048_598, 2],
      [4000.5, 1],
    ] as const) {
      const last = planSlices(height, dpr).at(-1)!;
      expect(last.y + last.height).toBe(height);
    }
  });

  test("should use the minimum number of slices", () => {
    expect(planSlices(4240, 1)).toHaveLength(2);
    expect(planSlices(4241, 1)).toHaveLength(3);
  });

  test("should size slices in device pixels", () => {
    // DPR 2 doubles pixel dimensions, so a slice covers half as much page
    expect(planSlices(1100, 2)).toEqual([{ y: 0, height: 1100 }]);
    expect(planSlices(1101, 2)).toEqual([
      { y: 0, height: 591 },
      { y: 510, height: 591 },
    ]);
  });

  test("should shrink slices to share the page instead of duplicating it", () => {
    // Two near-identical 2,200 px images would each cost a model's attention
    expect(planSlices(2201, 1)).toEqual([
      { y: 0, height: 1181 },
      { y: 1020, height: 1181 },
    ]);
    for (const [height, dpr] of [
      [2201, 1],
      [4000, 1],
      [9480, 2],
      [45_000, 1],
    ] as const) {
      const slices = planSlices(height, dpr);
      for (let i = 1; i < slices.length; i++) {
        const overlap = slices[i - 1]!.y + slices[i - 1]!.height - slices[i]!.y;
        // Rounding to whole pixels adds at most a couple
        expect(overlap).toBeLessThanOrEqual(160 / dpr + 3);
      }
      expect(slices[0]!.height).toBeLessThanOrEqual(2200 / dpr);
    }
  });
});

describe("imageFileName", () => {
  test("should pad to two digits, or more past 99", () => {
    expect(imageFileName("home", 0, 3)).toBe("home-00.png");
    expect(imageFileName("home", 9, 9)).toBe("home-09.png");
    expect(imageFileName("home", 10, 10)).toBe("home-10.png");
    expect(imageFileName("home", 99, 99)).toBe("home-99.png");
    expect(imageFileName("home", 7, 100)).toBe("home-007.png");
    expect(imageFileName("home", 100, 100)).toBe("home-100.png");
  });

  test("should keep a logical index when the overview is omitted", () => {
    expect([1, 2].map((i) => imageFileName("home", i, 2))).toEqual([
      "home-01.png",
      "home-02.png",
    ]);
  });
});

describe("isImageOf", () => {
  test("should match a bundle's own numbered images", () => {
    expect(isImageOf("home", "home-00.png")).toBe(true);
    expect(isImageOf("home", "home-100.png")).toBe(true);
  });

  test("should match exactly, leaving folding to the caller", () => {
    // Cleanup deletes what matches, so it must not widen by case
    expect(isImageOf("Web", "web-01.PNG")).toBe(false);
    // Collision checks fold both sides: one entry on macOS and Windows
    expect(isImageOf(pathKey("Web"), pathKey("web-01.PNG"))).toBe(true);
  });

  test("should not cross-match similar bundle names", () => {
    expect(isImageOf("home", "home-01-02.png")).toBe(false);
    expect(isImageOf("home-01", "home-01-02.png")).toBe(true);
    expect(isImageOf("home", "home.v2-00.png")).toBe(false);
    expect(isImageOf("home", "home-0.png")).toBe(false);
    expect(isImageOf("home", "home-00.png.tmp")).toBe(false);
    expect(isImageOf("home", "home.txt")).toBe(false);
  });
});

describe("toScreenshotTarget", () => {
  test("should apply defaults to both forms", () => {
    expect(toScreenshotTarget("http://localhost:5173/")).toEqual({
      url: "http://localhost:5173/",
      viewport: "desktop",
      hide: [],
    });
    expect(
      toScreenshotTarget({
        url: "http://x/",
        viewport: "mobile",
        hide: ["#a"],
      }),
    ).toEqual({ url: "http://x/", viewport: "mobile", hide: ["#a"] });
  });
});

describe("loadPlaywright", () => {
  const notFound = () =>
    Object.assign(new Error("Cannot find module"), {
      code: "MODULE_NOT_FOUND",
    });

  /** A require that knows only the given packages. */
  function fakeRequire(packages: Record<string, string>): Require {
    return (id) => {
      const name = id.replace(/\/package\.json$/, "");
      const version = packages[name];
      if (version === undefined) throw notFound();
      return id.endsWith("/package.json")
        ? { version }
        : { chromium: `${name}@${version}`, devices: {} };
    };
  }

  const load = (
    project: Record<string, string>,
    own: Record<string, string>,
    userAgent?: string,
  ) =>
    loadPlaywright(
      "/project",
      [
        [fakeRequire(project), "playwright"],
        [fakeRequire(project), "@playwright/test"],
        [fakeRequire(own), "playwright"],
      ],
      userAgent,
    ).chromium as unknown as string;

  test("should prefer the project's copy over srcpack's", () => {
    expect(load({ playwright: "1.50.0" }, { playwright: "1.63.0" })).toBe(
      "playwright@1.50.0",
    );
  });

  test("should fall back to @playwright/test, then srcpack's own", () => {
    expect(
      load({ "@playwright/test": "1.45.1" }, { playwright: "1.63.0" }),
    ).toBe("@playwright/test@1.45.1");
    expect(load({}, { playwright: "1.63.0" })).toBe("playwright@1.63.0");
  });

  test("should reject a version outside the supported range", () => {
    expect(() => load({ playwright: "1.38.0" }, {})).toThrow(
      "Playwright 1.38.0 is too old; srcpack needs 1.41 or newer.",
    );
    expect(() => load({ playwright: "2.0.0" }, {})).toThrow(ScreenshotError);
  });

  test("should print the install command for the invoking package manager", () => {
    expect(() => load({}, {}, "bun/1.4.2 npm/? node/v24")).toThrow(
      "screenshots need Playwright. Install it with:\n  bun add -d playwright && bunx playwright install chromium",
    );
    expect(() => load({}, {}, undefined)).toThrow(
      "npm install -D playwright && npx playwright install chromium",
    );
  });

  test("should not hide a broken installation behind 'not installed'", () => {
    const broken: Require = () => {
      throw new SyntaxError("Unexpected token");
    };
    expect(() => loadPlaywright("/project", [[broken, "playwright"]])).toThrow(
      SyntaxError,
    );
  });
});

describe("launchBrowser", () => {
  const browser = { close: async () => {} };

  function fakeChromium(
    outcomes: Record<string, () => unknown>,
  ): Playwright & { calls: (string | undefined)[] } {
    const calls: (string | undefined)[] = [];
    const chromium = {
      launch: async (options?: { channel?: string }) => {
        calls.push(options?.channel);
        return outcomes[options?.channel ?? "bundled"]!();
      },
    };
    return { chromium, devices: {}, calls } as never;
  }

  const missing = () => {
    throw new Error("browserType.launch: Executable doesn't exist at /x");
  };

  test("should use Playwright's Chromium when installed", async () => {
    const pw = fakeChromium({ bundled: () => browser });
    expect(await launchBrowser(pw)).toBe(browser as never);
    expect(pw.calls).toEqual([undefined]);
  });

  test("should fall back to system Chrome when Chromium is missing", async () => {
    const pw = fakeChromium({ bundled: missing, chrome: () => browser });
    expect(await launchBrowser(pw)).toBe(browser as never);
    expect(pw.calls).toEqual([undefined, "chrome"]);
  });

  test("should print the install command when neither is available", async () => {
    const pw = fakeChromium({
      bundled: missing,
      chrome: () => {
        throw new Error(
          "browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome",
        );
      },
    });
    await expect(launchBrowser(pw, "pnpm/9.0.0")).rejects.toThrow(
      "screenshots need a browser. Install Chromium with:\n  pnpm exec playwright install chromium",
    );
  });

  test("should rethrow a system Chrome that exists but fails to start", async () => {
    // "Install Chromium" would send the user after the wrong problem
    const pw = fakeChromium({
      bundled: missing,
      chrome: () => {
        throw new Error("browserType.launch: Target crashed (sandbox)");
      },
    });
    await expect(launchBrowser(pw)).rejects.toThrow("Target crashed");
  });

  test("should rethrow a launch failure that isn't a missing browser", async () => {
    const pw = fakeChromium({
      bundled: () => {
        throw new Error("Target page, context or browser has been closed");
      },
    });
    await expect(launchBrowser(pw)).rejects.toThrow("has been closed");
    expect(pw.calls).toEqual([undefined]);
  });
});

describe("watchNetwork", () => {
  const quiet = 100;

  test("should wait out requests that start and finish between polls", async () => {
    const events = new EventEmitter();
    const network = watchNetwork(events, { quiet, cap: 5_000 });

    // Each request completes within one tick, so sampling how many are in
    // flight would never see one. Measured against the last request actually
    // sent, so a slow timer can't make a correct wait look early.
    let lastRequest = 0;
    const timer = setInterval(() => {
      const request = {};
      lastRequest = Date.now();
      events.emit("request", request);
      events.emit("requestfinished", request);
    }, 20);
    const stopped = Bun.sleep(300).then(() => clearInterval(timer));

    await network.idle();
    const idleAt = Date.now();
    await stopped;

    // Resolving while requests were still arriving would put one after idleAt
    expect(idleAt - lastRequest).toBeGreaterThanOrEqual(quiet);
  });

  test("should give up on a request that never finishes at the cap", async () => {
    const events = new EventEmitter();
    const network = watchNetwork(events, { quiet, cap: 300 });
    events.emit("request", {});

    const started = Date.now();
    await network.idle();

    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
  });
});

describe("packageManager", () => {
  test.each([
    ["npm/10.8.0 node/v24.0.0", "npx"],
    ["yarn/4.5.0 npm/? node/v24", "yarn"],
    ["", "npx"],
  ])("should map %p", (userAgent, exec) => {
    expect(packageManager(userAgent).exec).toBe(exec);
  });
});
