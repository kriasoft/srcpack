# Configuration

Srcpack looks for configuration in the following order:

1. `srcpack.config.ts` (recommended)
2. `srcpack.config.mts`
3. `srcpack.config.js`
4. `srcpack` field in `package.json`

## Config File Format

Node decides a `.ts` file's module format from the nearest `package.json`, so in a CommonJS project — the `npm init` default — the `import` line in a `.ts` config fails to parse. Use `.mts` there: it is unconditionally ESM and loads in both kinds of project.

`srcpack init` picks the right extension for you. If you are writing the file by hand:

| Your `package.json`      | Use                  |
| ------------------------ | -------------------- |
| `"type": "module"`       | `srcpack.config.ts`  |
| no `type`, or `commonjs` | `srcpack.config.mts` |

Config files are type-stripped, not compiled, so they must use erasable syntax — type annotations and `import type` are fine, `enum` and `namespace` are not.

## Basic Structure

```ts
import { defineConfig } from "srcpack";

export default defineConfig({
  outDir: ".srcpack",
  bundles: {
    // bundle definitions
  },
  upload: {
    // optional upload config
  },
});
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `root` | `string` | `process.cwd()` | Project root directory |
| `outDir` | `string` | `.srcpack` | Output directory (relative to root) |
| `emptyOutDir` | `boolean` | `true`\* | Empty output directory before writing |
| `bundles` | `object` | — | Named bundles (required) |
| `upload` | `object` | — | Upload destination |

\*Only for the default `.srcpack`. Any other `outDir` defaults to `false` and must opt in with `emptyOutDir: true` — srcpack deletes nothing it doesn't own by convention.

An unknown key anywhere in the config is an error rather than an ignored line. A silently dropped `emptyOutdir` or `exlude` would keep the default in force and read as if it had been set.

### root

Project root directory where files are bundled from. Can be absolute or relative to CWD.

```ts
export default defineConfig({
  root: "./packages/app", // bundle from subdirectory
  bundles: {
    app: "src/**/*", // matches packages/app/src/**/*
  },
});
```

### outDir

Output directory for bundle files. Can be absolute or relative to project root.

```ts
export default defineConfig({
  root: "./packages/app",
  outDir: "dist", // writes to packages/app/dist/
  bundles: {
    app: "src/**/*",
  },
});
```

Only the default `.srcpack` is emptied automatically. It is srcpack's directory by convention, so clearing it is safe; every other `outDir` is somewhere you chose, and `outDir: "src"` would otherwise turn a bundling run into a wipe of the sources it was asked to bundle. Set `emptyOutDir: true` to opt in, or clean up yourself.

Ownership is decided by physical path. A `.srcpack` that turns out to be a symlink somewhere else fails the run: the name claims one specific place, and both the emptying and the writes would land somewhere it doesn't say. Name that directory as `outDir` instead. Pointing `outDir` at the root (`"."`) with `emptyOutDir: true` is refused for the same reason — it would delete the project.

Emptying waits until every bundle has resolved, immediately before the new files are written. A run that fails while resolving — an unreadable `.gitignore`, an expired `LINEAR_API_KEY` — leaves the previous output intact.

Emptying only happens on a full run. `srcpack web` leaves the bundles it isn't building in place, since it has no way to tell which of them are stale.

## Bundle Definitions

Each bundle can be defined in three ways:

### String (Simple Glob)

```ts
bundles: {
  app: "src/**/*",
}
```

### Array (Multiple Patterns)

Use `!` prefix to exclude:

```ts
bundles: {
  api: ["src/**/*", "!src/**/*.test.ts"],
}
```

### Object (Full Options)

```ts
bundles: {
  docs: {
    include: "docs/**/*.md",
    outfile: "~/Downloads/docs.txt",
    index: false,
  },
}
```

**Bundle options:**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `include` | `string \| string[]` | — | Glob pattern(s) |
| `linear` | `string \| object` | — | Linear issues (see below) |
| `screenshot` | `string \| object` | — | Page captured as PNGs (see below) |
| `outfile` | `string` | `{outDir}/{name}.txt` | Custom output path |
| `index` | `boolean` | `true` | Include index header |
| `prompt` | `string` | — | Text or file path (`./`, `~/`) to prepend |
| `onDemand` | `boolean` | `false` | Build only when named (see below) |

A bundle needs at least one source: `include`, `linear`, `screenshot`, or any combination. `outfile`, `index` and `prompt` apply only to text and require `include` or `linear`. Images always go to `outDir`.

Two bundles may not write to the same file. Names that differ only by case, or only in Unicode normalisation, count as the same file everywhere: on a case-insensitive filesystem — the default on macOS and Windows — `Web.txt` and `web.txt` are one directory entry, and APFS treats the two spellings of `Café` the same way, so one bundle would silently overwrite the other.

### On-Demand Bundles

A bundle that is slow, remote, or only occasionally useful can opt out of full runs:

```ts
bundles: {
  code: "src/**/*",
  backlog: { linear: "ENG", onDemand: true },
}
```

| Command           | Builds                                    |
| ----------------- | ----------------------------------------- |
| `srcpack`         | every bundle without `onDemand: true`     |
| `srcpack backlog` | `backlog`, on demand or not               |
| `--dry-run`       | the same selection as the run it previews |

A full run lists what it skipped (`On demand: backlog`). If every bundle is on demand, it writes no bundles and exits successfully; the same emptying rules still apply. A full run that empties `outDir` (by default, only `.srcpack` is emptied) removes an on-demand bundle's previous output there — run `srcpack`, then `srcpack backlog`.

## Pattern Syntax

Patterns follow standard glob syntax with special prefixes:

| Pattern          | Matches                            |
| ---------------- | ---------------------------------- |
| `src/**/*`       | All files under `src/`             |
| `*.ts`           | TypeScript files in root           |
| `**/*.ts`        | TypeScript files anywhere          |
| `!**/*.test.ts`  | Exclude test files                 |
| `+**/*.local.md` | Force-include, bypass `.gitignore` |
| `{src,lib}/**/*` | Files in `src/` or `lib/`          |
| `git:staged`     | Staged changes (see below)         |

### Force-Include (`+` prefix)

Use `+` to include files that would normally be excluded by `.gitignore`:

```ts
bundles: {
  docs: [
    "docs/**/*",           // all docs (respects .gitignore)
    "+docs/**/*.local.md", // force-include local notes
  ],
}
```

### Git Sources (`git:` prefix)

A pattern can name a set of changed files instead of a glob:

| Source          | Files                                                 |
| --------------- | ----------------------------------------------------- |
| `git:staged`    | Staged changes (index vs `HEAD`)                      |
| `git:unstaged`  | Unstaged changes to tracked files (worktree vs index) |
| `git:untracked` | New files not ignored by git                          |
| `git:dirty`     | All three combined                                    |
| `git:<rev>`     | Changes vs `<rev>` (e.g. `git:main`, `git:HEAD~3`)    |

```ts
bundles: {
  review: {
    include: ["git:staged", "!bun.lock"],
    prompt: "Review these changes for correctness.",
  },
}
```

Git sources mix freely with each other, with globs, and with `!` exclusions:

```ts
bundles: {
  pr: ["git:main", "git:untracked", "docs/architecture.md", "!**/*.snap"],
}
```

Notes:

- **A git source picks _which_ files to bundle; content always comes from the worktree.** If a file is staged and then edited again, `git:staged` bundles the current version on disk, not the staged blob.
- **`git:<rev>` compares against the merge base**, so a branch that has fallen behind `main` still reports only your own changes. Uncommitted edits to tracked files are included; untracked files are not — add `git:untracked` for those. Ranges (`git:main...HEAD`, `git:HEAD~3..HEAD`) pass through to git verbatim and cover committed changes only. Requires git 2.30+.
- **Deleted files are skipped** — there is nothing left to read. Same for binary files and submodules.
- **Symlinks are skipped**, in git sources and globs alike. A tracked link like `notes.txt -> ~/.ssh/id_rsa` would otherwise pull a file from outside the project into a bundle you might upload. Point a pattern at the real path instead.
- **`.gitignore` does not apply.** A file tracked despite `.gitignore` (force-added) is included; an ignored file is never reported by git in the first place.
- **A branch named `staged` is shadowed** by the named source. Use `git:refs/heads/staged` to disambiguate.
- **An empty result writes no file**, and clears a stale one from a previous run, so a bundle never holds changes you've since committed. A custom `outfile` outside `outDir` is left alone.
- `!git:...` and `+git:...` are errors: exclusion has no clear meaning, and force-include is already implied.

## Linear Issues

A bundle can pull issues from [Linear](https://linear.app) alongside your code. Each issue becomes a virtual file at `linear/issues/<identifier>.md`, so it gets its own index entry and line range:

```
# Index (5 files)
# [1]   docs/roadmap.md  L9-L94 (86 lines)
# [2]   linear/issues.md  L96-L103 (8 lines)
# [3]   linear/issues/ENG-123.md  L105-L132 (28 lines)
# [4]   linear/issues/ENG-148.md  L134-L169 (36 lines)
# [5]   src/board.ts  L171-L299 (129 lines)
```

That lets you ask an LLM things like _"does `[5] src/board.ts` actually implement `[3] ENG-123`?"_

### Roster

`linear/issues.md` is generated alongside the issues: a scope heading, a count per workflow state, and one table row per issue ordered by number.

```markdown
# ENG / Roadmap — 2 issues

Backlog 1 · In Progress 1

| Issue   | State       | Priority | Title                     |
| ------- | ----------- | -------- | ------------------------- |
| ENG-123 | In Progress | High     | Board history and restore |
| ENG-148 | Backlog     | Medium   | Weekly digest email       |
```

It exists because the index lists paths, and `linear/issues/ENG-148.md` says nothing about ENG-148 — without a roster a model has to read every issue body to find the relevant ones, and cannot answer "what is in progress" at all. The rows are ordered by issue number, which the index itself cannot be: it sorts paths as text, so `ENG-2` lands between `ENG-19` and `ENG-20`.

Drop it with `!linear/issues.md` if you only want the issue bodies.

### Setup

Create a personal API key in Linear (**Settings → Security & access → Personal API keys**) and export it:

```bash
export LINEAR_API_KEY=lin_api_...
```

The key is read from the environment, never from the config file — config files get committed.

### Usage

```ts
bundles: {
  // Shorthand: every non-terminal issue for team ENG
  backlog: { linear: "ENG" },

  // Code and the tickets that describe it, in one context file
  planning: {
    include: ["docs/**/*.md", "src/**/*.ts"],
    linear: { team: "ENG", project: "Roadmap" },
    prompt: "Which roadmap items are already implemented?",
  },
}
```

**Linear options:**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `team` | `string` | — | Required. Team key — the `ENG` in `ENG-123` |
| `project` | `string` | — | Project name. Must match exactly one project in `team` |
| `includeClosed` | `boolean` | `false` | Include completed, canceled and duplicate issues |

The string form `linear: "ENG"` is shorthand for `{ team: "ENG" }`.

Notes:

- **The default is every non-terminal issue**, not "active" in Linear's sense. Triage, Backlog, Todo and In Progress are all included; only the `completed`, `canceled` and `duplicate` state types are left out.
- **`includeClosed` does not reach archived issues.** Linear omits archived resources from ordinary responses, and srcpack does not ask for them, so `includeClosed: true` means "terminal issues too", not "all history".
- **`team` is required.** A workspace-wide fetch looks harmless in config and can pull thousands of issues into a context window. Declare one bundle per team if you need several.
- **Issues obey `!` exclusions like any other entry**, so you can drop individual tickets: `include: ["!linear/issues/ENG-7.md"]`.
- **A typo fails loudly.** An unknown team or project raises an error rather than producing an empty bundle; a project name matching two projects is rejected as ambiguous rather than silently merging both; and an unknown option key (`projet`) is rejected rather than ignored, which would quietly widen the bundle to the whole team.
- **Labels are capped at 50 per issue**, a deliberate context budget rather than a paginated read.
- **Issues travel with the bundle.** Issue text is ordinary bundle content, so a configured upload sends it to Google Drive alongside your code. Add the bundle to [`upload.exclude`](#upload-configuration) to keep it local.
- **`--dry-run` still calls the API**, because it has to in order to answer "what would this produce right now". There is no cache; a run without network access fails. Requests time out after 30 seconds.
- **`linear/issues/` is reserved** once a bundle pulls issues. A file on disk at that path is an error: two entries would share one name, and an `!` exclusion drops both rather than choosing. Rename the file, or narrow the include patterns so it isn't matched.

## Screenshots

A bundle can capture a rendered page as PNG images a vision model can actually read — on its own, or next to the code that renders it:

```ts
bundles: {
  home: { screenshot: "http://localhost:5173/", onDemand: true },

  "home-mobile": {
    screenshot: {
      url: "http://localhost:5173/",
      viewport: "mobile",
      hide: ["#cookie-banner", ".intercom-launcher"],
    },
    onDemand: true,
  },

  // Implementation and rendered result under one name
  pricing: {
    include: "src/pages/pricing/**/*",
    screenshot: "http://localhost:5173/pricing",
    prompt: "Review this implementation against the attached screenshots.",
    onDemand: true,
  },
}
```

```console
$ srcpack home home-mobile
  home         4 images  page 1440×6,210  → .srcpack/home-00.png … home-03.png
  home-mobile  11 images  page 412×9,480  → .srcpack/home-mobile-00.png … home-mobile-10.png

Bundled: 2 bundles, 15 images
```

Then drag `.srcpack/home-*.png` into ChatGPT, in filename order. A mixed bundle like `pricing` writes its text file and its images, and prints a line for each.

`onDemand: true` keeps a full `srcpack` from failing whenever the dev server isn't running — see [On-Demand Bundles](#on-demand-bundles).

### Setup

Screenshots use [Playwright](https://playwright.dev), which srcpack doesn't install for you — most projects never need a browser:

::: code-group

```sh [npm]
npm install -D playwright && npx playwright install chromium
```

```sh [bun]
bun add -d playwright && bunx playwright install chromium
```

```sh [pnpm]
pnpm add -D playwright && pnpm exec playwright install chromium
```

```sh [yarn]
yarn add -D playwright && yarn playwright install chromium
```

:::

A project that already uses Playwright Test needs nothing new. Without Playwright's Chromium, srcpack uses your installed Google Chrome. Playwright 1.41 or a later 1.x is required.

### Filenames

| File                          | Contains                                 |
| ----------------------------- | ---------------------------------------- |
| `<name>-00.png`               | The whole page, for layout               |
| `<name>-01.png`, `-02.png`, … | Overlapping detail slices, top to bottom |

Vision models downscale every image to a fixed pixel budget, so one image of a tall page arrives as a thumbnail. Detail slices are at most 2,200 device pixels tall and overlap by about 160, so text cut at one edge is whole in the next; a page just over one slice becomes two shorter slices rather than two near-copies. A page that fits in one slice produces only `<name>-00.png`.

The overview is best-effort. If a very tall page can't be captured whole, or its image would exceed ChatGPT's 20 MB per-image limit, srcpack warns and writes the detail slices alone, starting at `-01`. Those still cover the whole page.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | — | Required. An `http://` or `https://` URL |
| `viewport` | `"desktop" \| "mobile"` | `"desktop"` | Viewport preset (below) |
| `hide` | `string[]` | — | CSS selectors hidden during capture |

The string form `screenshot: "http://…"` is shorthand for `{ url: "http://…" }`.

| Viewport | CSS size | Pixel ratio | Emulation |
| --- | --- | --- | --- |
| `desktop` | 1440×900 | 1 | — |
| `mobile` | 412×839 | 2 | Pixel 7 user agent, touch, mobile layout |

### Notes

- **The page is scrolled before capture**, so lazy images and content that appears on scroll are rendered. Sections that grow as they load are followed down, and at the bottom srcpack waits for 500 ms of network quiet, capped at 5 seconds per wait, and keeps scrolling if requests added content. It stops after 50 viewports or 15 seconds and warns that content further down may not have loaded.
- **Framework dev toolbars are hidden** automatically (Astro, Nuxt). Next.js is left alone: its `nextjs-portal` also shows build and runtime errors, which a review should see. Use `hide` to suppress `"nextjs-portal"` or selectors for cookie banners and chat widgets. Hiding happens in the capture's own stylesheet; the page itself isn't changed.
- **A page that doesn't load fails the run**: an unreachable URL, a non-2xx status, or navigation that does not finish loading within 30 seconds. A screenshot of a 404 page would look like success. The previous run's images are left untouched.
- **Stale images are removed.** When a page shrinks from six images to four, `-04` and `-05` are deleted, so an old slice is never attached with the new set.
- **The URL needs a scheme** in config: `"localhost:5173"` is an error. (`--screenshot` on the command line adds `http://` for you.)
- **Images stay local.** A configured upload skips them and says so; a mixed bundle's text file still uploads.
- **`--dry-run` doesn't open the page.** It lists the URL, viewport and destination; how many images a page produces is only known after rendering it.
- **A page without `<meta name="viewport">`** lays out 980 CSS pixels wide under `mobile`, as it would on a real phone. If a mobile capture looks like the desktop site, that's why.
- **Output collisions are rejected**, including screenshot bundle names that differ only by case and a text `outfile` that lands in `outDir` under any bundle's numbered image name, even its own. Checks cover all configured bundles, including those skipped by this run.
- **Virtualized lists and content that disappears once scrolled past** may be missing: the page is scrolled to load content, then captured from the top.
- **A page that scrolls inside its own container** (the window never scrolls) is captured as a single viewport.
- **Pages behind a login aren't supported yet.**

## Automatic Exclusions

Srcpack skips:

- Files matching `.gitignore` — including `node_modules/`, build output, and secrets, since those are already ignored in any normal project. Nested `.gitignore` files count too, resolved the way git resolves them: the rule in the deepest directory wins, and nothing under an ignored directory is re-included. A monorepo's `packages/app/.gitignore` hides its `.env` here exactly as it does for git.
- Binary files (images, fonts, compiled assets), detected by content
- Symlinks, so a link can't pull in a file from outside the project — including symlinked directories, which are not walked into
- Its own output — `outDir` and every configured `outfile`. Otherwise a rerun would bundle the previous run's file, nesting it again each time.

Everything else matched by a pattern is included, so exclude what you don't want explicitly: `["src/**/*", "!bun.lock"]`.

## Examples

### Monorepo

```ts
export default defineConfig({
  bundles: {
    web: "apps/web/**/*",
    api: "apps/api/**/*",
    shared: "packages/shared/**/*",
  },
});
```

### Frontend + Backend

```ts
export default defineConfig({
  bundles: {
    client: ["src/client/**/*", "src/shared/**/*"],
    server: ["src/server/**/*", "src/shared/**/*"],
  },
});
```

### Exclude Tests and Mocks

```ts
export default defineConfig({
  bundles: {
    app: [
      "src/**/*",
      "!src/**/*.test.ts",
      "!src/**/*.spec.ts",
      "!src/**/__mocks__/**",
    ],
  },
});
```

### Code Review Bundle

```ts
export default defineConfig({
  bundles: {
    review: {
      include: "src/**/*",
      prompt: "./prompts/review.md", // or inline: "Review this code..."
    },
  },
});
```

### Package.json Config

```json
{
  "srcpack": {
    "bundles": {
      "app": "src/**/*",
      "backlog": { "linear": "ENG" }
    }
  }
}
```

Every bundle option is plain JSON, Linear included — its API key comes from the environment, so nothing here needs `process.env`.

## Upload Configuration

Configure cloud upload destinations. See [Google Drive Upload](/upload) for setup details.

```ts
export default defineConfig({
  bundles: {/* ... */},
  upload: {
    provider: "gdrive",
    folderId: "1ABC...",
    clientId: process.env.GDRIVE_CLIENT_ID,
    clientSecret: process.env.GDRIVE_CLIENT_SECRET,
    exclude: ["local"], // skip these bundles
  },
});
```

**Upload options:**

| Option         | Type       | Default | Description                        |
| -------------- | ---------- | ------- | ---------------------------------- |
| `provider`     | `"gdrive"` | —       | Upload provider (required)         |
| `folderId`     | `string`   | —       | Target folder ID (optional)        |
| `clientId`     | `string`   | —       | OAuth client ID (required)         |
| `clientSecret` | `string`   | —       | OAuth client secret (required)     |
| `exclude`      | `string[]` | —       | Bundle names to skip during upload |

Every name in `exclude` must match a configured bundle. A name that matches nothing is an error, since the alternative is uploading a bundle you meant to keep local.

## TypeScript Support

The `defineConfig` helper provides type checking and autocomplete:

```ts
import { defineConfig } from "srcpack";

export default defineConfig({
  // Full autocomplete here
});
```
