// SPDX-License-Identifier: MIT

import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type * as PlaywrightModule from "playwright";
import type { ScreenshotSource } from "./config.ts";

/** A capture failure worth a clean message: no Playwright, no page, no browser. */
export class ScreenshotError extends Error {
  /** Nothing answered at the URL — most often a dev server that isn't running. */
  readonly unreachable: boolean;

  constructor(message: string, options: { unreachable?: boolean } = {}) {
    super(message);
    this.name = "ScreenshotError";
    this.unreachable = options.unreachable ?? false;
  }
}

export type Viewport = "desktop" | "mobile";

/** A screenshot source with its defaults applied. */
export interface ScreenshotTarget {
  url: string;
  viewport: Viewport;
  hide: string[];
}

export function toScreenshotTarget(source: ScreenshotSource): ScreenshotTarget {
  return typeof source === "string"
    ? { url: source, viewport: "desktop", hide: [] }
    : {
        url: source.url,
        viewport: source.viewport ?? "desktop",
        hide: source.hide ?? [],
      };
}

// Vision models downscale every image to a fixed pixel budget, so a tall page
// captured whole reaches them as a thumbnail. Detail slices stay within that
// budget: at most 2,200 device px tall, overlapping by about 160 so a line of
// text cut by one boundary is whole in the neighbouring slice. In device px,
// not CSS px, so a DPR 2 capture covers half the page height per slice at the
// same image size.
const SLICE_HEIGHT = 2200;
const SLICE_OVERLAP = 160;

/** A vertical region of the page, in CSS px. */
export interface Slice {
  y: number;
  height: number;
}

/**
 * Split a page into the fewest overlapping slices that cover it top to bottom,
 * each overlapping the next by at least `SLICE_OVERLAP` device px.
 *
 * Slices then shrink to share the page evenly rather than staying at the
 * maximum: a page one pixel taller than a slice becomes two half-page slices,
 * not two near-identical full ones that spend a model's attention twice.
 */
export function planSlices(cssHeight: number, dpr: number): Slice[] {
  const maxHeight = SLICE_HEIGHT / dpr;
  const overlap = SLICE_OVERLAP / dpr;
  if (cssHeight <= maxHeight) return [{ y: 0, height: cssHeight }];

  const count = Math.ceil((cssHeight - overlap) / (maxHeight - overlap));
  // Exactly `overlap` between neighbours at this height; rounded up to whole
  // CSS px, which only adds overlap, and never past `maxHeight` given `count`
  const height = Math.ceil((cssHeight + (count - 1) * overlap) / count);
  const step = (cssHeight - height) / (count - 1);
  // Starts are floored, which never widens a gap past `height - overlap`. The
  // last start is set, not computed: `i * step` can round below the exact
  // value and leave the bottom row uncovered.
  return Array.from({ length: count }, (_, i) => ({
    y: i === count - 1 ? cssHeight - height : Math.floor(i * step),
    height,
  }));
}

/**
 * `home-00.png`, `home-01.png`, … Index 0 is the whole page, so filename
 * order is review order. Padding grows with the highest index so the order
 * holds past 99.
 */
export function imageFileName(
  name: string,
  index: number,
  highestIndex: number,
): string {
  const width = Math.max(2, String(highestIndex).length);
  return `${name}-${String(index).padStart(width, "0")}.png`;
}

/**
 * Whether `file` is one of bundle `name`'s numbered images. The suffix is
 * digits only, so `home-01-02.png` (bundle `home-01`) is never one of `home`'s.
 *
 * An exact match, because it decides what stale-image cleanup deletes and
 * folding could only widen that (ADR 004). To ask whether two spellings
 * collide, pass `pathKey`s.
 */
export function isImageOf(name: string, file: string): boolean {
  return (
    file.startsWith(`${name}-`) &&
    /^\d{2,}\.png$/.test(file.slice(name.length + 1))
  );
}

export type Playwright = Pick<typeof PlaywrightModule, "chromium" | "devices">;

/** Loads a module by specifier, throwing `MODULE_NOT_FOUND` when absent. */
export type Require = (id: string) => unknown;

/**
 * Where Playwright may be found, most specific first. The project comes before
 * srcpack: under `npx srcpack`, srcpack runs from the npm cache, where a bare
 * `import("playwright")` never sees the project's copy. `@playwright/test`
 * re-exports `chromium` and `devices`, so a project with Playwright Test needs
 * nothing new.
 */
function candidates(root: string): [Require, string][] {
  const project = createRequire(join(root, "package.json"));
  const own = createRequire(import.meta.url);
  return [
    [project, "playwright"],
    [project, "@playwright/test"],
    [own, "playwright"],
  ];
}

// 1.41 added the screenshot `style` option, which hides elements without
// mutating the page. Checked here rather than in the peer range, which is `*`
// so installs that never capture aren't judged by their Playwright version.
const MIN_MINOR = 41;

/**
 * Load Playwright without bundling it. `require` through `createRequire` keeps
 * `bun build` from inlining an optional peer that most users never install.
 */
export function loadPlaywright(
  root: string,
  from: [Require, string][] = candidates(root),
  userAgent = process.env.npm_config_user_agent,
): Playwright {
  for (const [load, id] of from) {
    let version: string;
    try {
      ({ version } = load(`${id}/package.json`) as { version: string });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
        continue;
      }
      throw error;
    }
    const [major, minor] = version.split(".").map(Number);
    if (major !== 1 || minor! < MIN_MINOR) {
      throw new ScreenshotError(
        major === 1
          ? `Playwright ${version} is too old; srcpack needs 1.${MIN_MINOR} or newer.`
          : `Playwright ${version} is not supported; srcpack needs 1.${MIN_MINOR} or a later 1.x.`,
      );
    }
    return load(id) as Playwright;
  }
  const pm = packageManager(userAgent);
  throw new ScreenshotError(
    `screenshots need Playwright. Install it with:\n  ${pm.add} playwright && ${pm.exec} playwright install chromium`,
  );
}

/**
 * Launch Playwright's Chromium, falling back to system Chrome only when the
 * executable is missing: the browser download is where this flow loses people,
 * and most developers already have Chrome. Other launch errors stay visible.
 */
export async function launchBrowser(
  playwright: Playwright,
  userAgent = process.env.npm_config_user_agent,
): Promise<PlaywrightModule.Browser> {
  try {
    return await playwright.chromium.launch();
  } catch (error) {
    if (!isMissingBrowser(error)) throw error;
  }
  try {
    return await playwright.chromium.launch({ channel: "chrome" });
  } catch (error) {
    // Chrome that exists but fails to start has a real reason worth showing
    if (!isMissingBrowser(error)) throw error;
    const pm = packageManager(userAgent);
    throw new ScreenshotError(
      `screenshots need a browser. Install Chromium with:\n  ${pm.exec} playwright install chromium`,
    );
  }
}

/** Playwright's wording for a bundled build, then for a system channel. */
function isMissingBrowser(error: unknown): boolean {
  return /Executable doesn't exist|distribution '[^']+' is not found/.test(
    (error as Error).message,
  );
}

/** What a capture produced. Dimensions are the page's, in CSS px. */
export interface CapturedPage {
  width: number;
  height: number;
  /**
   * Index 0 is the whole page, 1… the detail slices top to bottom. An index is
   * carried rather than implied by position, so an omitted overview leaves
   * `01…` in place instead of renumbering a detail slice into `00`.
   */
  images: { index: number; data: Uint8Array }[];
}

/** One browser for a whole run, launched when the first capture needs it. */
export interface Capturer {
  capture(
    target: ScreenshotTarget,
    warn: (message: string) => void,
  ): Promise<CapturedPage>;
  /** Close the browser, if one was launched. Never throws. */
  close(): Promise<void>;
}

// Standalone Playwright has no test deadline to fall back on, so every
// navigation and capture gets an explicit one.
const TIMEOUT = 30_000;

// Settling scrolls one viewport per step, dwelling so observers fire and
// images start loading at each position, and waits for the network at each
// apparent bottom. The step cap bounds infinite scroll; the deadline bounds
// the whole walk, so a page that keeps appending can't turn every step into a
// network wait.
const SETTLE_STEPS = 50;
const SETTLE_DWELL = 100;
const SETTLE_DEADLINE = 15_000;

// The network counts as idle after 500 ms without a request in flight — the
// same window as Playwright's `networkidle`. Capped, since uncapped it hangs on
// beacons and long polling.
const NETWORK_QUIET = 500;
const NETWORK_IDLE = 5_000;

// OpenAI's documented per-image upload limit
const CHATGPT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// Framework dev chrome that would otherwise be reviewed as part of the design.
// Not `nextjs-portal`: it also hosts Next's build and runtime error overlay,
// and a clean page over a broken app is worse evidence than a noisy one.
const DEV_OVERLAYS = ["astro-dev-toolbar", "nuxt-devtools-container"];

/** `net::` codes that mean nothing is listening, not that the page is broken. */
const UNREACHABLE: Record<string, string> = {
  ERR_CONNECTION_REFUSED: "connection refused",
  ERR_CONNECTION_RESET: "connection reset",
  ERR_CONNECTION_TIMED_OUT: "connection timed out",
  ERR_ADDRESS_UNREACHABLE: "address unreachable",
  ERR_NAME_NOT_RESOLVED: "host not found",
};

export function createCapturer(
  root: string,
  load: () => Playwright = () => loadPlaywright(root),
): Capturer {
  let session:
    | Promise<{ playwright: Playwright; browser: PlaywrightModule.Browser }>
    | undefined;

  return {
    async capture(target, warn) {
      session ??= (async () => {
        const playwright = load();
        return { playwright, browser: await launchBrowser(playwright) };
      })();
      const { playwright, browser } = await session;
      const context = await browser.newContext(
        contextOptions(playwright, target.viewport),
      );
      try {
        return await capturePage(await context.newPage(), target, warn);
      } finally {
        await context.close();
      }
    },
    async close() {
      // A launch that failed has nothing to close, and its error is reported
      const opened = await session?.catch(() => undefined);
      await opened?.browser.close().catch(() => {});
    },
  };
}

/**
 * Desktop is 1440×900 at DPR 1. Mobile starts from Playwright's `Pixel 7`
 * profile — a mobile user agent matters, since server-rendered responsive
 * sites send desktop markup to a desktop one — with DPR normalized from 2.625
 * to 2, so detail slices are 824 px wide: a text budget comparable to desktop,
 * deliberately not exact emulation.
 */
function contextOptions(
  playwright: Playwright,
  viewport: Viewport,
): PlaywrightModule.BrowserContextOptions {
  return viewport === "mobile"
    ? { ...playwright.devices["Pixel 7"], deviceScaleFactor: 2 }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
}

async function capturePage(
  page: PlaywrightModule.Page,
  target: ScreenshotTarget,
  warn: (message: string) => void,
): Promise<CapturedPage> {
  page.setDefaultTimeout(TIMEOUT);
  const network = watchNetwork(page);
  await open(page, target.url);
  await settle(page, network, warn);

  // In-page code is passed as strings: srcpack is typed without DOM globals.
  //
  // Width is the layout viewport — 980 px for a page without
  // `<meta name="viewport">` under mobile emulation, as on a real phone — not
  // the scroll width: accidental horizontal overflow would otherwise widen
  // every slice past the text budget. Height is what window scrolling reaches,
  // the same element `settle` scrolled; an app that scrolls inside its own
  // container has nothing further down to slice.
  const { width, height, dpr } = await page.evaluate<{
    width: number;
    height: number;
    dpr: number;
  }>(`({
    width: document.documentElement.clientWidth,
    height: (document.scrollingElement ?? document.documentElement).scrollHeight,
    dpr: devicePixelRatio,
  })`);

  // Hidden through the capture's own stylesheet, so the page isn't mutated
  const options = {
    animations: "disabled",
    style: [...DEV_OVERLAYS, ...target.hide]
      .map((selector) => `${selector} { visibility: hidden !important; }`)
      .join("\n"),
  } as const;

  const slices = planSlices(height, dpr);
  const images: CapturedPage["images"] = [];
  for (const [i, { y, height: sliceHeight }] of slices.entries()) {
    const data = await page.screenshot({
      ...options,
      fullPage: true,
      clip: { x: 0, y, width, height: sliceHeight },
      scale: "device",
    });
    // A page that fits in one slice is its own overview
    images.push({ index: slices.length === 1 ? 0 : i + 1, data });
  }

  if (slices.length > 1) {
    const overview = await captureOverview(page, options, warn);
    if (overview) images.unshift({ index: 0, data: overview });
  }

  return { width, height, images };
}

/**
 * Navigate, failing on anything but a successful page. A screenshot of a 404
 * is wrong output that looks right. No separate `fetch` first: it doubles the
 * request and can disagree with the browser about redirects and headers.
 */
async function open(page: PlaywrightModule.Page, url: string): Promise<void> {
  let response;
  try {
    response = await page.goto(url, { waitUntil: "load" });
  } catch (error) {
    const { name, message } = error as Error;
    const code = /net::(ERR_[A-Z_]+)/.exec(message)?.[1];
    if (code && Object.hasOwn(UNREACHABLE, code)) {
      throw new ScreenshotError(
        `${url} is not reachable (${UNREACHABLE[code]}). Is your dev server running?`,
        { unreachable: true },
      );
    }
    throw new ScreenshotError(
      name === "TimeoutError"
        ? `${url} did not finish loading within ${TIMEOUT / 1000} s.`
        : `${url} failed to load (${code ?? message.split("\n")[0]}).`,
    );
  }
  if (response && !response.ok()) {
    const status = [response.status(), response.statusText()].join(" ");
    throw new ScreenshotError(`${url} returned ${status.trim()}.`);
  }
}

/**
 * Let a page finish rendering before capture. A full-page screenshot doesn't
 * move the viewport, so lazy images and IntersectionObserver content would
 * stay blank.
 *
 * Scrolls until the viewport can go no further, re-reading the page each step
 * so sections that load taller than their placeholders are followed. At that
 * apparent bottom it waits for the network — covering late page data and what
 * scrolling started — then tries again: a response that appends content has
 * to be scrolled through too, or its own lazy content is sliced but blank.
 * The bottom is stable once a wait there brings no growth; only then does it
 * return to the top. No explicit font wait: Playwright's screenshot already
 * awaits `document.fonts.ready`.
 */
async function settle(
  page: PlaywrightModule.Page,
  network: NetworkWatch,
  warn: (message: string) => void,
): Promise<void> {
  const deadline = Date.now() + SETTLE_DEADLINE;
  let steps = 0;
  // Whether the network has gone quiet since the last scroll
  let waitedHere = false;
  for (;;) {
    // `instant` overrides CSS `scroll-behavior: smooth`, which would leave
    // `scrollY` unchanged when read back and end the walk early
    const moved = await page.evaluate<boolean>(`(() => {
      const before = scrollY;
      scrollTo({ top: before + innerHeight, behavior: "instant" });
      return scrollY !== before;
    })()`);
    if (moved) {
      waitedHere = false;
      if (++steps >= SETTLE_STEPS || Date.now() >= deadline) {
        const reached = await page.evaluate<number>("scrollY + innerHeight");
        warn(
          `page kept growing while scrolling; content below ${reached.toLocaleString("en-US")} px may not have loaded.`,
        );
        break;
      }
      await delay(SETTLE_DWELL);
    } else if (waitedHere) {
      break;
    } else {
      await network.idle(deadline - Date.now());
      waitedHere = true;
    }
  }

  await page.evaluate(`scrollTo({ top: 0, behavior: "instant" })`);
}

export interface NetworkWatch {
  /**
   * Resolves after the quiet window with nothing in flight, or after `limit`
   * ms — never longer than the cap.
   */
  idle(limit?: number): Promise<void>;
}

/** The part of a Playwright page that reports requests. */
export interface RequestEvents {
  on(
    event: "request" | "requestfinished" | "requestfailed",
    listener: (request: unknown) => void,
  ): unknown;
}

/**
 * Track requests from before navigation onward. Not Playwright's `networkidle`
 * load state: once reached it resolves immediately, so waiting for it after
 * scrolling misses exactly the requests scrolling started.
 *
 * Quiet is measured from the last request event, not sampled: a request that
 * starts and finishes between two polls still restarts the window.
 */
export function watchNetwork(
  page: RequestEvents,
  { quiet = NETWORK_QUIET, cap = NETWORK_IDLE } = {},
): NetworkWatch {
  const inflight = new Set<unknown>();
  let lastActivity = Date.now();
  page.on("request", (request) => {
    inflight.add(request);
    lastActivity = Date.now();
  });
  const settled = (request: unknown) => {
    inflight.delete(request);
    lastActivity = Date.now();
  };
  page.on("requestfinished", settled);
  page.on("requestfailed", settled);

  return {
    async idle(limit = cap) {
      const deadline = Date.now() + Math.min(limit, cap);
      while (Date.now() < deadline) {
        if (!inflight.size && Date.now() - lastActivity >= quiet) return;
        await delay(Math.min(50, deadline - Date.now()));
      }
    },
  };
}

/**
 * The whole page at CSS scale, for layout. Best-effort: very tall pages exceed
 * Chromium's texture limits, and an image past the upload limit can't be
 * attached. Detail slices cover the page either way.
 */
async function captureOverview(
  page: PlaywrightModule.Page,
  options: PlaywrightModule.PageScreenshotOptions,
  warn: (message: string) => void,
): Promise<Uint8Array | undefined> {
  let data: Uint8Array;
  try {
    data = await page.screenshot({ ...options, fullPage: true, scale: "css" });
  } catch (error) {
    warn(
      `skipped the whole-page overview: ${(error as Error).message.split("\n")[0]}. Detail slices are complete.`,
    );
    return undefined;
  }
  if (data.byteLength > CHATGPT_MAX_IMAGE_BYTES) {
    warn(
      `skipped the whole-page overview: ${Math.ceil(data.byteLength / 1024 / 1024)} MB is over ChatGPT's 20 MB per-image limit. Detail slices are complete.`,
    );
    return undefined;
  }
  return data;
}

/**
 * Commands for the package manager that ran srcpack, so the fix it prints is
 * one the user can paste. Every manager sets `npm_config_user_agent`.
 */
export function packageManager(userAgent = ""): { add: string; exec: string } {
  switch (userAgent.split("/")[0]) {
    case "bun":
      return { add: "bun add -d", exec: "bunx" };
    case "pnpm":
      return { add: "pnpm add -D", exec: "pnpm exec" };
    case "yarn":
      return { add: "yarn add -D", exec: "yarn" };
    default:
      return { add: "npm install -D", exec: "npx" };
  }
}
