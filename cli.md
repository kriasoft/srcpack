---
url: /srcpack/cli.md
---
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

Bundle all configured bundles and upload if configured.

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

Opens a browser to authorize access. Tokens are stored in `~/.config/srcpack/credentials.json`.

## Options

| Option        | Description                           |
| ------------- | ------------------------------------- |
| `--dry-run`   | Preview bundles without writing files |
| `--no-upload` | Bundle only, skip upload              |
| `--help`      | Show help                             |
| `--version`   | Show version                          |

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
[dry-run] web  →  .srcpack/web.txt  (24 files, 8.2 KB)
[dry-run] api  →  .srcpack/api.txt  (18 files, 5.1 KB)
```

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
2. `srcpack.config.js`
3. `srcpack` field in `package.json`

Searches from current directory up to filesystem root.
