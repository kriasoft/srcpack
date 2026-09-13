import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

// Real Chromium, driven through the CLI. Pixels are checked by drawing the PNG
// into a canvas in a browser the test already has — no image dependency.

const CLI_PATH = join(import.meta.dir, "../../src/cli.ts");
// Each run launches a browser of its own
const TIMEOUT = 60_000;

const WHITE = [255, 255, 255];
const GREEN = [0, 128, 0];

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

/** Width and height from a PNG's IHDR chunk. */
async function pngSize(path: string): Promise<[number, number]> {
  const view = new DataView(await Bun.file(path).arrayBuffer());
  return [view.getUint32(16), view.getUint32(20)];
}

function html(body: string): Response {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>html, body { margin: 0 }</style>${body}`,
    { headers: { "content-type": "text/html" } },
  );
}

// Reaching B inserts a spacer that pushes C below the page's original height;
// C paints itself green only once it has been scrolled into view. A capture
// that doesn't re-read the height, or doesn't scroll, never sees green.
const GROWING_PAGE = `
  <div style="height: 1500px"></div>
  <div id="b" style="height: 1500px"></div>
  <div id="c" style="height: 500px"></div>
  <script>
    const c = document.getElementById("c");
    new IntersectionObserver(([entry], observer) => {
      if (!entry.isIntersecting) return;
      const spacer = document.createElement("div");
      spacer.style.height = "2000px";
      c.before(spacer);
      observer.disconnect();
    }).observe(document.getElementById("b"));
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) c.style.background = "rgb(0, 128, 0)";
    }).observe(c);
  </script>`;

const OVERLAY_PAGE = `
  <style>
    #banner { position: fixed; top: 0; left: 0; right: 0; height: 100px; background: rgb(255, 0, 0) }
    astro-dev-toolbar { display: block; position: fixed; bottom: 0; left: 0; right: 0; height: 100px; background: rgb(0, 0, 255) }
  </style>
  <div id="banner"></div>
  <astro-dev-toolbar></astro-dev-toolbar>`;

// The bottom section fetches its color only once scrolled into view, and the
// server answers slowly: the capture has to wait for the request, not just the
// scroll. Red until the response arrives.
const LAZY_PAGE = `
  <div style="height: 3000px"></div>
  <div id="lazy" style="height: 500px; background: rgb(255, 0, 0)"></div>
  <script>
    const lazy = document.getElementById("lazy");
    new IntersectionObserver(async ([entry], observer) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const { color } = await (await fetch("/lazy-data")).json();
      lazy.style.background = color;
    }).observe(lazy);
  </script>`;

let shrinkingHeight = 4000;

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    switch (new URL(request.url).pathname) {
      case "/lazy":
        return html(LAZY_PAGE);
      case "/lazy-data":
        await Bun.sleep(1500);
        return Response.json({ color: "rgb(0, 128, 0)" });
      case "/tall":
        return html(`<div style="height: 4000px; background: #ddd"></div>`);
      case "/shrinking":
        return html(`<div style="height: ${shrinkingHeight}px"></div>`);
      case "/growing":
        return html(GROWING_PAGE);
      case "/overlays":
        return html(OVERLAY_PAGE);
      case "/user-agent": {
        const mobile = request.headers.get("user-agent")?.includes("Mobile");
        const color = mobile ? "rgb(0, 128, 0)" : "rgb(255, 0, 0)";
        return html(`<div style="height: 100px; background: ${color}"></div>`);
      }
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
});
const base = `http://localhost:${server.port}`;

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  server.stop(true);
});

async function pixelAt(path: string, x: number, y: number): Promise<number[]> {
  const png = Buffer.from(await Bun.file(path).arrayBuffer()).toString(
    "base64",
  );
  const page = await browser.newPage();
  try {
    return await page.evaluate<number[]>(`(async () => {
      const image = new Image();
      image.src = "data:image/png;base64,${png}";
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(${x}, ${y}, 1, 1).data.slice(0, 3));
    })()`);
  } finally {
    await page.close();
  }
}

const projects: string[] = [];

async function project(config?: object): Promise<string> {
  const dir = join(
    tmpdir(),
    `srcpack-screenshot-${Date.now()}-${projects.length}`,
  );
  projects.push(dir);
  await mkdir(dir, { recursive: true });
  if (config) {
    await writeFile(
      join(dir, "srcpack.config.ts"),
      `export default ${JSON.stringify(config)};`,
    );
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(
    projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("screenshot bundles", () => {
  test(
    "should capture a tall page as an overview plus overlapping slices",
    async () => {
      const dir = await project({
        bundles: { home: { screenshot: `${base}/tall` } },
      });

      const result = await runCli([], dir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "home  3 images  page 1440×4,000  → .srcpack/home-00.png … home-02.png",
      );
      expect(result.stdout).toContain("Bundled: 1 bundle, 3 images");
      const out = join(dir, ".srcpack");
      expect((await readdir(out)).sort()).toEqual([
        "home-00.png",
        "home-01.png",
        "home-02.png",
      ]);
      expect(await pngSize(join(out, "home-00.png"))).toEqual([1440, 4000]);
      // Two slices sharing the page with a 160 px overlap, not two full 2,200s
      expect(await pngSize(join(out, "home-01.png"))).toEqual([1440, 2080]);
      expect(await pngSize(join(out, "home-02.png"))).toEqual([1440, 2080]);
    },
    TIMEOUT,
  );

  test(
    "should settle a page that grows while it is scrolled",
    async () => {
      const dir = await project({
        bundles: { home: { screenshot: `${base}/growing` } },
      });

      const result = await runCli([], dir);

      expect(result.exitCode).toBe(0);
      const overview = join(dir, ".srcpack/home-00.png");
      // 3,500 px as served; 5,500 once the spacer went in
      expect(await pngSize(overview)).toEqual([1440, 5500]);
      expect(await pixelAt(overview, 720, 5250)).toEqual(GREEN);
      // Details too: 1,940 px slices start at 0, 1,780 and 3,560, so C's
      // middle sits at 1,690 in the last. A capture repeating y=0 shows white.
      const last = join(dir, ".srcpack/home-03.png");
      expect(await pngSize(last)).toEqual([1440, 1940]);
      expect(await pixelAt(last, 720, 1690)).toEqual(GREEN);
    },
    TIMEOUT,
  );

  test(
    "should wait for data a scrolled-to section requests",
    async () => {
      const dir = await project({
        bundles: { home: { screenshot: `${base}/lazy` } },
      });

      const result = await runCli([], dir);

      expect(result.exitCode).toBe(0);
      // 3,500 px page: 1,830 px slices at 0 and 1,670. The response lands
      // well after scrolling ends, so only the network wait makes it green.
      expect(
        await pixelAt(join(dir, ".srcpack/home-02.png"), 720, 1580),
      ).toEqual(GREEN);
      expect(
        await pixelAt(join(dir, ".srcpack/home-00.png"), 720, 3250),
      ).toEqual(GREEN);
    },
    TIMEOUT,
  );

  test(
    "should hide overlays and write text and images for a mixed bundle",
    async () => {
      const dir = await project({
        bundles: {
          home: {
            include: "*.md",
            screenshot: { url: `${base}/overlays`, hide: ["#banner"] },
          },
        },
      });
      await writeFile(join(dir, "notes.md"), "# notes\n");

      const result = await runCli([], dir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "home  1 file  1 line  → .srcpack/home.txt",
      );
      expect(result.stdout).toContain(
        "home  1 image  page 1440×900  → .srcpack/home-00.png",
      );
      // A page that fits one slice is its own overview
      expect((await readdir(join(dir, ".srcpack"))).sort()).toEqual([
        "home-00.png",
        "home.txt",
      ]);
      const image = join(dir, ".srcpack/home-00.png");
      expect(await pixelAt(image, 720, 50)).toEqual(WHITE); // #banner
      expect(await pixelAt(image, 720, 850)).toEqual(WHITE); // dev toolbar
    },
    TIMEOUT,
  );

  test(
    "should remove stale images when the page shrinks, and nothing else",
    async () => {
      shrinkingHeight = 4000;
      const dir = await project({
        bundles: { home: { screenshot: `${base}/shrinking`, onDemand: true } },
      });
      expect((await runCli(["home"], dir)).exitCode).toBe(0);
      await writeFile(join(dir, ".srcpack/keep.txt"), "keep\n");
      // Another bundle's family, which a prefix match would take for `home`'s
      await writeFile(join(dir, ".srcpack/home-01-02.png"), "home-01's\n");

      try {
        shrinkingHeight = 500;
        const rerun = await runCli(["home"], dir);
        expect(rerun.exitCode).toBe(0);
      } finally {
        shrinkingHeight = 4000;
      }

      expect((await readdir(join(dir, ".srcpack"))).sort()).toEqual([
        "home-00.png",
        "home-01-02.png",
        "keep.txt",
      ]);
    },
    TIMEOUT,
  );

  test(
    "should render the mobile markup a server sends to a phone",
    async () => {
      const dir = await project({
        bundles: {
          phone: {
            screenshot: { url: `${base}/user-agent`, viewport: "mobile" },
          },
        },
      });

      const result = await runCli([], dir);

      expect(result.exitCode).toBe(0);
      const image = join(dir, ".srcpack/phone-00.png");
      // 412 CSS px at DPR 2
      expect((await pngSize(image))[0]).toBe(824);
      expect(await pixelAt(image, 20, 20)).toEqual(GREEN);
    },
    TIMEOUT,
  );

  test(
    "should fail cleanly and keep previous output when a page can't be captured",
    async () => {
      const closed = Bun.serve({ port: 0, fetch: () => new Response() });
      const closedPort = closed.port;
      closed.stop(true);
      const dir = await project({
        bundles: {
          home: { screenshot: `http://localhost:${closedPort}/` },
          missing: { screenshot: `${base}/missing`, onDemand: true },
        },
      });
      await mkdir(join(dir, ".srcpack"));
      const previous = join(dir, ".srcpack/home-00.png");
      await writeFile(previous, "previous run");

      const unreachable = await runCli([], dir);

      expect(unreachable.exitCode).toBe(1);
      expect(unreachable.stderr).toContain(
        `Bundle "home": http://localhost:${closedPort}/ is not reachable (connection refused). Is your dev server running? Set onDemand: true to capture it only when named.`,
      );
      expect(unreachable.stderr).not.toContain("    at ");

      const notFound = await runCli(["missing"], dir);

      expect(notFound.exitCode).toBe(1);
      expect(notFound.stderr).toContain(
        `Bundle "missing": ${base}/missing returned 404`,
      );
      expect(await Bun.file(previous).text()).toBe("previous run");
    },
    TIMEOUT,
  );

  test(
    "should capture an ad-hoc URL without a config file",
    async () => {
      const dir = await project();

      const result = await runCli(
        [
          "--screenshot",
          `localhost:${server.port}/user-agent`,
          "--viewport",
          "mobile",
        ],
        dir,
      );

      expect(result.exitCode).toBe(0);
      const image = join(dir, ".srcpack/screenshot-00.png");
      expect((await pngSize(image))[0]).toBe(824);
    },
    TIMEOUT,
  );

  test("should preview without requesting the page", async () => {
    // Nothing listens on port 1, so a request would fail the run
    const dir = await project({
      bundles: { home: { screenshot: "http://localhost:1/" } },
    });

    const result = await runCli(["--dry-run"], dir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "home  screenshot  http://localhost:1/  desktop  → .srcpack/home-NN.png",
    );
    expect(result.stdout).toContain("Dry run: 1 bundle");
    expect(await Bun.file(join(dir, ".srcpack")).exists()).toBe(false);
  });
});
