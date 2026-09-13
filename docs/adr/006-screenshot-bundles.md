# ADR 006: Screenshots as a bundle source

**Status:** Accepted — 2026-09-13

## Context

Reviewing a web app with a model means handing it the rendered page, not only the code. `page.screenshot()` is not enough on its own:

- **Tall pages become unreadable.** Vision models downscale every image to a fixed pixel budget, so a 1440×9000 page reaches them as a thumbnail.
- **The page isn't finished when `load` fires.** A full-page screenshot doesn't move the viewport, so lazy images and IntersectionObserver content stay blank.
- **Dev chrome pollutes the image.** Framework toolbars and cookie banners get reviewed as if they were the design.

And the workflow should be srcpack's: define once, rerun by name. A bundle stops meaning "sources → one text file" and becomes a named context packet — text, images, or both.

## Decision

**`screenshot` is a bundle source key**, the same shape as `linear`:

```ts
bundles: {
  home: { screenshot: "http://localhost:5173/", onDemand: true },
  pricing: {
    include: "src/pages/pricing/**/*",
    screenshot: { url: "http://localhost:5173/pricing", viewport: "mobile" },
  },
}
```

A top-level bundle `url` would drag `viewport` and `hide` onto every bundle, where on a text bundle they would do nothing. `prompt`, `index` and `outfile` describe the text file, so on a screenshot-only bundle they are config errors — which is why `index` is no longer defaulted in the schema.

**Not generalizing to `sources: [{ provider }]`.** [ADR 003](./003-linear-issues-as-virtual-files.md) predicted that shape once a third source arrived. This is the third source, but `include` and `linear` produce entries in one text file while `screenshot` produces sibling binary files. A common provider abstraction would hide that difference rather than simplify it.

**Output is a flat numbered family, `<outDir>/<name>-NN.png`.** `00` is the whole page and `01…` are detail slices top to bottom, so lexical order is review order. Each image carries a logical index: an overview omitted for size leaves `01…` in place rather than renumbering a detail slice into `00`. There is no `outfile`, so a family always lives in `outDir` and removing stale images never reaches a directory srcpack doesn't own.

**A family is a claim on a directory plus a name prefix.** Its directory resolves fully — it is an ancestor of every PNG, unlike a text output's last component, which `rename` replaces (ADR 004). Families collide when their folded names match (`Web`/`web`); a text `outfile` collides with a family when it resolves into the family's directory under one of its numbered names, the same bundle's family included. Stale-image cleanup matches exactly, never folded, since folding could only widen a deletion.

**Configured and active writers are checked separately.** Configured bundles are checked against each other on every run, so a config error doesn't depend on what was asked for. The bundles a run writes — ad-hoc included — are checked against configured bundles of a different name, so `--screenshot` shadows a configured `screenshot` bundle but cannot overwrite another bundle's file.

**Capture settles the page before it slices it.** It scrolls one viewport at a time, re-reading the page height so sections that load taller than their placeholders are followed, capped at 50 steps with a warning. It then waits for the network to go quiet using its own in-flight request tracker: Playwright's `networkidle` load state resolves immediately once it has fired, which misses exactly the requests scrolling started. Slices are clipped captures of 2,200 device px overlapping by at least 160 px, spread so the last ends flush with the bottom; the overview is best-effort.

**Playwright is an optional peer**, resolved from the project first (`playwright`, then `@playwright/test`), then srcpack's own install. Under `npx`, srcpack runs from the npm cache where a bare import never sees the project's copy. The version is checked at load because the peer range constrains nothing when the copy is the project's. Without Playwright's Chromium, the system Chrome is used.

**Images stay local.** Drive uploads find files by name and update in place, so a page that shrank would leave old slices there with nothing to remove them. A mixed bundle's text file still uploads.

**`--dry-run` launches no browser.** Unlike Linear, there is no cheap way to answer "what would this produce" short of the capture itself, and a plain `fetch` would be a second code path that can pass where the capture then fails. The preview lists URL, viewport and destination; config and collision errors still surface.

## Alternatives

- **A top-level `url` on bundles** — rejected above.
- **`sources: [{ provider }]`** — hides the text-versus-files difference it claims to unify.
- **Stitching one tall image, or an image library for slicing** — clipped Playwright captures need no dependency, and a stitched image is exactly what downscaling ruins.
- **Several URLs per bundle** — numbering across pages hides which image is which page; `srcpack home pricing` already composes.
- **Uploading images** — needs Drive-side cleanup of shrunk pages first.

## Consequences

srcpack can now require a browser, but only for bundles that ask for one; nobody else downloads anything. Screenshot bundles need a running server, which is what `onDemand` ([ADR 005](./005-on-demand-bundles.md)) is for, and the unreachable-URL error in a full run says so.

Captured images are held in memory until every bundle resolves, so a failure anywhere leaves the previous run's files in place. As with text, each file is replaced atomically but a run is not. Authenticated pages, custom viewport sizes and dark mode are deferred.
