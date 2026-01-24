# Configuration

Srcpack looks for configuration in the following order:

1. `srcpack.config.ts` (recommended)
2. `srcpack.config.js`
3. `srcpack` field in `package.json`

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

| Option        | Type      | Default         | Description                            |
| ------------- | --------- | --------------- | -------------------------------------- |
| `root`        | `string`  | `process.cwd()` | Project root directory                 |
| `outDir`      | `string`  | `.srcpack`      | Output directory for bundles           |
| `emptyOutDir` | `boolean` | `true`\*        | Empty output directory before bundling |
| `bundles`     | `object`  | —               | Named bundles (required)               |
| `upload`      | `object`  | —               | Upload destination                     |

\*`emptyOutDir` defaults to `true` when `outDir` is inside project root.

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

| Option    | Type                 | Default               | Description                               |
| --------- | -------------------- | --------------------- | ----------------------------------------- |
| `include` | `string \| string[]` | —                     | Glob pattern(s)                           |
| `outfile` | `string`             | `{outDir}/{name}.txt` | Custom output path                        |
| `index`   | `boolean`            | `true`                | Include index header                      |
| `prompt`  | `string`             | —                     | Text or file path (`./`, `~/`) to prepend |

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

## Automatic Exclusions

Srcpack automatically excludes:

- Files matching `.gitignore` patterns
- Binary files (images, fonts, compiled assets)
- `node_modules/`
- `.git/`
- Lock files (`package-lock.json`, `yarn.lock`, etc.)

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
      "app": "src/**/*"
    }
  }
}
```

## Upload Configuration

Configure cloud upload destinations. See [Google Drive Upload](/upload) for setup details.

```ts
export default defineConfig({
  bundles: {
    /* ... */
  },
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

## TypeScript Support

The `defineConfig` helper provides type checking and autocomplete:

```ts
import { defineConfig } from "srcpack";

export default defineConfig({
  // Full autocomplete here
});
```
