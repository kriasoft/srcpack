# CLI Reference

## Installation

Srcpack runs without global install:

::: code-group

```sh [npm]
npx srcpack [command] [options]
```

```sh [bun]
bunx srcpack [command] [options]
```

```sh [pnpm]
pnpm dlx srcpack [command] [options]
```

```sh [yarn]
yarn dlx srcpack [command] [options]
```

:::

Or install as a dev dependency:

::: code-group

```sh [npm]
npm install -D srcpack
```

```sh [bun]
bun add -D srcpack
```

```sh [pnpm]
pnpm add -D srcpack
```

```sh [yarn]
yarn add -D srcpack
```

:::

## Commands

### `srcpack` (default)

Build configured bundles except those marked [`onDemand`](./configuration.md#on-demand-bundles), and upload their text files if configured.

::: code-group

```sh [npm]
npx srcpack
```

```sh [bun]
bunx srcpack
```

```sh [pnpm]
pnpm dlx srcpack
```

```sh [yarn]
yarn dlx srcpack
```

:::

**With specific bundles:**

::: code-group

```sh [npm]
npx srcpack web api
```

```sh [bun]
bunx srcpack web api
```

```sh [pnpm]
pnpm dlx srcpack web api
```

```sh [yarn]
yarn dlx srcpack web api
```

:::

Naming a bundle builds it even when it is marked [`onDemand`](./configuration.md#on-demand-bundles); a full run skips those and lists them after the summary.

**Changed files only:**

```sh
npx srcpack --staged          # staged changes
npx srcpack --dirty           # staged + unstaged + untracked
npx srcpack --since main      # everything you changed since main
```

These build a one-off bundle from the current change set and need no config file — handy for handing a work-in-progress to an LLM. The bundle is named after the flag (`.srcpack/staged.txt`), other bundles in `outDir` are left alone unless you pass `--emptyOutDir`, and nothing is written when there are no changes.

Ad-hoc bundles stay local: they are never uploaded, even with Google Drive configured. Declare a named bundle to publish changes.

One-off flags use the discovered config's `root` and `outDir`, but replace the source definition of any configured bundle with the same name. For example, `--screenshot` replaces the images of a configured bundle named `screenshot`. Output collisions with differently named bundles are rejected.

For a permanent version with review instructions attached, put a [git source](./configuration.md#git-sources-git-prefix) in your config instead.

**A page, as images:**

```sh
npx srcpack --screenshot localhost:5173/pricing
npx srcpack --screenshot localhost:5173 --viewport mobile
```

Captures the page as numbered PNGs in `outDir` (by default `.srcpack/screenshot-00.png`, `screenshot-01.png`, …), with detail slices for tall pages. No config file is required. A URL without a scheme gets `http://`. Like the change-set flags, it leaves other files in `outDir` alone unless you pass `--emptyOutDir`, and never uploads. It needs Playwright — see [Screenshots](./configuration.md#screenshots), which also covers declaring a page you capture repeatedly.

### `srcpack init`

Create a `srcpack.config.ts` interactively.

::: code-group

```sh [npm]
npx srcpack init
```

```sh [bun]
bunx srcpack init
```

```sh [pnpm]
pnpm dlx srcpack init
```

```sh [yarn]
yarn dlx srcpack init
```

:::

Detects your project structure and suggests bundle configurations.

### `srcpack login`

Authenticate with Google Drive for uploads.

::: code-group

```sh [npm]
npx srcpack login
```

```sh [bun]
bunx srcpack login
```

```sh [pnpm]
pnpm dlx srcpack login
```

```sh [yarn]
yarn dlx srcpack login
```

:::

Opens a browser to authorize access. Tokens are stored in `~/.config/srcpack/credentials.json`, readable only by you.

## Options

| Option               | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `--staged`           | Bundle staged changes only                           |
| `--dirty`            | Bundle staged, unstaged, and untracked changes       |
| `--since <rev>`      | Bundle changes since `<rev>`                         |
| `--screenshot <url>` | Capture a page as numbered PNGs                      |
| `--viewport <name>`  | `desktop` (default) or `mobile`, with `--screenshot` |
| `--dry-run`          | Preview bundles without writing files                |
| `--emptyOutDir`      | Empty the output directory before writing            |
| `--no-emptyOutDir`   | Skip clearing the output directory                   |
| `--no-upload`        | Bundle only, skip upload                             |
| `-h`, `--help`       | Show help                                            |
| `-v`, `--version`    | Show version                                         |

`--no-emptyOutDir` disables directory-wide clearing; bundles still replace their outputs and remove stale files from their own previous output. See [output cleanup](./configuration.md#outdir).

The one-off flags (`--staged`, `--dirty`, `--since`, `--screenshot`) cannot be combined with each other or with bundle names. `--viewport` applies only to `--screenshot`; set the viewport in config for a named bundle.

An unrecognized option is an error, not a no-op — `--no-uplaod` would otherwise upload, and `--dry-rnu` would write. Values may follow a space or an `=`: `--since main` and `--since=main` are the same.

## Examples

### Preview without writing

::: code-group

```sh [npm]
npx srcpack --dry-run
```

```sh [bun]
bunx srcpack --dry-run
```

```sh [pnpm]
pnpm dlx srcpack --dry-run
```

```sh [yarn]
yarn dlx srcpack --dry-run
```

:::

Output:

```
  web   3 files  842 lines
    src/api/routes.ts
    src/index.ts
    src/utils/helpers.ts
  docs  1 file   96 lines
    README.md

Dry run: 2 bundles, 4 files, 938 lines
```

Each bundle lists the files it would contain, so you can check the shape of a pattern before anything is written; `outDir` is left alone too. A bundle that declares [`linear`](./configuration.md#linear-issues) still calls the API — the counts are what it would produce right now, which it can't know offline. A [`screenshot`](./configuration.md#screenshots) source is listed with its URL, viewport and destination without launching a browser. A mixed bundle still resolves its text sources.

### Bundle without upload

::: code-group

```sh [npm]
npx srcpack --no-upload
```

```sh [bun]
bunx srcpack --no-upload
```

```sh [pnpm]
pnpm dlx srcpack --no-upload
```

```sh [yarn]
yarn dlx srcpack --no-upload
```

:::

## Exit Codes

| Code | Meaning                 |
| ---- | ----------------------- |
| `0`  | Success                 |
| `1`  | Error (config, IO, etc) |

## Config File Locations

Srcpack searches for config in order:

1. `srcpack.config.ts`
2. `srcpack.config.mts`
3. `srcpack.config.js`
4. `srcpack` field in `package.json`

Searches from current directory up to filesystem root.

`srcpack init` writes `.ts` in an ESM project and `.mts` otherwise — see [Configuration](./configuration.md#config-file-format).
