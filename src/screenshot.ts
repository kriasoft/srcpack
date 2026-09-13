// SPDX-License-Identifier: MIT

import { createRequire } from "node:module";
import { join } from "node:path";
import type * as PlaywrightModule from "playwright";
import { pathKey } from "./bundle.ts";
import type { ScreenshotSource } from "./config.ts";

/** A capture failure worth a clean message: no Playwright, no page, no browser. */
export class ScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenshotError";
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
// captured whole reaches them as a thumbnail. Detail slices stay near that
// budget: 2,200 device px tall, overlapping by 160 so a line of text cut by one
// boundary is whole in the neighbouring slice. In device px, not CSS px, so a
// DPR 2 capture covers half the page height per slice at the same image size.
const SLICE_HEIGHT = 2200;
const SLICE_OVERLAP = 160;

/** A vertical region of the page, in CSS px. */
export interface Slice {
  y: number;
  height: number;
}

/**
 * Split a page into overlapping slices that cover it top to bottom. Starts are
 * spread evenly so the last slice ends flush with the bottom, and each overlap
 * is at least `SLICE_OVERLAP` device px.
 */
export function planSlices(cssHeight: number, dpr: number): Slice[] {
  const height = SLICE_HEIGHT / dpr;
  const overlap = SLICE_OVERLAP / dpr;
  if (cssHeight <= height) return [{ y: 0, height: cssHeight }];

  const count = Math.ceil((cssHeight - overlap) / (height - overlap));
  const step = (cssHeight - height) / (count - 1);
  // Floored to whole CSS px, which never widens a gap past `height - overlap`.
  // The last start is set, not computed: `i * step` can round below the exact
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
 * Whether a file belongs to a bundle's image family, compared as `pathKey` like
 * every other destination. The suffix is digits only, so `home-01-02.png`
 * (bundle `home-01`) is never mistaken for one of `home`'s.
 */
export function isImageOf(name: string, file: string): boolean {
  const prefix = pathKey(`${name}-`);
  const key = pathKey(file);
  return (
    key.startsWith(prefix) && /^\d{2,}\.png$/.test(key.slice(prefix.length))
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
// mutating the page. Checked at load: the peer range constrains nothing when
// the copy comes from the project rather than srcpack's own install.
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
 * Launch Chromium: Playwright's own build, else the system Chrome. The browser
 * download is where most people give up on this flow, and most developers
 * already have Chrome.
 */
export async function launchBrowser(
  playwright: Playwright,
  userAgent = process.env.npm_config_user_agent,
): Promise<PlaywrightModule.Browser> {
  try {
    return await playwright.chromium.launch();
  } catch (error) {
    if (!/Executable doesn't exist/i.test((error as Error).message)) {
      throw error;
    }
  }
  try {
    return await playwright.chromium.launch({ channel: "chrome" });
  } catch {
    const pm = packageManager(userAgent);
    throw new ScreenshotError(
      `screenshots need a browser. Install Chromium with:\n  ${pm.exec} playwright install chromium`,
    );
  }
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
